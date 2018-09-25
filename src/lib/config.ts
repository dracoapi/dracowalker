import * as fs from 'fs';
import * as logger from 'winston';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as path from 'path';
import YAML from 'yaml';

import { enums } from 'draconode';

function fixInventoryLimitConfig(config) {
    for (const item in config.inventory) {
        if (!Number.isInteger(+item)) {
            config.inventory[enums.ItemType[item]] = config.inventory[item];
            delete config.inventory[item];
        }
    }
}

module.exports.load = function() {
    let config: any = {
        credentials: {
            deviceid: '',
            userid: '',
            nickname: '',
        },
        pos: {
            lat: 48.8456222,
            lng: 2.3364526,
            save: false,
        },
        router: {
            name: 'human',
            followroads: true,
        },
        speed: 'auto',
        gmapKey: '',
        ui: {
            enabled: true,
        },
        behavior: {
            catch: true,
            autorelease: false,
            evolveperfect: false,
            incubate: true,
        },
        inventory: {

        },
        delay: {
            spin: 1,
            encounter: 1.5,
            catch: 3,
            incubator: 2.5,
            levelUp: 2,
            release: 0.1,
            evolve: 3,
            recycle: 0.5,
            useItem: 0.5,
        },
        proxy: {
            checkip: true,
            url: null,
        },
        database: { },
        log: {
            level: 'info',
            file: 'dracowalker.log',
        },
        errors: 0,
    };

    try {
        fs.mkdirSync('data');
    } catch (e) {}

    const argv = require('minimist')(process.argv.slice(2));
    const filename = argv.config || 'config.yaml';
    config.name = path.basename(filename, '.yaml');
    config.statename = `state${config.name.replace('config', '')}`;

    if (fs.existsSync(`data/${filename}`)) {
        const loaded = YAML.parse(fs.readFileSync(`data/${filename}`, 'utf8'));
        config = _.defaultsDeep(loaded, config);
    }

    if (typeof config.router === 'string') {
        let followroads = true;
        if (config.behavior.hasOwnProperty('followroads')) {
            followroads = config.behavior.followroads;
        }
        config.router = {
            name: config.router,
            followroads,
        };
    }

    logger.configure({
        level: config.log.level,
        format: logger.format.combine(
            logger.format.timestamp(),
            logger.format.printf(
                info => `[${moment(info.timestamp).format('HH:mm:ss')}] ${info.level} - ${info.message}`,
            ),
        ),
        transports: [
            new logger.transports.Console(),
            new logger.transports.File({
                'filename': `data/${config.log.file}`,
                'level': config.log.filelevel || config.log.level,
            }),
        ],
    });

    if (!fs.existsSync(`data/${filename}`)) {
        logger.warn(`Config file ${filename} does not exists, using default.`);
    } else {
        logger.debug(`Using config file ${filename}.`);
    }

    fixInventoryLimitConfig(config);

    // fs.writeFileSync('data/config.json', JSON.stringify(config, null, 2), 'utf8');

    if (!config.credentials.deviceId || (config.credentials.login && !config.credentials.username)) {
        logger.error('Invalid credentials. Please fill data/config.yaml.');
        logger.error('look at config.example.yaml for example.');
        process.exit();
    }

    if (config.pos.save && fs.existsSync(`data/position.json`)) {
        logger.info('Load position from file.');
        const pos = JSON.parse(fs.readFileSync(`data/position.json`, 'utf8'));
        pos.save = true;
        config.pos = pos;
    }

    return config;
};
