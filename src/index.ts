import path, { resolve } from 'node:path';
import os from 'node:os';
import {upload} from './asset.js';
import { mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync, writeFileSync } from 'node:fs';
import { crawl } from './utils.js';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import mime from 'mime';
import fastGlob from 'fast-glob';

import 'dotenv/config';

const defaultConfigDirectory = path.join(os.homedir(), '.config/immich/');

const jsons = await fastGlob.glob(path.join(process.env.DISCORD_DATA_PACKAGE_DIR!, 'Messages/**/messages.json').replace(/\\/g, '/'), {
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

let downloaded: Record<string, string> = {};

process.on('uncaughtException', (err) => {
    writeFileSync('./timestamps.json', JSON.stringify(timestamps, null, 2));
    writeFileSync('./downloaded.json', JSON.stringify(downloaded, null, 2));
    
    console.error(`${new Date().toUTCString()} uncaughtException:`, err.message);
    console.error(err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    writeFileSync('./timestamps.json', JSON.stringify(timestamps, null, 2));
    writeFileSync('./downloaded.json', JSON.stringify(downloaded, null, 2));

    console.error(`${new Date().toUTCString()} unhandledRejection:`, reason);
    process.exit(1);
});

process.on('SIGINT', () => {
    writeFileSync('./timestamps.json', JSON.stringify(timestamps, null, 2));
    writeFileSync('./downloaded.json', JSON.stringify(downloaded, null, 2));
    console.log('Process interrupted. Exiting gracefully...');
    process.exit(0);
});

if (existsSync('./downloaded.json')) {
    downloaded = JSON.parse(await readFile('./downloaded.json', 'utf-8')) as Record<string, string>;
}

async function download(ts: Date, attachment: string) {
    const usefulUrlPart = new URL(attachment).pathname;

    if (usefulUrlPart in downloaded) {
        return resolve('./assets', downloaded[usefulUrlPart]);
    }

    const hash = createHash('sha1').update(usefulUrlPart).digest('hex').slice(0, 8);

    const filename = `${ts.toISOString().replace(/:/g, '-')}-${hash}-${usefulUrlPart.split('/').pop()?.replace(/\..+?$/,'').slice(0, 60) ?? ''}`; // remove extension if any, limit length to avoid issues
    const originalExtension = usefulUrlPart.split('/').pop()?.split('.').pop();

    // console.log(originalExtension);

    const res = await fetch(attachment);
    const contentType = res.headers.get('content-type');

    let extension = mime.getExtension(contentType || 'application/octet-stream') || 'bin';
    if (extension === 'qt') {
        extension = 'mov'; // QuickTime video files
    } else if (extension === 'oga') {
        extension = 'ogg'; // Ogg audio files
    } else if (extension === 'mpga') {
        extension = 'm4a'; // MPEG audio files
    } else if (extension === 'markdown') {
        extension = 'md'; // Markdown files
    } else if (extension === 'bin' || extension === 'txt') {
        extension = originalExtension || extension; // fallback to original extension if any
    }

    if (!res.ok) {
        console.error(`Failed to download ${attachment}: ${res.status} ${res.statusText}`);
    }

    if (existsSync(resolve('./assets', `${filename}.${extension}`))) {
        downloaded[usefulUrlPart] = `${filename}.${extension}`;
        return resolve('./assets', `${filename}.${extension}`);
    }

    await finished(Readable.fromWeb(res.body!).pipe(createWriteStream(resolve('./assets', `${filename}.${extension}`))));
    downloaded[usefulUrlPart] = `${filename}.${extension}`;

    await utimes(resolve('./assets', `${filename}.${extension}`), ts, ts);

    return resolve('./assets', `${filename}.${extension}`);
}

for (const jsonPath of jsons) {
    console.log(`Processing ${jsonPath}...`);
    const messages = await readFile(jsonPath, 'utf-8').then(buf => JSON.parse(buf)) as {ID: number, Timestamp: string, Contents: string, Attachments: string | string[]}[];
    for (const message of messages) {
        console.log(`  Message ${message.ID} from ${message.Timestamp}...`);

        if (message.Attachments && !Array.isArray(message.Attachments)) {
            const date = convertSnowflakeToDate(message.ID);
            const thePath = await download(date, message.Attachments);

            timestamps[thePath] = date;
        } else if (Array.isArray(message.Attachments) && message.Attachments.length > 0) {
            for (const attachmentUrl of message.Attachments) {
                const date = convertSnowflakeToDate(message.ID);
                const thePath = await download(date, attachmentUrl);

                timestamps[thePath] = date;
            }
        }
    }
}

await writeFile('./timestamps.json', JSON.stringify(timestamps, null, 2));
await writeFile('./downloaded.json', JSON.stringify(downloaded, null, 2));

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