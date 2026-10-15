// Opt-in network checks, separate from deterministic tests. No upstream response is mocked.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const baseURL = process.env.ST_BASE_URL || 'http://127.0.0.1:8000';
const output = process.env.ST_LIVE_REPORT || join(tmpdir(), 'sillytavern-music-live.json');
const launch = { headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };
// Use the environment's supplied route when explicitly requested. Do not log proxy values.
if (process.env.ST_LIVE_USE_PROXY === '1' && process.env.HTTPS_PROXY) {
    const proxy = new URL(process.env.HTTPS_PROXY);
    launch.proxy = {
        server: proxy.origin,
        bypass: '127.0.0.1,localhost',
        ...(proxy.username
            ? { username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password) }
            : {}),
    };
}
const report = { date: new Date().toISOString(), apiMocks: false, audioMocks: false, results: [] };
const browser = await chromium.launch(launch);
try {
    const page = await browser.newPage();
    report.browserErrors = [];
    report.failedRequests = [];
    page.on('pageerror', (error) => report.browserErrors.push(error.message));
    page.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
            report.failedRequests.push({ host: new URL(request.url()).host, error: request.failure()?.errorText });
    });
    // Keep this diagnostic from changing any of the host user's saved settings.
    await page.route('**/api/settings/save', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/settings/get', async (route) => {
        const response = await route.fetch(),
            body = await response.json(),
            settings = JSON.parse(body.settings);
        settings.firstRun = false;
        settings.extension_settings ||= {};
        settings.extension_settings.riserein_music_player = { tracks: [], playlists: [] };
        body.settings = JSON.stringify(settings);
        await route.fulfill({ response, json: body });
    });
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.locator('#stm-launcher').waitFor({ timeout: 45000 });
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    const results = await page.evaluate(
        async ({ publicKey, anonymous, candidates }) => {
            const root = '/scripts/extensions/third-party/sillytavern/';
            const { createPlatformService } = await import(`${root}platforms/service.js`);
            const { PLATFORM_CONFIG } = await import(`${root}platforms/config.js`);
            const { verifyPlayback } = await import(`${root}platforms/diagnostics.js`);
            const { createMusicRequest } = await import(`${root}platforms/request.js`);
            const config = structuredClone(PLATFORM_CONFIG);
            if (publicKey) config.audius.apiKey = publicKey;
            if (candidates) config.embeds = { spotify: true, soundcloud: true };
            const service = createPlatformService({ config }),
                results = [];
            for (const platform of service.platforms().filter((item) => item.capabilities.search)) {
                const result = { source: platform.name, search: false, playback: false };
                try {
                    const search = await service.search('piano', { platform: platform.id });
                    if (search.errors.length) throw new Error(search.errors[0].message);
                    result.search = true;
                    result.count = search.tracks.length;
                    const track = search.tracks.find((item) => service.canPlay(item));
                    if (!track) throw new Error('搜索没有返回可直接播放的歌曲；未通过播放验证。');
                    result.track = { title: track.title, sourceUrl: track.sourceUrl };
                    const audio = document.querySelector('#stm-player audio');
                    await verifyPlayback(audio, async () => {
                        const source = await service.resolve(track);
                        audio.src = source.url;
                        audio.load();
                        await audio.play();
                    });
                    result.playback = true;
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();
                } catch (error) {
                    result.error = error.message;
                }
                results.push(result);
            }
            if (!config.audius.apiKey)
                results.push({ source: 'Audius', status: '未配置维护者公开 Key；正式适配器关闭' });
            // Optional diagnostic of publicly accessible endpoints, never enables the product by itself.
            if (anonymous) {
                const result = { source: 'Audius 匿名探测（非正式启用）', search: false, playback: false };
                try {
                    const body = await createMusicRequest()(
                        'https://api.audius.co/v1/tracks/search?query=piano&limit=1',
                    );
                    const track = body.data?.[0];
                    if (!track) throw new Error('没有返回歌曲');
                    result.search = true;
                    result.title = track.title;
                    if (track.is_stream_gated || track.is_streamable === false || track.access?.stream === false)
                        throw new Error('返回曲目受限，不尝试播放');
                    const audio = document.querySelector('#stm-player audio');
                    await verifyPlayback(audio, async () => {
                        audio.src = `https://api.audius.co/v1/tracks/${encodeURIComponent(track.id)}/stream`;
                        audio.load();
                        await audio.play();
                    });
                    result.playback = true;
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();
                } catch (error) {
                    result.error = error.message;
                }
                results.push(result);
            }
            for (const url of [
                'https://soundcloud.com/forss/flickermood',
                'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
            ]) {
                try {
                    const preview = await service.preview(url);
                    results.push({
                        source: preview.platform,
                        metadata: preview.tracks[0].metadataStatus !== 'reference',
                        playback: false,
                        mode: preview.tracks[0].playback,
                        note:
                            preview.tracks[0].metadataStatus === 'reference'
                                ? '默认关闭，仅识别链接'
                                : '候选接入仅验证元数据；没有验证官方播放器发声或产品使用许可',
                    });
                } catch (error) {
                    results.push({ source: new URL(url).hostname, metadata: false, error: error.message });
                }
            }
            return results;
        },
        {
            publicKey: process.env.AUDIUS_PUBLIC_API_KEY || '',
            anonymous: process.argv.includes('--anonymous-audius'),
            candidates: process.argv.includes('--candidate-embeds'),
        },
    );
    report.results = results;
    report.fullPlaybackVerified = results.some((result) => result.playback === true && !result.source.includes('匿名'));
    process.exitCode = report.fullPlaybackVerified ? 0 : 2;
} catch (error) {
    report.error = error.message;
    process.exitCode = 2;
} finally {
    await browser.close();
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`验证记录：${output}`);
}
