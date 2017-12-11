import * as _ from 'lodash';
import * as DracoNode from 'draconode';
import { BaseRouter, Target } from './BaseRouter';

export default class HumanRouter extends BaseRouter {
    async checkPath(): Promise<Target[]> {
        // generate a new path every few seconds
        return await this.generatePath();
    }

    async generatePath() {
        const state = this.state;
        const target = await this.findNextTarget();
        if (target && (!state.path.target || target.lat !== state.path.target.lat || target.lng !== state.path.target.lng)) {
            state.path.target = target;
            await this.generateWaypoint(target);
            return state.path.waypoints;
        }

        return null;
    }

    async findNextTarget() {
        if (!this.state.map) return null;

        const balls =  this.state.inventory.filter(x => x.type === DracoNode.enums.ItemType.MAGIC_BALL_SIMPLE ||
                                                        x.type === DracoNode.enums.ItemType.MAGIC_BALL_NORMAL ||
                                                        x.type === DracoNode.enums.ItemType.MAGIC_BALL_GOOD);
        const ballCount = _.reduce(balls, (sum, i) => sum + i.count, 0);

        // if not enough balls, find a stop to spin
        if (ballCount < 5) {
            const stop = this.findClosestStop();
            if (stop) return stop;
        }

        const stop = this.findClosestStop();
        const creature = this.findClosestCreature();
        const chest = this.findClosestChest();

        return _.orderBy([stop, creature, chest].filter(o => o), 'distance', 'asc')[0];
    }

    findClosestChest() {
        if (this.state.map.chests.length <= 0) return null;

        let chests: DracoNode.objects.FChest[] = this.state.map.chests;
        chests = _.orderBy(chests, 'distance', 'asc');
        return new Target({
            id: chests[0].id,
            lat: chests[0].coords.latitude,
            lng: chests[0].coords.longitude,
        });
    }

    findClosestCreature() {
        let allCreatures = this.state.map.creatures.wilds.concat(this.state.map.creatures.inRadar);
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
            });
        }
        return null;
    }

    findClosestStop() {
        let buildings: any[] = this.state.map.buildings;
        buildings = buildings.filter(b => b.type === DracoNode.enums.BuildingType.STOP &&
            b.available && b.pitstop && !b.pitstop.cooldown &&
            this.state.path.visited.indexOf(b.id) < 0);

        if (buildings.length > 1) {
            // order by distance
            _.each(buildings, pk => pk.distance = this.distance(pk));
            buildings = _.orderBy(buildings, 'distance', 'asc');
        }

        if (buildings.length > 0) {
            return new Target({
                id: buildings[0].id,
                lat: buildings[0].coords.latitude,
                lng: buildings[0].coords.longitude,
            });
        }

        return null;
    }
}