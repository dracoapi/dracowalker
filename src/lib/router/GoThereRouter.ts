import { BaseRouter, Target } from './BaseRouter';

export default class GoThereRouter extends BaseRouter {
    first = true;
    target: Target;
    previous: BaseRouter;

    constructor(config, state, target, previous) {
        super(config, state);
        this.target = target;
        this.previous = previous;
    }

    async checkPath(): Promise<Target[]> {
        if (this.state.path.waypoints.length === 0) {
            if (this.first) {
                this.first = false;
                await this.generateWaypoint(this.target);
                return this.state.path.waypoints;
            } else {
                // we arrive at target
                this.state.walker.router = this.previous;
                return this.state.walker.router.checkPath();
            }
        }
        // do nothing
        return null;
    }
}