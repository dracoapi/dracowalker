import { existsSync } from 'fs';

export function fileExists(path) {
    return existsSync(path);
}
