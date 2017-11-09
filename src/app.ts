require('dotenv').config({silent: true});

import * as logger from 'winston';
import * as DracoNode from 'draconode';
import * as _ from 'lodash';
import * as fs from 'mz/fs';
import * as moment from 'moment';
import * as Bluebird from 'bluebird';

import APIHelper from './lib/api';
import ProxyHelper from './lib/proxy';
import Walker from './lib/walker';
import Player from './lib/player';
import SocketServer from './ui/socket.server';

const config = require('./lib/config').load();

if (!config.credentials.userid) {
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

        await client.boot({
            userId: config.credentials.userid,
            deviceId: config.credentials.deviceid,
        });

        logger.debug('Login...');
        let response = await client.login();
        apihelper.parse(response);

        logger.debug('Load...');
        await client.load();

        logger.info('Client started...');

        logger.debug('Get inventory...');
        response = await client.getUserItems();
        apihelper.parse(response);

        await mapRefresh();
        socket.ready();

        await saveState();

        // update position every second
        setTimeout(updatePos, 1000);

    } catch (e) {
        logger.error(e, e.message);

        if (e.message === 'Invalid proxy.') proxyhelper.badProxy();
        else if (e.message.indexOf('tunneling socket could not be established') >= 0) proxyhelper.badProxy(); // no connection
        else if (e.message.indexOf('ECONNRESET') >= 0) proxyhelper.badProxy(); // connection reset
        else if (e.message.indexOf('ECONNREFUSED ') >= 0) proxyhelper.badProxy(); // connection refused
        else if (e.message.indexOf('403') >= 0) proxyhelper.badProxy(); // ip banned?

        logger.error('Exiting.');
        process.exit();
    }
}

async function updatePos() {
    const path = await walker.checkPath();
    if (path) socket.sendRoute(path.waypoints);

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
            await Bluebird.delay(config.delay.evolve * _.random(900, 1100));

        } else if (todo.call === 'drop_items') {
            await Bluebird.delay(config.delay.recycle * _.random(900, 1100));

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
    try {
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

        await player.catchCreatures();

    } catch (e) {
        logger.error(e);
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
