import pino from 'pino';
import * as fs from 'fs';
import pretty from 'pino-pretty';

export const getLogger = () => {

    return pino({
        level: 'debug',
    }, pino.multistream([
        {
            stream: pretty({
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            }),
        },
        {
            stream: pino.destination({
                dest: `./app.log`,
                sync: true
            }),
        }
    ]));
}