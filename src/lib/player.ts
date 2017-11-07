import * as _ from 'lodash';
import * as logger from 'winston';
import * as Bluebird from 'bluebird';
import * as DracoNode from 'draconode';
import * as dracoText from 'dracotext';

const strings = dracoText.load('english');

const geolib = require('geolib');

import APIHelper from './api';

/**
 * Helper class to deal with our walker.
 */
export default class Player {
    config: any;
    state: any;
    apihelper: APIHelper;

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.apihelper = new APIHelper(config, state);
    }

    async cleanInventory() {
        const client: DracoNode.Client = this.state.client;
        const items: any[] = this.state.inventory;
        const total = _.reduce(items, (sum, i) => sum + i.count, 0);
        if (total >= this.state.player.storage.items) {
            logger.warn('Inventory full');
        }
        if (this.config.inventory && total >= 0.8 * this.state.player.storage.items) {
            logger.info('Clean inventory');
            const limits = this.config.inventory;
            for (const item of items) {
                if (_.has(limits, item.type)) {
                    const drop = item.count - Math.min(item.count, limits[item.type]);
                    if (drop > 0) {
                        const itemname = strings.getItem(DracoNode.enums.ItemType[item.type]);
                        logger.debug('Drop %d of %s', drop, itemname);
                        const response = await client.discardItem(item.type, drop);
                        if (!response) {
                            logger.warn('Error dropping items');
                        }
                        await Bluebird.delay(this.config.delay.recycle * _.random(900, 1100));
                    }
                }
            }
        }
    }

    async spinBuildings() {
        const client: DracoNode.Client = this.state.client;

        const range = this.state.player.avatar.activationRadius * 0.9;
        let buildings: any[] = this.state.map.buildings;
        buildings = buildings.filter(b => b.type === DracoNode.enums.BuildingType.STOP &&
                                          b.available && b.pitstop && !b.pitstop.cooldown &&
                                          this.distance(b) < range);

        await Bluebird.map(buildings, async stop => {
            logger.debug('Use stop %s', stop.id);
            try {
                if (this.distance(stop) >= 0.50 * range) return;

                // spin
                let response = await client.useBuilding(this.state.pos.lat, this.state.pos.lng,
                                                        stop.id,
                                                        stop.coords.latitude, stop.coords.longitude);
                const info = this.apihelper.parse(response);

                // get inventory
                response = await client.getUserItems();
                this.apihelper.parse(response);

                this.state.socket.sendVisiteBuilding(info.building);

                logger.info('Building spinned');

                await Bluebird.delay(this.config.delay.spin * _.random(900, 1100));
            } catch (e) {
                logger.error('Unable to spin');
                logger.error(e);
            }
        }, {concurrency: 1});
    }

    getThrowBall() {
        return DracoNode.enums.ItemType.MAGIC_BALL_SIMPLE;
    }

    async catchCreatures() {
        const client: DracoNode.Client = this.state.client;

        const range = this.state.player.avatar.activationRadius * 0.95;
        const wilds = this.state.map.creatures.wilds;
        for (const creature of wilds) {
            if (this.distance(creature) < range) {
                // creature.id, creature.name, crezture.coords
                const name = strings.getCreature(DracoNode.enums.CreatureType[creature.name]);
                logger.debug('Try catching a wild ' + name);

                await client.encounter(creature.id);

                let response;
                let caught = false;
                let tries = 3;
                while (!caught && (tries-- > 0)) {
                    await client.delay(this.config.delay.encouter * _.random(900, 1100));
                    response = await client.catch(creature.id,
                                                  this.getThrowBall(),
                                                  0, // 0.5 + Math.random() * 0.5,
                                                  Math.random() >= 0.5);
                    this.apihelper.parse(response);
                    caught = response.caught;
                }

                if (response.caught) {
                    logger.info(`${name} caught!`);
                    const creature = response.userCreature;
                    creature.display = name;
                    creature.ball = response.ballType;
                    this.state.socket.sendCreatureCaught(creature);
                }

                await Bluebird.delay(this.config.delay.catch * _.random(900, 1100));
            }
        }
    }

    async getInventory() {
        const client: DracoNode.Client = this.state.client;
        const response = await client.getUserItems();
        this.apihelper.parse(response);
        for (const item of this.state.inventory) {
            if (!item.display) {
                item.display = strings.getItem(DracoNode.enums.ItemType[item.type]);
            }
        }
        return this.state.inventory;
    }

    async getCreatures() {
        const client: DracoNode.Client = this.state.client;
        const response = await client.getUserCreatures();
        this.apihelper.parse(response);
        for (const creature of this.state.creatures) {
            if (!creature.display) {
                creature.display = strings.getCreature(DracoNode.enums.CreatureType[creature.name]);
            }
        }
        return this.state.creatures;
    }

    /**
     * Calculte distance from current pos to a target.
     * @param {object} target position
     * @return {int} distance to target
     */
    distance(target): number {
        if (!target.latitude && target.coords) target = target.coords;
        return geolib.getDistance(this.state.pos, target, 1, 1);
    }
}
