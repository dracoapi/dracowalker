import * as Bluebird from 'bluebird';
import * as logger from 'winston';

const GoogleMapsAPI = require('googlemaps');
const geolib = require('geolib');

Bluebird.promisifyAll(GoogleMapsAPI.prototype);

import APIHelper from './api';
import { BaseRouter } from './router/BaseRouter';
import StopRouter from './router/StopRouter';
import StadStillRouter from './router/StandStillRouter';
import CreatureRouter from './router/CreatureRouter';
import HumanRouter from './router/HumanRouter';

/**
 * Helper class to deal with our walker.
 */
export default class Walker {
    config: any;
    state: any;
    apihelper: APIHelper;
    router: BaseRouter;

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.apihelper = new APIHelper(config, state);
        if (config.router === 'human') {
            this.router = new HumanRouter(config, state);
        } else if (config.router === 'stops') {
            this.router = new StopRouter(config, state);
        } else if (config.router === 'stand') {
            this.router = new StadStillRouter(config, state);
        } else if (config.router === 'creatures') {
            this.router = new CreatureRouter(config, state);
        } else {
            logger.warn(`Unknown router '${this.router}', using 'stops`);
            this.router = new StopRouter(config, state);
        }
    }

    /**
     * Check is current path is still valid, generate a new path if not.
     * Update state if needed.
     * @return {Promise<any>}
     */
    async checkPath() {
        return this.router.checkPath();
    }

    /**
     * Move toward target, get call each second or so.
     * Update state.
     */
    walk(): void {
        if (this.config.speed === 0 || !this.state.path || this.state.path.waypoints.length === 0) return;

        // move towards next target
        const dest = this.state.path.waypoints[0];
        let speed = this.config.speed;
        speed += (Math.random() - 0.5) * speed * 0.1;
        const speedms = speed / 3.6;
        let dist = this.distance(dest);
        const step = dist / speedms;

        const newpos = {
            lat: this.state.pos.lat + (dest.lat - this.state.pos.lat) / step,
            lng: this.state.pos.lng + (dest.lng - this.state.pos.lng) / step,
        };
        this.state.pos = this.fuzzedLocation(newpos);

        // if we get close to the next point, remove it from the targets
        dist = this.distance(this.state.path.waypoints[0]);
        if (dist < 5) this.state.path.waypoints.shift();
    }

    /**
     * Calculte distance from current pos to a target.
     * @param {object} target position
     * @return {int} distance to target
     */
    distance(target): number {
        try {
            if (!target.latitude && target.coords) target = target.coords;
            return geolib.getDistance(this.state.pos, target, 1, 1);
        } catch (e) {
            logger.error('Error in walker.distance');
            logger.error(JSON.stringify(this.state.pos, null, 2));
            logger.error(JSON.stringify(target, null, 2));
            throw e;
        }
    }

    /**
     * Return a random float number between 2 numbers
     * @param {float} min minimum value
     * @param {float} max maximum value
     * @return {float} random value
     */
    randGPSFloatBetween(min: number, max: number): number {
        return parseFloat((Math.random() * (max - min) + min).toFixed(14));
    }

    /**
     * Fuzz a gps location in order to make walking path real
     * @param {object} latlng location
     * @return {object} fuzzed location
     */
    fuzzedLocation(latlng) {
        return {
            lat: parseFloat((latlng.lat + this.randGPSFloatBetween(-0.0000009, 0.0000009)).toFixed(14)),
            lng: parseFloat((latlng.lng + this.randGPSFloatBetween(-0.0000009, 0.0000009)).toFixed(14)),
        };
    }

    /**
     * Get altitude from locaztion
     * @param {object} latlng location
     * @return {Promise<altitude>} Promise returning altitude
     */
    async getAltitude(latlng): Promise<number> {
        try {
            const gmAPI = new GoogleMapsAPI({
                key: this.config.gmapKey,
            });
            const data = await gmAPI.elevationFromLocationsAsync({
                locations: `${latlng.lat},${latlng.lng}`,
            });
            if (data && data.results.length > 0) {
                return data.results[0].elevation;
            } else {
                return 0;
            }
        } catch (e) {
            logger.warn('Unable to get altitude.', e);
            return 0;
        }
    }
}
