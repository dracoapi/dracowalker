import * as logger from 'winston';
import * as _ from 'lodash';

import { Client, objects, enums } from 'draconode';
import * as dracoText from 'dracotext';

import * as database from './data';

const strings = dracoText.load('english');

/**
 * Helper class to deal with api requests and reponses.
 * Responsible for keeping state up to date.
 */
export default class APIHelper {
    config: any;
    state: any;

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
    }

    parse(response) {
        if (!response) return null;
        const info: any = {};

        if (response.__type === 'FAuthData') {
            this.state.api.config = response.config;
            if (this.config.speed === 'auto') {
                this.config.speed = 0.9 * response.config.avatarMoveRunSpeed;
                logger.debug(`Auto speed set to ${this.config.speed.toFixed(1)} km/h`);
            }
            this.state.player.id = response.info.userId;
            this.state.player.nickname = response.info.nickname;
            // avatar: response.info.avatarAppearanceDetails,
        } else if (response.__type === 'FBagUpdate') {
            if (response.allowedItemsSize) this.state.player.storage.items = response.allowedItemsSize;
            this.state.inventory = response.items;
        } else if (response.__type === 'FHatchingResult') {
            this.state.player.avatar = response.avaUpdate;
            this.state.creatures.push(response.creature);
            this.checkLoot(response);
        } else if (response.__type === 'FUpdate') {
            for (const item of response.items) {
                if (item.__type === 'FPickItemsResponse') {
                    this.checkLoot(item);
                } else if (item.__type === 'FTransferMonsterToCandiesResponse') {
                    this.checkLoot(item);
                } else if (item.__type === 'FAvaUpdate') {
                    this.state.player.avatar = item;
                } else if (item.__type === 'FBuilding') {
                    const building = this.state.map.buildings.find(b => b.id === item.id);
                    if (building) {
                        Object.assign(building, item);
                    }
                    info.building = item;
                } else if (item.__type === 'FBuildingUpdate') {
                    const buildingUpdate = item as objects.FBuildingUpdate;
                    let buildings = [];
                    buildings = Array.from(buildingUpdate.tileBuildings.values());
                    buildings = buildings.filter(t => t.buildings).map(t => t.buildings);
                    buildings = _.union.apply(null, buildings);
                    buildings = _.uniqBy(buildings, 'id');
                    this.state.map.buildings = buildings;
                } else if (item.__type === 'FCreatureUpdate') {
                    this.state.map.creatures = item;
                } else if (item.__type === 'FDungeonUpdate') {
                    // nothing?
                } else {
                    logger.warn('Unhandled fupdate item: ' + item.__type);
                }
            }
        } else if (response.__type === 'FCatchCreatureResult') {
            this.state.player.avatar = response.avaUpdate;
            this.checkLoot(response);
        } else if (response.__type === 'FUserCreaturesList') {
            this.state.creatures = response.userCreatures;
        } else if (response.__type === 'FUserCreatureUpdate') {
            this.state.player.avatar = response.avaUpdate;
            this.state.creatures = this.state.creatures.filter(c => c.id !== response.creature.id);
            this.state.creatures.push(response.creature);
            this.checkLoot(response);
        } else if (response.__type === 'FOpenChestResult') {
            if (this.config.database.save && response.loot) {
                database.save('chest', response.loot);
            }
            this.checkLoot(response);
        } else if (response.__type === 'FCreadex') {
            // nothing to do
        } else if (response.__type === 'FUserHatchingInfo') {
            // save to state, usefull for debugging
            const hatch = response as objects.FUserHatchingInfo;
            this.state.hatch = {
                incubators: hatch.incubators,
                eggs: hatch.eggs,
            };
        } else {
            logger.warn('Unhandled response: ' + response.__type);
        }

        return info;
    }

    parseMapUpdate(response) {
        const info: any = {};
        if (!response) return info;
        if (response.__type === 'FUpdate') {
            this.state.map = {};
            for (const item of response.items) {
                if (item.__type === 'FBuildingUpdate') {
                    // buildings
                    const buildingUpdate = item as objects.FBuildingUpdate;
                    if (buildingUpdate) {
                        let buildings = [];
                        buildings = Array.from(buildingUpdate.tileBuildings.values());
                        buildings = buildings.filter(t => t.buildings).map(t => t.buildings);
                        buildings = _.union.apply(null, buildings);
                        buildings = _.uniqBy(buildings, 'id');
                        this.state.map.buildings = buildings;
                    }
                } else if (item.__type === 'FAvaUpdate') {
                    // avatar
                    const avatar = item as objects.FAvaUpdate;
                    this.state.player.avatar = avatar;
                    this.state.player.storage.creatures = this.state.player.avatar.creatureStorageSize;
                } else if (item.__type === 'FHatchedEggs') {
                    // eggs
                    const hatchInfo = item as objects.FHatchedEggs;
                    if (hatchInfo && hatchInfo.incubatorId) {
                        const egg: objects.FEgg = hatchInfo.egg;
                        if (egg.passedDistance >= egg.totalDistance) {
                            // open it in a few
                            this.state.todo.push({
                                call: 'open_egg',
                                incubatorId: hatchInfo.incubatorId,
                            });
                        }
                    }
                    this.state.map.hatched = hatchInfo;
                } else if (item.__type === 'FAllianceChooseRequest') {
                    // alliance
                    const chooseAlliance = item as objects.FAllianceChooseRequest;
                    if (chooseAlliance && this.config.behavior.autoalliance) {
                        let alliance = this.config.behavior.autoalliance;
                        if (!Number.isInteger(+alliance)) {
                            alliance = enums.AllianceType[alliance.toUpperCase()];
                        }
                        if (!Number.isInteger(alliance)) {
                            logger.error('Invalid alliance choice', this.config.behavior.autoalliance);
                        } else {
                            this.state.todo.push({
                                call: 'select_alliance',
                                bonus: chooseAlliance.bonus,
                                alliance,
                            });
                        }
                    } else {
                        logger.warn('Time to select an alliance, configure behavior.autoalliance to do it.');
                    }
                } else if (item.__type === 'FChestUpdate') {
                    this.state.map.chests = item.chests;
                } else if (item.__type === 'FCreatureUpdate') {
                    this.state.map.creatures = item;
                } else if (item.__type === 'FEncounterDetails') {
                    // wild encounter
                    info.encounter = item;
                } else if (item.__type === 'FArenaWithBattleUpdate') {
                    // todo
                } else if (item.__type === 'FDungeonUpdate') {
                    // nothing?
                } else {
                    logger.warn('Unhandled object in map update: ' + item.__type);
                }
            }

            if (this.config.database.save) {
                const wilds = this.state.map.creatures.wilds;
                for (const wild of wilds) {
                    database.save('wild', wild);
                }
            }
        }

        return info;
    }

    checkLoot(item: any) {
        if (item.loot && item.loot.lootList.length > 0) {
            logger.debug('Loot:');
            this.logLoot(item.loot);
        }
        if (item.levelUpLoot && item.levelUpLoot.lootList.length > 0) {
            logger.debug('Level up loot:');
            this.logLoot(item.levelUpLoot);
            this.state.socket.sendPlayerStats();
        }
    }

    logLoot(loot: objects.FLoot) {
        for (const item of loot.lootList) {
            if (item.__type === 'FLootItemCandy') {
                const candyType = (item as objects.FLootItemCandy).candyType;
                const creature = strings.getCreature(enums.CreatureType[candyType]);
                logger.debug(`  ${item.qty} ${creature} candies.`);
            } else if (item.__type === 'FLootItemItem') {
                const itemType = (item as objects.FLootItemItem).item;
                const type = enums.ItemType[itemType];
                let dropItem = strings.getItem(type);
                if (type.indexOf('EGG_KM_') === 0) {
                    dropItem = `${type.substr('EGG_KM_'.length)} km ` + strings.getItem('EGG');
                }
                logger.debug(`  ${item.qty} ${dropItem}.`);
            } else if (item.__type === 'FLootItemExp') {
                logger.debug(`  ${item.qty} exp.`);
            } else if (item.__type === 'FLootItemDust') {
                logger.debug(`  ${item.qty} dust.`);
            } else if (item.__type === 'FLootItemBuff') {
                const buff = (item as objects.FLootItemBuff).buff;
                const info = strings.get('key.buff.' + enums.BuffType[buff.type]);
                logger.debug(`  Buff received. ${info}.`);
            } else {
                logger.debug('Loot unhandled:');
                logger.debug(JSON.stringify(item, null, 2));
            }
        }
    }

    async startingEvents() {
        const client: Client = this.state.client;
        for (let i = 0; i < 21; i++) {
            await client.event('LoadingScreenPercent', '100');
        }
        await client.event('DestroyLoadingScreen');
    }
}
