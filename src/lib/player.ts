import * as _ from 'lodash';
import * as logger from 'winston';
import * as Bluebird from 'bluebird';
import { Client, objects, enums } from 'draconode';
import * as dracoText from 'dracotext';

const strings = dracoText.load('english');

const geolib = require('geolib');

import APIHelper from './api';
import MODRouter from './router/MODRouter';

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
        const client: Client = this.state.client;
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
                        const itemname = strings.getItem(enums.ItemType[item.type]);
                        logger.debug('  drop %d of %s', drop, itemname);
                        const response = await client.inventory.discardItem(item.type, drop);
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
        if (this.state.player.avatar.isBagFull) return;

        const client: Client = this.state.client;
        const types = [ enums.BuildingType.STOP, enums.BuildingType.PORTAL, enums.BuildingType.DUNGEON_STOP ];

        const range = this.state.player.avatar.activationRadius * 0.9;
        let buildings: any[] = this.state.map.buildings;
        buildings = buildings.filter(b => types.includes(b.type) &&
                                          b.available &&
                                          (!b.pitstop || (b.pitstop && !b.pitstop.cooldown)) &&
                                          this.distance(b) < range);

        await Bluebird.map(buildings, async building => {
            logger.debug('Use building %s', building.id);
            try {
                if (this.distance(building) >= 0.50 * range) return;
                if (building.type === enums.BuildingType.PORTAL) {
                    // if already in a dungeon, ignore portal
                    if (this.state.player.avatar.dungeonId) return;
                    // if already visited, ignore
                    if (this.state.path.visited.includes(building.id)) return;
                }
                if (this.state.player.avatar.dungeonId && building.type === enums.BuildingType.PORTAL) return;

                // spin
                let response = await client.useBuilding(this.state.pos.lat, this.state.pos.lng,
                                                        building.id,
                                                        building.coords.latitude, building.coords.longitude);
                const info = this.apihelper.parse(response);
                if (info.building) {
                    this.state.socket.sendVisiteBuilding(info.building);

                    logger.info('Stop spun!');
                    // get inventory
                    await Bluebird.delay(this.config.delay.spin * _.random(900, 1100));
                    response = await client.inventory.getUserItems();
                    this.apihelper.parse(response);
                } else if (building.type === enums.BuildingType.PORTAL) {
                    logger.info('Portal used!');
                    const mod = this.state.map.buildings.find(b => b.type === enums.BuildingType.ROOST);
                    if (mod) {
                        logger.info('Found a mother of dragons, go there.');
                        this.state.walker.router = new MODRouter(this.config, this.state, mod, this);
                    } else {
                        logger.info('No mother of dragons...');
                        await this.leaveDungeon();
                    }
                }

                this.state.path.visited.push(building.id);
                await Bluebird.delay(this.config.delay.spin * _.random(900, 1100));
            } catch (e) {
                logger.error('Unable to spin');
                logger.error(e);
                if (e.details && e.details.constructor.name !== 'IncomingMessage') {
                    logger.error(e.details);
                }
            }
        }, {concurrency: 1});
    }

    getThrowBall() {
        const simple = this.state.inventory.find(x => x.type === enums.ItemType.MAGIC_BALL_SIMPLE);
        if (simple && simple.count > 0) {
            return enums.ItemType.MAGIC_BALL_SIMPLE;
        }

        const normal = this.state.inventory.find(x => x.type === enums.ItemType.MAGIC_BALL_NORMAL);
        if (normal && normal.count > 0) {
            return enums.ItemType.MAGIC_BALL_NORMAL;
        }

        const good = this.state.inventory.find(x => x.type === enums.ItemType.MAGIC_BALL_GOOD);
        if (good && good.count > 0) {
            return enums.ItemType.MAGIC_BALL_GOOD;
        }

        return -1;
    }

    async catchCreatures() {
        const client: Client = this.state.client;

        const range = this.state.player.avatar.activationRadius * 0.95;
        const wilds = this.state.map.creatures.wilds;
        if (wilds.length > 0) logger.debug(`${wilds.length} wild creature(s) around.`);
        for (const creature of wilds) {
            if (this.state.creatures.length >= this.state.player.storage.creatures) {
                logger.warn('Creature bag full!');
            } else if (this.getThrowBall() < 0) {
                logger.warn('Out of balls!');
            } else if (this.distance(creature) < range) {
                const name = strings.getCreature(enums.CreatureType[creature.name]);
                logger.debug('Try catching a wild ' + name);

                const info = await client.creatures.encounter(creature.id);
                if (info && !info.isCreatureStorageFull) {
                    let response: any = {};
                    let tries = 3;
                    while (!response.caught && !response.runAway && (tries-- > 0)) {
                        const ball = this.getThrowBall();
                        if (ball < 0) {
                            logger.warn('No more ball to throw.');
                            break;
                        }
                        await client.delay(this.config.delay.encouter * _.random(900, 1100));
                        response = await client.creatures.catch(creature.id,
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
    }

    async autoReleaseCreature(creature) {
        if (!this.config.behavior.autorelease) return;

        const creatures: objects.FUserCreature[] = this.state.creatures;
        const better = creatures.find(c =>
            c.name === creature.name &&
            (c.attackValue + c.staminaValue) > (creature.attackValue + creature.staminaValue) &&
            c.cp > creature.cp
        );
        if (better && !creature.isArenaDefender && !creature.isLibraryDefender && creature.group === 0) {
            await Bluebird.delay(this.config.delay.release * _.random(900, 1100));
            const client: Client = this.state.client;
            const response = await client.creatures.release([ creature.id ]);
            this.apihelper.parse(response);
            logger.info(`${creature.display} released.`);
            return response;
        } else {
            return null;
        }
    }

    async evolveperfect() {
        if (!this.config.behavior.evolveperfect) return;
        const creatures: objects.FUserCreature[] = this.state.creatures;
        for (const creature of creatures) {
            if (creature.attackValue >= 5 && creature.staminaValue >= 5 && creature.possibleEvolutions.size > 0) {
                const to = creature.possibleEvolutions.keys().next().value;
                const candiesNeeded = creature.possibleEvolutions.get(to);
                const candies = this.state.player.avatar.candies.get(creature.candyType);
                if (candies >= candiesNeeded) {
                    const client: Client = this.state.client;
                    const response = await client.creatures.evolve(creature.id, to);
                    this.apihelper.parse(response);
                    const from = (<any>creature).display || strings.getCreature(enums.CreatureType[creature.name]);
                    response.creature.display = strings.getCreature(enums.CreatureType[response.creature.name]);
                    logger.info(`Perfect ${from} evolved to ${response.creature.display}`);
                    await Bluebird.delay(this.config.delay.evolve * _.random(900, 1100));
                }
            }
        }
    }

    async getInventory() {
        const client: Client = this.state.client;
        const response = await client.inventory.getUserItems();
        this.apihelper.parse(response);
        for (const item of this.state.inventory) {
            if (!item.fulltype) {
                item.fulltype = enums.ItemType[item.type];
            }
            if (!item.display) {
                item.display = strings.getItem(item.fulltype);
            }
        }
        return this.state.inventory;
    }

    async getCreatures() {
        const client: Client = this.state.client;
        const response = await client.inventory.getUserCreatures();
        this.apihelper.parse(response);
        for (const creature of this.state.creatures) {
            if (!creature.display) {
                creature.display = strings.getCreature(enums.CreatureType[creature.name]);
            }
        }
        return this.state.creatures;
    }

    async dispatchRoostEggs() {
        if (!this.config.behavior.incubate) return;
        if (!this.state.player.avatar.dungeonId) return;
        try {
            const mod = this.state.map.buildings.find(b => b.type === enums.BuildingType.ROOST);
            if (mod) {
                const hatchInfo = await this.getHatchingInfo();
                const roost = hatchInfo.eggs.filter(e => e.isEggForRoost);

                // if some already hatching, move along (1 is max?)
                if (roost.length === 0 || roost.some(e => e.isHatching)) return;

                logger.info('Incube egg in mother of dragons.');
                const egg = roost[0] as objects.FEgg;
                const client: Client = this.state.client;
                const req = new objects.FBuildingRequest({
                    coords: new objects.GeoCoords({
                        latitude: this.state.pos.lat,
                        longitude: this.state.pos.lng,
                    }),
                    dungeonId: this.state.player.avatar.dungeonId,
                    id: mod.id,
                });
                await client.eggs.startHatchingEggInRoost(egg.id, req, 0);
                await client.delay(this.config.delay.incubator * _.random(900, 1100));
            }
        } catch (e) {
            logger.error(e);
            if (e.details && e.details.constructor.name !== 'IncomingMessage') {
                logger.error(e.details);
            }
        }
    }

    async dispatchIncubators() {
        if (!this.config.behavior.incubate) return;
        try {
            const hatchInfo = await this.getHatchingInfo();
            let freeIncub = hatchInfo.incubators.filter(i => !i.eggId && !i.roostBuildingId);
            let eggs = hatchInfo.eggs.filter(e => e.incubatorId === null && !e.isEggForRoost && !e.isHatching);
            if (freeIncub.length > 0 && eggs.length > 0) {
                logger.debug('Dispatch incubators');
                const client: Client = this.state.client;
                eggs = _.orderBy(eggs, 'totalDistance', 'asc');
                freeIncub = _.orderBy(freeIncub, 'usagesLeft', 'desc');
                const max = Math.min(eggs.length, freeIncub.length);
                for (let i = 0; i < max; i++) {
                    logger.info(`Start hatching a ${eggs[i].totalDistance / 1000}km egg.`);
                    await client.eggs.startHatchingEgg(eggs[i].id, freeIncub[i].incubatorId);
                    await client.delay(this.config.delay.incubator * _.random(900, 1100));
                }
            }
        } catch (e) {
            logger.error(e);
            if (e.details && e.details.constructor.name !== 'IncomingMessage') {
                logger.error(e.details);
            }
        }
    }

    async getHatchingInfo() {
        const client: Client = this.state.client;
        const response = await client.eggs.getHatchingInfo();
        this.apihelper.parse(response);
        return response;
    }

    async openChests() {
        const client: Client = this.state.client;
        for (const chest of this.state.map.chests) {
            const response = await client.openChest(chest);
            this.apihelper.parse(response);
            logger.info('Chest found!');
            this.state.socket.sendChest(chest);
        }
    }

    async leaveDungeon() {
        const client: Client = this.state.client;
        while (this.state.player.avatar.dungeonId) {
            logger.info('Leaving dungeon');
            await client.delay(2000);
            const response = await client.leaveDungeon(this.state.pos.lat, this.state.pos.lng);
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
