import * as _ from 'lodash';
import * as logger from 'winston';
import * as Bluebird from 'bluebird';
import * as DracoNode from 'draconode';
import * as dracoText from 'dracotext';

const strings = dracoText.load('english');

const geolib = require('geolib');

import APIHelper from './api';

/**
 * A player, that catch, spin...
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
        if (this.config.inventory && total >= 0.9 * this.state.player.storage.items) {
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
                        } else {
                            item.count -= drop;
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

                logger.info('Building spun!');

                await Bluebird.delay(this.config.delay.spin * _.random(900, 1100));
            } catch (e) {
                logger.error('Unable to spin');
                if (e.details) {
                    logger.error(e.details);
                } else {
                    logger.error(e);
                }
            }
        }, {concurrency: 1});
    }

    getThrowBall() {
        const simple = this.state.inventory.find(x => x.type === DracoNode.enums.ItemType.MAGIC_BALL_SIMPLE);
        if (simple && simple.count > 0) {
            return DracoNode.enums.ItemType.MAGIC_BALL_SIMPLE;
        }

        const normal = this.state.inventory.find(x => x.type === DracoNode.enums.ItemType.MAGIC_BALL_NORMAL);
        if (normal && normal.count > 0) {
            return DracoNode.enums.ItemType.MAGIC_BALL_NORMAL;
        }

        const good = this.state.inventory.find(x => x.type === DracoNode.enums.ItemType.MAGIC_BALL_GOOD);
        if (good && good.count > 0) {
            return DracoNode.enums.ItemType.MAGIC_BALL_GOOD;
        }

        return -1;
    }

    async catchCreatures() {
        const client: DracoNode.Client = this.state.client;

        const range = this.state.player.avatar.activationRadius * 0.95;
        const wilds = this.state.map.creatures.wilds;
        if (wilds.length > 0) logger.debug(`${wilds.length} wild creature(s) around.`);
        for (const creature of wilds) {
            if (this.state.creatures.length >= this.state.player.storage.creatures) {
                logger.warn('Creature bag full!');
            } else if (this.getThrowBall() < 0) {
                logger.warn('Out of balls!');
            } else if (this.distance(creature) < range) {
                const name = strings.getCreature(DracoNode.enums.CreatureType[creature.name]);
                logger.debug('Try catching a wild ' + name);

                await client.encounter(creature.id);
                let response: any = {};
                let tries = 3;
                while (!response.caught && !response.runAway && (tries-- > 0)) {
                    const ball = this.getThrowBall();
                    if (ball < 0) {
                        logger.warn('No more ball to throw.');
                        break;
                    }
                    await client.delay(this.config.delay.encouter * _.random(900, 1100));
                    response = await client.catch(creature.id,
                                                  ball,
                                                  0.5 + Math.random() * 0.5,
                                                  Math.random() >= 0.5);
                    this.apihelper.parse(response);
                    this.state.inventory.find(i => i.type === ball).count--;
                }

                if (response.caught) {
                    logger.info(`${name} caught!`);
                    const creature = response.userCreature;
                    creature.display = name;
                    creature.ball = response.ballType;
                    this.state.socket.sendCreatureCaught(creature);
                    const release = this.autoReleaseCreature(creature);
                    if (this.state.creatures && !release) {
                        this.state.creatures.push(creature);
                    }
                }

                await Bluebird.delay(this.config.delay.catch * _.random(900, 1100));
            }
        }
    }

    async autoReleaseCreature(creature) {
        if (!this.config.behavior.autorelease) return;

        const creatures: any[] = this.state.creatures;
        const better = creatures.find(c =>
            c.name === creature.name &&
            (c.attackValue + c.staminaValue) > (creature.attackValue + creature.staminaValue) &&
            c.cp > creature.cp
        );
        if (better) {
            await Bluebird.delay(this.config.delay.release * _.random(900, 1100));
            const client: DracoNode.Client = this.state.client;
            const response = await client.releaseCreatures([ creature.id ]);
            this.apihelper.parse(response);
            logger.info(`${creature.display} released.`);
            return response;
        } else {
            return null;
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

    async dispatchIncubators() {
        const hatchInfo = await this.getHatchingInfo();
        let freeIncub = hatchInfo.incubators.filter(i => i.eggId === null);
        let eggs = hatchInfo.eggs.filter(e => e.incubatorId === null && !e.isEggForRoost);
        if (freeIncub.length > 0 && eggs.length > 0) {
            logger.debug('Dispatch incubators');
            const client: DracoNode.Client = this.state.client;
            eggs = _.orderBy(eggs, 'totalDistance', 'asc');
            freeIncub = _.orderBy(freeIncub, 'usagesLeft', 'desc');
            const max = Math.min(eggs.length, freeIncub.length);
            for (let i = 0; i < max; i++) {
                logger.info(`Start hatching a ${eggs[i].totalDistance / 1000}km egg.`);
                await client.startHatchingEgg(eggs[i].id, freeIncub[i].incubatorId);
            }
        }
    }

    async getHatchingInfo() {
        const client: DracoNode.Client = this.state.client;
        const response = await client.getHatchingInfo();
        this.apihelper.parse(response);
        return response;
    }

    async openChests() {
        const client: DracoNode.Client = this.state.client;
        for (const chest of this.state.map.chests) {
            const response = await client.openChest(chest);
            this.apihelper.parse(response);
        }
    }

    /**
     * Calculte distance from current pos to a target.
     * @param {object} target position
     * @return {int} distance to target
     */
    distance(target): number {
        if (!target.lat && !target.latitude && target.coords) target = target.coords;
        return geolib.getDistance(this.state.pos, target, 1, 1);
    }
}
