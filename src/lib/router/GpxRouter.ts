import { promises as fs } from 'fs';
import * as xml2js from 'xml2js-es6-promise';

import { fileExists } from '../../utils';
import { BaseRouter, Target } from './BaseRouter';

export default class GpxRouter extends BaseRouter {
    initdone = false;
    steps: Target[];
    idx = 0;

    async init() {
        this.initdone = true;
        const gpxfile = this.config.router.gpx;
        if (!gpxfile || !fileExists(`data/${gpxfile}`)) {
            throw new Error('GPX file not defined or does not exists.');
        }

        const xml = await fs.readFile(`data/${gpxfile}`, 'utf8');
        const data = await xml2js(xml, { trime: true });
        if (!data.gpx || !data.gpx.wpt) throw new Error('Invalid GPX file');

        this.steps = Array.from(data.gpx.wpt, e => new Target({lat: +e['$'].lat, lng: +e['$'].lon}));
        if (this.steps.length > 0) {
            this.state.pos = this.steps[0];
            this.idx = (this.idx + 1) % this.steps.length;
        }
    }

    async checkPath(): Promise<Target[]> {
        if (!this.initdone) await this.init();
        if (this.state.path.waypoints.length === 0) {
            const target = this.state.path.target = this.steps[this.idx];
            this.idx = (this.idx + 1) % this.steps.length;
            this.state.path.waypoints = [ target ];
            return [ target ];
        } else {
            return null;
        }
    }
}