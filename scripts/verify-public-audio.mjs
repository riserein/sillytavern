// Opt-in real network probe. No audio routing, proxy substitution, or TLS verification bypass.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const baseURL = process.env.ST_BASE_URL || 'http://127.0.0.1:8000';
const source =
    process.env.ST_PUBLIC_AUDIO_URL ||
    'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3';
if (new URL(source).protocol !== 'https:') throw new Error('Use an authorized public HTTPS audio URL.');
const report = {
    testedAt: new Date().toISOString(),
    source,
    audioMocks: false,
    metadataMocks: false,
    host: 'media element at SillyTavern origin; this is not a full Tavern Helper acceptance test',
    errors: [],
    status: 'not-tested',
};
const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
    const page = await browser.newPage();
    page.on('requestfailed', (request) =>
        report.errors.push({
            host: new URL(request.url()).host,
            reason: request.failure()?.errorText,
        }),
    );
    await page.route('**/rscp-public-audio-probe', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body>Public audio verification</body></html>',
        }),
    );
    await page.goto(new URL('/rscp-public-audio-probe', baseURL).href);
    report.result = await page.evaluate(async (source) => {
        const { verifyPlayback } = await import(
            '/scripts/extensions/third-party/sillytavern/platforms/diagnostics.js'
        );
        const audio = document.createElement('audio');
        audio.muted = true;
        document.body.append(audio);
        try {
            return await verifyPlayback(
                audio,
                () => {
                    audio.src = source;
                    return audio.play();
                },
                { timeout: 20000 },
            );
        } finally {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            audio.remove();
        }
    }, source);
    report.status = 'passed';
} catch (error) {
    report.status = 'blocked-or-failed';
    report.reason = error.message;
    process.exitCode = 1;
} finally {
    await browser.close();
    await writeFile(
        process.env.ST_PUBLIC_AUDIO_REPORT || '/tmp/rscp-public-audio-report.json',
        JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report, null, 2));
}
