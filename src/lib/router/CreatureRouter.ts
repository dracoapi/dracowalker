import * as _ from 'lodash';
import * as logger from 'winston';
import * as DracoNode from 'draconode';
import { BaseRouter, Target } from './BaseRouter';

export default class CreatureRouter extends BaseRouter {
    async checkPath(): Promise<Target[]> {
        if (this.state.path.waypoints.length === 0) {
            if (this.state.path.target) {
                // we arrive at target
                this.state.path.visited.push(this.state.path.target.id);
            }
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
            if (this.distance(target) > 10) {
                await this.generateWaypoint(target);
            } else {
                state.path.waypoints = [target];
            }
            return state.path.waypoints;
        }

        return null;
    }

    async findNextTarget() {
        if (!this.state.map) return null;

        // todo - query wilds and inRadar look for catchQuantity == 0
        // todo, if not enough ball, try to spin stop

        let wilds: any[] = this.state.map.creatures.wilds;

        if (wilds.length > 1) {
            // order by distance
            _.each(wilds, pk => pk.distance = this.distance(pk));
            wilds = _.orderBy(wilds, 'distance');
        }

        // take closest
        if (wilds.length > 0) {
            return new Target({
                id: wilds[0].id,
                lat: wilds[0].coords.latitude,
                lng: wilds[0].coords.longitude,
            });
        }

        // if no wilds, go to radar
        let inradar: any[] = this.state.map.creatures.inRadar;

        if (inradar.length > 1) {
            // order by distance
            _.each(inradar, pk => pk.distance = this.distance(pk));
            inradar = _.orderBy(inradar, 'distance');
        }

        // take closest
        if (inradar.length > 0) {
            return new Target({
                id: inradar[0].id,
                lat: inradar[0].coords.latitude,
                lng: inradar[0].coords.longitude,
            });
        }

        // if no radar, find a stop to spin
        return this.findClosestStop();
    }

    findClosestStop() {
        let buildings: any[] = this.state.map.buildings;
        buildings = buildings.filter(b => b.type === DracoNode.enums.BuildingType.STOP &&
            b.available && b.pitstop && !b.pitstop.cooldown &&
            this.state.path.visited.indexOf(b.id) < 0);

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