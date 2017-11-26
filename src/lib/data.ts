import { datastore } from 'nedb-promise';
import * as logger from 'winston';

const db = datastore({ filename: './data/stats.db', autoload: true });

export async function save(type: string, object: any) {
    try {
        await db.update({ type, 'object.id': object.id }, {
            type,
            object,
        }, { upsert: true });
    } catch (e) {
        logger.error('Error saving data to local db.');
        logger.error(e);
    }
}