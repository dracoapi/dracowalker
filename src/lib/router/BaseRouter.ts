const GoogleMapsAPI = require('googlemaps');
const geolib = require('geolib');

export class Target {
    id: string;
    lat: number;
    lng: number;
    distance: number;

    public constructor(init?: Partial<Target>) {
        Object.assign(this, init);
    }
}

export abstract class BaseRouter {
    config: any;
    state: any;

    constructor(config, state) {
        this.config = config;
        this.state = state;
    }

    /**
     * Check if path is valid and generate a new one if needed
     */
    abstract checkPath(): Promise<Target[]>;

    /**
     * Generate waypoint
     */
    async generateWaypoint(target: Target) {
        const state = this.state;
        if (this.config.behavior.followroads && this.distance(target) > 10) {
            const gmAPI = new GoogleMapsAPI({
                key: this.config.gmapKey,
            });
            const result = await gmAPI.directionsAsync({origin: `${state.pos.lat},${state.pos.lng}`, destination: `${target.lat},${target.lng}`, mode: 'walking'});
            if (result.error_message) throw new Error(result.error_message);
            state.path.waypoints = [];
            if (result.routes.length > 0 && result.routes[0].legs) {
                for (const leg of result.routes[0].legs) {
                    for (const step of leg.steps) {
                        state.path.waypoints.push(new Target(step.end_location));
                    }
                }
            }
            state.path.waypoints.push(target);
        } else {
            state.path.waypoints = [target];
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