import * as _ from 'lodash';
import { enums } from 'draconode';
import { BaseRouter, Target } from './BaseRouter';

export default class HumanRouter extends BaseRouter {
    async checkPath(): Promise<Target[]> {
        return await this.generatePath();
    }

    async generatePath() {
        const state = this.state;
        const target = await this.findNextTarget();
        if (target) {
            if (state.path.waypoints.length === 0 || (!state.path.target || target.lat !== state.path.target.lat || target.lng !== state.path.target.lng)) {
                state.path.target = target;
                await this.generateWaypoint(target);
                return state.path.waypoints;
            }
        }

        return null;
    }

    async findNextTarget() {
        if (!this.state.map) return null;

        const balls =  this.state.inventory.filter(x => x.type === enums.ItemType.MAGIC_BALL_SIMPLE ||
                                                        x.type === enums.ItemType.MAGIC_BALL_NORMAL ||
                                                        x.type === enums.ItemType.MAGIC_BALL_GOOD);
        const ballCount = _.reduce(balls, (sum, i) => sum + i.count, 0);

        // if not enough balls, find a stop to spin
        if (ballCount < 5) {
            const stop = this.findClosestBuilding(true);
            if (stop) return stop;
        }

        const stop = this.findClosestBuilding();
        const creature = this.findClosestCreature();
        const chest = this.findClosestChest();

        return _.orderBy([stop, creature, chest].filter(o => o != null), 'distance', 'asc')[0];
    }

    findClosestChest() {
        if (this.state.map.chests.length <= 0) return null;

        let chests = this.state.map.chests;
        for (const chest of chests) {
            if (!chest.distance) chest.distance = this.distance(chest);
        }

        chests = _.orderBy(chests, 'distance', 'asc');
        return new Target({
            id: chests[0].id,
            lat: chests[0].coords.latitude,
            lng: chests[0].coords.longitude,
            distance: chests[0].distance,
        });
    }

    findClosestCreature() {
        let allCreatures = this.state.map.creatures.wilds.concat(this.state.map.creatures.inRadar);
        if (!allCreatures) return null;

        allCreatures = _.uniqBy(allCreatures, 'id');
        if (allCreatures.length > 0) {
            for (const creature of allCreatures) {
                creature.distance = this.distance(creature);
            }
            allCreatures = _.orderBy(allCreatures, 'distance', 'asc');
            // take closest
            return new Target({
                id: allCreatures[0].id,
                lat: allCreatures[0].coords.latitude,
                lng: allCreatures[0].coords.longitude,
                distance: allCreatures[0].distance,
            });
        }
        return null;
    }

    findClosestBuilding(includeVisited = false) {
        let buildings: any[] = this.state.map.buildings;
        if (!buildings) return null;

        const types = [ enums.BuildingType.STOP, enums.BuildingType.PORTAL, enums.BuildingType.DUNGEON_STOP ];
        buildings = buildings.filter(b => types.includes(b.type) && b.available &&
            (!b.pitstop || (b.pitstop && !b.pitstop.cooldown)) &&
            (includeVisited || this.state.path.visited.indexOf(b.id) < 0));

        if (buildings.length > 0) {
            _.each(buildings, pk => pk.distance = this.distance(pk));
            buildings = _.orderBy(buildings, 'distance', 'asc');

            return new Target({
                id: buildings[0].id,
                lat: buildings[0].coords.latitude,
                lng: buildings[0].coords.longitude,
                distance: buildings[0].distance,
            });
        }

        return null;
    }
}