import * as logger from 'winston';
import * as fs from 'mz/fs';
import * as path from 'path';

export async function print() {
    if (!process['pkg']) {
        logger.info('Run from source');
    } else {
        const file = path.join(__dirname, '../../version');
        if (!fs.existsSync(file)) {
            logger.info('Run from binary, version not found');
        } else {
            let version: string = await fs.readFile(file, 'utf8');
            if (version.charCodeAt(0) === 0xFEFF) {
                version = version.slice(1);
            }
            logger.info('Run from binary, version ' + version);
        }
    }
}