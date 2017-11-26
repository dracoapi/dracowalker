import * as logger from 'winston';
import * as _ from 'lodash';
import * as fs from 'mz/fs';

import * as database from './data';

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
        } else if (response.__type === 'FUpdate') {
            for (const item of response.items) {
                if (item.__type === 'FPickItemsResponse') {
                    // logger.debug('Loot', item);
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
        } else if (response.__type === 'FUserCreaturesList') {
            this.state.creatures = response.userCreatures;
        } else if (response.__type === 'FCreadex') {
            // nothing to do
        } else {
            logger.warn('Unhandled response: ' + response.__type);
        }

        return info;
    }

    parseMapUpdate(response) {
        if (!response) return;
        if (response.__type === 'FUpdate') {
            let buildings = [];
            const buildingUpdate = response.items.find(o => o.__type === 'FBuildingUpdate');
            if (buildingUpdate) {
                buildings = Array.from(buildingUpdate.tileBuildings.values());
                buildings = buildings.filter(t => t.buildings).map(t => t.buildings);
                buildings = _.union.apply(null, buildings);
                buildings = _.uniqBy(buildings, 'id');
            }
            const avatar = response.items.find(o => o.__type === 'FAvaUpdate');
            this.state.player.avatar = avatar;
            this.state.player.storage.creatures = this.state.player.avatar.creatureStorageSize;

            this.state.map = {
                creatures: response.items.find(o => o.__type === 'FCreatureUpdate'),
                hatched: response.items.find(o => o.__type === 'FHatchedEggs'),
                chests: response.items.find(o => o.__type === 'FChestUpdate'),
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
}
