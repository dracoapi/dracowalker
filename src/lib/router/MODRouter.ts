import * as logger from 'winston';

import { BaseRouter, Target } from './BaseRouter';
import { objects } from 'draconode';
import Player from '../player';

export default class MODRouter extends BaseRouter {
    first = true;
    target: Target;
    mod: objects.FBuilding;
    player: Player;
    previous: BaseRouter;

    constructor(config, state, mod: objects.FBuilding , player: Player) {
        super(config, state);
        this.mod = mod;
        this.target = new Target({
            id: mod.id,
            lat: mod.coords.latitude,
            lng: mod.coords.longitude,
        });
        this.player = player;
        this.previous = state.walker.router;
    }

    async checkPath(): Promise<Target[]> {
        if (this.state.path.waypoints.length === 0) {
            if (this.first) {
                this.first = false;
                await this.generateWaypoint(this.target);
                return this.state.path.waypoints;
            } else {
                // we arrive at target, roost egg and leave dungeon
                try {
                    await this.player.dispatchRoostEggs();
                } catch (e) {
                    this.oups(e);
                }
                try {
                    await this.player.leaveDungeon();
                } catch (e) {
                    this.oups(e);
                }

                this.state.walker.router = this.previous;
                return this.state.walker.router.checkPath();
            }
        }
        // do nothing
        return null;
    }

    oups(e) {
        logger.error('Unable to spin');
        logger.error(e);
        if (e.details && e.details.constructor.name !== 'IncomingMessage') {
            logger.error(e.details);
        }
    }
}