import path, { resolve } from 'node:path';
import os from 'node:os';
import {upload} from './asset.js';
import 'dotenv/config';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { crawl } from './utils.js';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import mime from 'mime';
import fastGlob from 'fast-glob';

import 'dotenv/config';

const defaultConfigDirectory = path.join(os.homedir(), '.config/immich/');

const jsons = await fastGlob.glob(path.join(process.env.DISCORD_DATA_PACKAGE_DIR!, 'messages/**/messages.json').replace(/\\/g, '/'), {
    absolute: true,
    caseSensitiveMatch: false,
    dot: true,
    ignore: [],
});

console.log(`Found ${jsons.length} message JSON files.`);

await mkdir('./assets', { recursive: true });

const timestamps: Record<string, Date> = {};

/*!
https://github.com/vegeta897/snow-stamp

MIT License

Copyright (c) 2017-2021 Devin Spikowski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const DISCORD_EPOCH = 1420070400000;
function convertSnowflakeToDate(snowflake: number, epoch = DISCORD_EPOCH) {
	// Convert snowflake to BigInt to extract timestamp bits
	// https://discord.com/developers/docs/reference#snowflakes
	const milliseconds = BigInt(snowflake) >> 22n
	return new Date(Number(milliseconds) + epoch)
}

async function download(ts: string, attachment: string) {
    const hash = createHash('sha1').update(attachment).digest('hex');

    const filename = `${ts}-${hash}-${new URL(attachment).pathname.split('/').pop()?.replace(/\..+?$/,'') ?? ''}`; // remove extension if any
    const originalExtension = new URL(attachment).pathname.split('/').pop()?.split('.').pop();

    const res = await fetch(attachment);
    const contentType = res.headers.get('content-type');

    let extension = mime.getExtension(contentType || 'application/octet-stream') || originalExtension || 'bin';
    if (extension === 'qt') {
        extension = 'mov'; // QuickTime video files
    } else if (extension === 'oga') {
        extension = 'ogg'; // Ogg audio files
    } else if (extension === 'mpga') {
        extension = 'm4a'; // MPEG audio files
    } else if (extension === 'markdown') {
        extension = 'md'; // Markdown files
    }

    if (existsSync(path.join('./assets', `${filename}.${extension}`))) {
        return resolve('./assets', `${filename}.${extension}`);
    }

    await finished(Readable.fromWeb(res.body!).pipe(createWriteStream(path.join('./assets', `${filename}.${extension}`))));
    
    return resolve('./assets', `${filename}.${extension}`);
}

for (const jsonPath of jsons) {
    console.log(`Processing ${jsonPath}...`);
    const messages = await readFile(jsonPath, 'utf-8').then(buf => JSON.parse(buf)) as {ID: number, Timestamp: string, Contents: string, Attachments: string | string[]}[];
    for (const message of messages) {
        console.log(`  Message ${message.ID} from ${message.Timestamp}...`);

        if (message.Attachments && !Array.isArray(message.Attachments)) {
            const thePath = await download(message.Timestamp.replace(/:/g, '-'), message.Attachments);

            timestamps[thePath] = convertSnowflakeToDate(message.ID);
        } else if (Array.isArray(message.Attachments) && message.Attachments.length > 0) {
            for (const attachmentUrl of message.Attachments) {
                const thePath = await download(message.Timestamp.replace(/:/g, '-'), attachmentUrl);

                timestamps[thePath] = convertSnowflakeToDate(message.ID);
            }
        }
    }
}

writeFile('./timestamps.json', JSON.stringify(timestamps, null, 2));

await upload(
    Object.keys(timestamps),
    {
        configDirectory: defaultConfigDirectory
    },
    {
        concurrency: 4,
        dryRun: false,
        jsonOutput: false,
        watch: false,
        album: false,
        albumName: `Discord Screenshots`,
        recursive: false,
        skipHash: false,
        progress: true,
        delete: false,
        includeHidden: true,
        backdateMap: timestamps
    }
);