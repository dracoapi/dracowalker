require('dotenv').config();

import * as logger from 'winston';
import { Client, enums } from 'draconode';
import * as _ from 'lodash';
import * as fs from 'mz/fs';
import * as moment from 'moment';
import * as Bluebird from 'bluebird';
import * as dracoText from 'dracotext';
import * as ua from 'universal-analytics';

import APIHelper from './lib/api';
import ProxyHelper from './lib/proxy';
import Walker from './lib/walker';
import Player from './lib/player';
import SocketServer from './ui/socket.server';
import Fight from './lib/fight';

import * as versions from './lib/versions';

const strings = dracoText.load('english');
const config = require('./lib/config').load();

const state: any = {
    pos: {
        lat: config.pos.lat,
        lng: config.pos.lng,
    },
    api: {},
    player: {
        storage: {},
    },
    path: {
        visited: [],
        waypoints: [],
    },
    todo: [],
};

const proxyhelper = new ProxyHelper(config, state);
const apihelper = new APIHelper(config, state);
const player = new Player(config, state);
const walker = state.walker = new Walker(config, state);
const socket = state.socket = new SocketServer(config, state);

let client: Client;
let analytics: any;

async function main() {
    logger.info('App starting...');
    await versions.print();
    await versions.checkLatest();

    if (config.ui.enabled) {
        let portInfo = '';
        if (config.ui.port && config.ui.port !== 8000) portInfo = `?websocket=http://localhost:${config.ui.port}`;
        logger.info(`Go to http://ui.dracoapi.ml/${portInfo} for ui`);
    }
    try {
        const valid = await proxyhelper.checkProxy();
        if (config.proxy.url && !valid) {
            throw new Error('Invalid proxy.');
        }
        await socket.start();

        client = new Client({
            proxy: proxyhelper.proxy,
        });
        state.client = client;

        analytics = ua(
            'UA-108458756-3',
            `${config.credentials.login}:${config.credentials.username}`,
            {strictCidFormat: false}
        );
        analytics.pageview('/').send();
        analytics.event('version', await versions.getVersion()).send();

        logger.debug(`Using api ${client.clientVersion}/${client.protocolVersion}`);

        logger.debug('Init walker...');
        await walker.checkPath();
        await walker.walk();

        logger.debug('Ping server...');
        await client.ping(true);

        let response: any = await client.boot(config.credentials);
        apihelper.parse(response);

        logger.debug('Login...');
        response = await client.login();
        if (!response) throw new Error('Unable to login');
        apihelper.parse(response);

        const newLicence = response.info.newLicense;

        if (response.info.sendClientLog) {
            logger.warn('Send client log is set to true! Please report.');
        }

        await client.post('https://us.draconiusgo.com/client-error', {
            appVersion: client.clientVersion,
            deviceInfo: `platform=iOS\nos=${client.clientInfo.platformVersion}\ndevice=iPhone 6S`,
            userId: client.user.id,
            message: 'Material doesn\'t have a texture property \'_MainTex\'',
            stackTrace: '',
        });

        logger.info('Client started...');

        logger.debug('Get inventory...');
        response = await client.inventory.getUserItems();
        apihelper.parse(response);

        logger.debug('Get creadex...');
        response = await client.inventory.getCreadex();
        apihelper.parse(response);

        logger.debug('Get creatures...');
        await player.getCreatures();

        await mapRefresh();

        socket.ready();

        if (newLicence > 0) {
            await client.acceptLicence(newLicence);
        }

        // await client.getNews();

        await saveState();

        // update position every second
        setTimeout(updatePos, 1000);

        await player.leaveDungeon();

        // check incubators every 5 min
        if (config.behavior.incubate) {
            player.dispatchIncubators();
            setInterval(async () => {
                await player.dispatchIncubators();
            }, 4 * 60 * 1000);
        }
    } catch (e) {
        if (e.message === 'Invalid proxy.' ||
            (e.name === 'StatusCodeError' && e.statusCode === 403) || // ip banned
            e.message.indexOf('tunneling socket could not be established') > 0 ||
            e.message.indexOf('ECONNRESET') >= 0 || // connection reset
            e.message.indexOf('ECONNREFUSED ') >= 0 || // connection refused
            e.message.indexOf('403') >= 0) { // ip banned?
            logger.error('Bad proxy');
            // logger.error(e.message);
            await proxyhelper.badProxy();
        } else {
            logger.error(e);
        }

        logger.error('Exiting.');
        process.exit();
    }
}

async function updatePos() {
    try {
        const path = await walker.checkPath();
        if (path) socket.sendRoute(path);

        await walker.walk();
        socket.sendPosition();

        await handlePendingActions();

        const max: number = +state.api.config.updateRequestPeriodSeconds;
        const last = state.api.lastMapUpdate;
        const longEnough = moment().subtract(max, 's').isAfter(last.when);
        const farEnough = true; // player.distance(last.pos) >= state.api.config.updateRequestMinimalDistance;
        if (!last || (longEnough && farEnough)) {
            // no previous call, fire a getMapUpdate
            // or if it's been enough time since last getMapUpdate and player moved enough
            await mapRefresh();
        }
        state.errors = 0;
    } catch (e) {
        logger.error(e);
        if (e.details && e.details.__type === 'FServiceError') {
            logger.error(e.details);
            if (e.details.cause === 'SESSION_GONE') process.exit();
        }
        state.errors++;
        if (state.errors === 10) {
            logger.error('Too much errors, aborting.');
            process.exit();
        }
    }

    setTimeout(updatePos, 1000);
}

async function handlePendingActions() {
    // actions have been requested, but we only call them if
    // there is nothing going down at the same time
    if (state.todo.length > 0) {
        const todo = state.todo.shift();
        if (todo.call === 'release_creature') {
            logger.info('Release creatures', todo.creatures);
            const response = await client.creatures.release(todo.creatures);
            apihelper.parse(response);
            await Bluebird.delay(config.delay.release * _.random(900, 1100));

        } else if (todo.call === 'evolve_creature') {
            const response = await client.creatures.evolve(todo.creature, todo.to);
            apihelper.parse(response);
            response.creature.display = strings.getCreature(enums.CreatureType[response.creature.name]);
            logger.info('Creature evolve to ' + response.creature.display);
            await Bluebird.delay(config.delay.evolve * _.random(900, 1100));

        } else if (todo.call === 'drop_items') {
            await client.inventory.discardItem(todo.id, todo.count);
            const item = state.inventory.find(i => i.type === todo.id);
            item.count = Math.max(0, item.count - todo.count);
            const name = strings.getItem(enums.ItemType[todo.id]);
            logger.info(`Dropped ${todo.count} of ${name}`);
            await Bluebird.delay(config.delay.recycle * _.random(900, 1100));

        } else if (todo.call === 'use_item') {
            const item = state.inventory.find(i => i.type === todo.id);
            const name = strings.getItem(enums.ItemType[todo.id]);
            if (item.count > 0) {
                if (item.fulltype === 'INCENSE') {
                    if (state.player.avatar.incenseLeftTime.toNumber() === 0) {
                        const response = await client.inventory.useIncense();
                        apihelper.parse(response);
                        item.count--;
                        logger.info(`${name} used`);
                        await Bluebird.delay(config.delay.useItem * _.random(900, 1100));
                    } else {
                        logger.info('Incense already in use.');
                    }
                } else if (item.fulltype === 'SUPER_VISION') {
                    if (state.player.avatar.superVisionLeftTime.toNumber() === 0) {
                        const pos = walker.fuzzedLocation(state.pos);
                        const response = await client.inventory.useSuperVision(pos.lat, pos.lng);
                        apihelper.parse(response);
                        item.count--;
                        logger.info(`${name} used`);
                        await Bluebird.delay(config.delay.useItem * _.random(900, 1100));
                    } else {
                        logger.info('Super vision already in use.');
                    }
                } else if (item.fulltype === 'EXPERIENCE_BOOSTER') {
                    const response = await client.inventory.useExperienceBooster();
                    apihelper.parse(response);
                    item.count--;
                    logger.info(`${name} used`);
                } else {
                    logger.info('Unhandled item use: ' + item.fulltype);
                }
            }
        } else if (todo.call === 'open_egg') {
            const response = await client.eggs.openHatchedEgg(todo.incubatorId);
            apihelper.parse(response);
            response.creature.display = strings.getCreature(enums.CreatureType[response.creature.name]);
            logger.info('Egg hatched, received a ' + response.creature.display);

        } else if (todo.call === 'select_alliance') {
            await client.selectAlliance(todo.alliance, todo.bonus);
            logger.info(`Alliance selected, you are now ${enums.AllianceType[todo.alliance]}`);

        } else {
            logger.warn('Unhandled todo: ' + todo.call);
        }
    } else if (Math.random() < 0.8) {
        await player.cleanInventory();
    } else {
        await player.evolveperfect();
    }
}

async function mapRefresh(): Promise<void> {
    logger.debug('Map Refresh', state.pos);
    analytics.pageview('/mapRefresh').send();

    const pos = walker.fuzzedLocation(state.pos);
    const tilecache = apihelper.getTileCache();
    const update = await client.getMapUpdate(pos.lat, pos.lng, 0, tilecache);
    const info = await apihelper.parseMapUpdate(update);

    // await client.call('ClientEventService', 'clientLogRecords', [ { __type: 'List<>', value: [] } ]);

    state.api.lastMapUpdate = {
        when: moment(),
        where: pos,
    };

    await saveState();
    socket.sendBuildings();

    if (info.encounter && config.behavior.wildfight) {
        const level = info.encounter.level / 2;
        const name = strings.getCreature(enums.CreatureType[info.encounter.creatureName]);
        logger.warn(`You're being attacked by a level ${level} ${name}!`);
        const fight = new Fight(config, state);
        await fight.fight(info.encounter);
    } else {
        await player.spinBuildings();
        await player.openChests();
        if (config.behavior.catch) {
            await player.catchCreatures();
        }
    }

    if (config.pos.save) {
        await fs.writeFile('data/position.json', JSON.stringify(config.pos), 'utf8');
    }
}

async function saveState() {
    // save current state to file (useful for debugging)
    // clean up a little and remove non useful data
    const lightstate = _.cloneDeep(state);
    delete lightstate.client;
    delete lightstate.socket;
    delete lightstate.walker;
    await fs.writeFile(`data/${config.statename}.json`, JSON.stringify(lightstate, null, 2));
}

main();
