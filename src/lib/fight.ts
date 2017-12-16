import * as _ from 'lodash';
import * as logger from 'winston';

import { Client, objects, enums } from 'draconode';
import * as dracoText from 'dracotext';
const strings = dracoText.load('english');

import APIHelper from './api';

export default class Fight {
    config: any;
    state: any;
    apihelper: APIHelper;
    client: Client;

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.apihelper = new APIHelper(config, state);
        this.client = this.state.client;
    }

    async getFighter() {
        const response = await this.client.call('BattleService', 'getPossibleArenaAttackers', []);
        if (response && response.userCreatures) {
            let creatures: objects.FUserCreature[] = response.userCreatures;
            creatures = creatures.filter(c => !c.isArenaDefender && c.hp > 1);
            if (creatures.length > 0) {
                creatures = _.orderBy(creatures, 'cp', 'desc');
                return creatures[0];
            }
        }
        return null;
    }

    async fight(creature: objects.FEncounterDetails) {
        const fighter = await this.getFighter();
        if (!fighter) return null;

        const level = fighter.level / 2;
        let display = (<any>fighter).display;
        if (!display) display = strings.getCreature(enums.CreatureType[fighter.name]);
        logger.info(`Fighter picked: level ${level} ${display}`);

        const eu = await this.client.fight.start(new objects.FStartEncounterRequest({
            defenderId: creature.id,
            attackerId: fighter.id,
        }));
        console.log(eu);

        await this.client.delay(_.random(500, 1500));

        const giveup = await this.client.fight.giveUp();
        console.log(giveup);
    }
}