import * as logger from 'winston';
import * as _ from 'lodash';

import * as DracoNode from 'draconode';
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
            // nothing to do here
        } else {
            logger.warn('Unhandled response: ' + response.__type);
        }

        return info;
    }

    parseMapUpdate(response) {
        if (!response) return;
        if (response.__type === 'FUpdate') {
            // buildings
            let buildings = [];
            const buildingUpdate = response.items.find(o => o.__type === 'FBuildingUpdate');
            if (buildingUpdate) {
                buildings = Array.from(buildingUpdate.tileBuildings.values());
                buildings = buildings.filter(t => t.buildings).map(t => t.buildings);
                buildings = _.union.apply(null, buildings);
                buildings = _.uniqBy(buildings, 'id');
            }

            // avatar
            const avatar: DracoNode.objects.FAvaUpdate = response.items.find(o => o.__type === 'FAvaUpdate');
            this.state.player.avatar = avatar;
            this.state.player.storage.creatures = this.state.player.avatar.creatureStorageSize;

            // eggs
            const hatchInfo = response.items.find(o => o.__type === 'FHatchedEggs');
            if (hatchInfo && hatchInfo.incubatorId) {
                const egg: DracoNode.objects.FEgg = hatchInfo.egg;
                if (egg.passedDistance >= egg.totalDistance) {
                    // open it in a few
                    this.state.todo.push({
                        call: 'open_egg',
                        incubatorId: egg.incubatorId,
                    });
                }
            }

            // encounter
            const encounter = response.items.find(o => o.__type === 'FEncounterDetails');
            if (encounter) {
                logger.warn(`You're being attacked!`);
                // logger.info(JSON.stringify(encounter, null, 2));
            }

            // save state
            this.state.map = {
                creatures: response.items.find(o => o.__type === 'FCreatureUpdate'),
                hatched: response.items.find(o => o.__type === 'FHatchedEggs'),
                chests: response.items.find(o => o.__type === 'FChestUpdate').chests,
                buildings,
            };

            if (this.config.database.save) {
                const wilds = this.state.map.creatures.wilds;
                for (const wild of wilds) {
                    database.save('wild', wild);
                }
            }
        }
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

    logLoot(loot: DracoNode.objects.FLoot) {
        for (const item of loot.lootList) {
            if (item.__type === 'FLootItemCandy') {
                const candyType = (item as DracoNode.objects.FLootItemCandy).candyType;
                const creature = strings.getCreature(DracoNode.enums.CreatureType[candyType]);
                logger.debug(`  ${item.qty} ${creature} candies.`);
            } else if (item.__type === 'FLootItemItem') {
                const itemType = (item as DracoNode.objects.FLootItemItem).item;
                const type = DracoNode.enums.ItemType[itemType];
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
                logger.warn(item);
                const buff = (item as DracoNode.objects.FLootItemBuff).buff;
                const info = strings.get('key.buff.' + DracoNode.enums.BuffType[buff.type]);
                logger.debug(` Buff received. ${info}`);
            } else {
                logger.debug('Loot unhandled:');
                logger.debug(JSON.stringify(item, null, 2));
            }
        }
    }

    async startingEvents() {
        const client: DracoNode.Client = this.state.client;
        for (let i = 0; i < 21; i++) {
            await client.event('LoadingScreenPercent', '100');
        }
        await client.event('DestroyLoadingScreen');
    }
}
