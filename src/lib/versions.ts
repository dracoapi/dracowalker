import * as logger from 'winston';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as request from 'request-promise-native';
import * as semver from 'semver';

import { fileExists } from '../utils';

let _version: string;

export async function getVersion(): Promise<string> {
    if (!_version) {
        const file = path.join(__dirname, '../../version');
        if (!process['pkg']) {
            _version = 'source';
        } else if (!fileExists(file)) {
            _version = 'unknown';
        } else {
            let content: string = await fs.readFile(file, 'utf8');
            if (content.charCodeAt(0) === 0xFEFF) {
                content = content.slice(1);
            }
            _version = content;
        }
    }
    return _version;
}

export async function print() {
    const version = await getVersion();
    if (version === 'source') {
        logger.info('Launched from source');
    } else if (version === 'unknown') {
        logger.info('Launched from binary, version not found');
    } else {
        logger.info('Launched from binary, version ' + version);
    }
}

export async function checkLatest() {
    const version = await getVersion();
    if (version === 'source') return;
    if (version.startsWith('dev-')) {
        // binary from appveyor, check if there is a new one
        const url = 'https://ci.appveyor.com/api/projects/niicojs/dracowalker';
        const info = await request.get({
            url,
            json: true,
        });
        const current = +version.replace('dev-1.0.', '');
        const latest = +info.build.buildNumber;
        if (info.build.status === 'success' && latest > current) {
            logger.warn(`A new version (${latest}) is available, check https://ci.appveyor.com/project/niicojs/dracowalker/build/artifacts`);
        }
    } else {
        // binary from github release, check if there is a new one
        const url = 'https://api.github.com/repos/dracoapi/dracowalker/releases/latest';
        const info = await request.get({
            url,
            json: true,
            headers: {
                'User-Agent': 'dracowalker',
            }
        });
        const latest = info.tag_name;
        if (semver.gt(latest, version)) {
            logger.warn(`A new version (${latest}) is available, check https://github.com/dracoapi/dracowalker/releases`);
        }
    }
}