import * as _ from 'lodash';
import * as logger from 'winston';
import * as DracoNode from 'draconode';
import { IRouter, Target } from './IRouter';

const geolib = require('geolib');

export default class CreatureRouter extends IRouter {
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

        let wilds: any[] = this.state.map.creatures.wilds;
        //wilds = wilds.filter(b => b.caughtQuantity == 0);
        //logger.info(wilds.length);

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

        // if no wilds, go to stops
        let buildings: any[] = this.state.map.buildings;
        buildings = buildings.filter(b => b.type === DracoNode.enums.BuildingType.STOP &&
            b.available && b.pitstop && !b.pitstop.cooldown &&
            this.state.path.visited.indexOf(b.id) < 0);
    
        //if (buildings.length > 1) {
        //    // order by further distance to get to new area
        //    _.each(buildings, pk => pk.distance = this.distance(pk));
        //    buildings = _.orderBy(buildings, 'distance', 'desc');
        //}

        if (buildings.length > 0)
        {
            return new Target({
                id: buildings[0].id,
                lat: buildings[0].coords.latitude,
                lng: buildings[0].coords.longitude,
            });
        }
        else {
            return null;
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