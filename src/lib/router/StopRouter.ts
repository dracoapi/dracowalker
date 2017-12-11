import * as _ from 'lodash';
import * as logger from 'winston';
import * as DracoNode from 'draconode';
import { BaseRouter, Target } from './BaseRouter';

export default class StopRouter extends BaseRouter {
    async checkPath(): Promise<Target[]> {
        if (this.state.path.waypoints.length === 0) {
            // get a new target and path to go there
            return await this.generatePath();
        }
        // do nothing
        return null;
    }

    async generatePath() {
        logger.debug('Get new path.');

        const state = this.state;
        const target = state.path.target = await this.findNextTarget();

        if (target) {
            await this.generateWaypoint(target);
            return state.path.waypoints;
        }

        return null;
    }

    async findNextTarget() {
        if (!this.state.map) return null;

        // get stop builing not already visited or in cooldown
        let buildings: any[] = this.state.map.buildings;
        buildings = buildings.filter(b => b.type === DracoNode.enums.BuildingType.STOP &&
                                            b.available && b.pitstop && !b.pitstop.cooldown &&
                                            this.state.path.visited.indexOf(b.id) < 0);

        if (buildings.length > 1) {
            // order by distance
            _.each(buildings, pk => pk.distance = this.distance(pk));
            buildings = _.orderBy(buildings, 'distance', 'asc');
        }

        // take closest
        if (buildings.length > 0) {
            return new Target({
                id: buildings[0].id,
                lat: buildings[0].coords.latitude,
                lng: buildings[0].coords.longitude,
            });
        } else {
            return null;
        }
    }
}