require('dotenv').config({silent: true});

import * as logger from 'winston';
import * as DracoNode from 'draconode';
import * as _ from 'lodash';
import * as fs from 'mz/fs';
import * as moment from 'moment';
import * as Bluebird from 'bluebird';
import * as dracoText from 'dracotext';

import APIHelper from './lib/api';
import ProxyHelper from './lib/proxy';
import Walker from './lib/walker';
import Player from './lib/player';
import SocketServer from './ui/socket.server';

const strings = dracoText.load('english');
const config = require('./lib/config').load();

if (!config.credentials.deviceId) {
    logger.error('Invalid credentials. Please fill data/config.yaml.');
    logger.error('look at config.example.yaml for example.');
    process.exit();
}

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

const apihelper = new APIHelper(config, state);
const walker = new Walker(config, state);
const player = new Player(config, state);
const proxyhelper = new ProxyHelper(config, state);
const socket = state.socket = new SocketServer(config, state);

let client: DracoNode.Client;

async function main() {
    logger.info('App starting...');
    if (config.ui.enabled) {
        logger.info('go to http://ui.dracoapi.ml/ for ui');
    }
    try {
        const valid = await proxyhelper.checkProxy();
        if (config.proxy.url && !valid) {
            throw new Error('Invalid proxy.');
        }
        await socket.start();

        client = new DracoNode.Client({
            proxy: proxyhelper.proxy,
        });
        state.client = client;

        logger.debug('Ping server...');
        await client.ping(true);

        await client.boot(config.credentials);

        logger.debug('Login...');
        let response = await client.login();
        if (!response) throw new Error('Unable to login');
        apihelper.parse(response);
        const newLicence = response.info.newLicense;

        logger.debug('Load...');
        await client.load();

        logger.info('Client started...');

        logger.debug('Get inventory...');
        response = await client.getUserItems();
        apihelper.parse(response);

        logger.debug('Get creadex...');
        response = await client.getCreadex();
        apihelper.parse(response);

        logger.debug('Get creatures...');
        await player.getCreatures();

        await mapRefresh();
        socket.ready();

        await apihelper.startingEvents();

        if (newLicence > 0) {
            await client.acceptLicence(newLicence);
        }

        await saveState();

        // update position every second
        setTimeout(updatePos, 1000);

        // check incubators every 5 min
        player.dispatchIncubators();
        setInterval(async () => {
            try {
                await player.dispatchIncubators();
            } catch (e) {
                logger.error(e);
                if (e.details) logger.error(e.details);
            }
        }, 5 * 60 * 1000);

    } catch (e) {
        if (e.message === 'Invalid proxy.' ||
            (e.name === 'StatusCodeError' && e.statusCode === 403) || // ip banned
            e.message.indexOf('tunneling socket could not be established') > 0 ||
            e.message.indexOf('ECONNRESET') >= 0 || // connection reset
            e.message.indexOf('ECONNREFUSED ') >= 0 || // connection refused
            e.message.indexOf('403') >= 0) { // ip banned?
            logger.error('Bad proxy');
            proxyhelper.badProxy();
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
        if (!last || moment().subtract(max, 's').isAfter(last.when)) {
            // no previous call, fire a getMapUpdate
            // or if it's been enough time since last getMapUpdate
            await mapRefresh();
        }
    } catch (e) {
        logger.error(e);
        if (e.details) logger.error(e.details);
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
            await client.releaseCreatures(todo.creatures);
            await Bluebird.delay(config.delay.release * _.random(900, 1100));

        } else if (todo.call === 'evolve_creature') {
            const response = await client.evolve(todo.creature, todo.to);
            apihelper.parse(response);
            response.creature.display = strings.getCreature(DracoNode.enums.CreatureType[response.creature.name]);
            logger.info('Creature evolve to ' + response.creature.display);
            await Bluebird.delay(config.delay.evolve * _.random(900, 1100));

        } else if (todo.call === 'drop_items') {
            await client.discardItem(todo.id, todo.count);
            await Bluebird.delay(config.delay.recycle * _.random(900, 1100));

        } else if (todo.call === 'open_egg') {
            const response = await client.openHatchedEgg(todo.incubatorId);
            apihelper.parse(response);

        } else {
            logger.warn('Unhandled todo: ' + todo.call);
        }
    } else {
        await player.cleanInventory();
    }
}

/**
 * Refresh map information based on current location
 * @return {Promise}
 */
async function mapRefresh(): Promise<void> {
    logger.debug('Map Refresh', state.pos);
    const pos = walker.fuzzedLocation(state.pos);
    const update = await client.getMapUpdate(pos.lat, pos.lng);
    apihelper.parseMapUpdate(update);

    state.api.lastMapUpdate = {
        when: moment(),
        where: pos,
    };

    await saveState();

    socket.sendBuildings();
    await player.spinBuildings();

    await player.openChests();

    if (config.behavior.catch) {
        await player.catchCreatures();
    }
}

async function saveState() {
    // save current state to file (useful for debugging)
    // clean up a little and remove non useful data
    const lightstate = _.cloneDeep(state);
    delete lightstate.client;
    delete lightstate.socket;
    await fs.writeFile('data/state.json', JSON.stringify(lightstate, null, 2));
}

main();
