import { readScriptPayload, analyzePayload, PLAYER_BUILD } from '../card-player/quality.js';
import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {performanceSampler} from './performance-sampler.js';
const results = [];
const exportMetrics = [];
const performanceRecords=[],performanceStops=[];
const helperVersion = process.env.ST_HELPER_VERSION || '4.11.3';
const reportPath = process.env.ST_NATIVE_REPORT || 'docs/card-player/native-validation.json';
const screenshotDir=process.env.ST_SCREENSHOT_DIR||'docs/card-player';
const largeFixture = process.env.ST_AUDIT_LARGE === '1';
function largeWav(mebibytes) {
    const bytes = Buffer.alloc(mebibytes * 1024 * 1024);
    bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
    return bytes;
}
test('compact selected font stays fixed after native export and changes only on a new author export', async ({
    browser,
}) => {
    test.setTimeout(largeFixture ? 900000 : 360000);
    const { page: author, context: authorContext } = await session(browser);
    let fontReads = 0,
        rawPngBytes = 0,
        nativeWrites = 0,
        targetAvatar;
    author.on('request', (request) => {
        if (request.url().endsWith('/api/characters/merge-attributes') && request.postDataJSON()?.avatar === targetAvatar) nativeWrites++;
        if (
            request.resourceType() === 'fetch' &&
            request.url().split('?')[0].endsWith('/assets/fonts/ChildFunSans.woff2')
        )
            fontReads++;
    });
    author.on('response', async (response) => {
        if (
            response.url().endsWith('/api/characters/export') &&
            response.request().postDataJSON()?.format === 'png'
        )
            rawPngBytes = Number(await response.headerValue('content-length'));
    });
    const avatar = await createCard(author, 'CompactFont');
    targetAvatar = avatar;
    await selectCard(author, avatar);
    await author.getByRole('tab', { name: '曲库', exact: true }).click();
    await author.locator('[data-action=new-playlist]').click();
    await author.locator('#stm-new-playlist').fill('Compact font playlist');
    await author.getByRole('button', { name: '新建', exact: true }).click();
    const playlist = await author.locator('#stm-library-playlist').inputValue();
    await author.getByRole('tab', { name: '导入', exact: true }).click();
    await menu(author, '#stm-import-playlist', playlist);
    await author
        .locator('[data-role=files]')
        .setInputFiles(largeFixture ? [20, 8].map((size, i) => ({ name: `Large synthetic ${i}.wav`, mimeType: 'audio/wav', buffer: largeWav(size) })) : { name: 'Selected font tone.mp3', mimeType: 'audio/mpeg', buffer: tone });
    await expect(author.locator('.stm-status')).toContainText(`已导入 ${largeFixture ? 2 : 1} 首音乐`, { timeout: 120000 });
    await author.getByRole('tab', { name: '外观', exact: true }).click();
    await author.locator('#stm-font').click();
    await author.locator('[role=radio][data-font-choice=child]').click();
    await expect(author.locator('#stm-font')).toHaveAttribute('data-font-choice', 'child', {
        timeout: 60000,
    });
    await author.getByRole('tab', { name: '曲库', exact: true }).click();
    await author.getByRole('button', { name: '打开歌单：Compact font playlist', exact: true }).click();
    await author.locator('[data-action=toggle-manager]').click();
    await author.locator('[data-action=bind-roles]').click();
    await author.locator('.stm-role-picker input').evaluateAll((inputs, avatar) => {
        for (const input of inputs) input.checked = input.dataset.avatar === avatar;
    }, avatar);
    await author.locator('#stm-role-bindings button[type=submit]').click();
    await expect(author.locator('.stm-status')).toContainText('音乐已随卡保存', { timeout: 120000 });
    const exports = [];
    for (const format of ['json', 'png']) {
        const started = Date.now();
        await author.locator('#export_button').dispatchEvent('click');
        const pending = author.waitForEvent('download', { timeout: 120000 });
        await author.locator('.export_format[data-format=' + format + ']').dispatchEvent('click');
        const file = await pending;
        const bytes = await readFile(await file.path());
        exports.push({ format, bytes });
        exportMetrics.push({ format, bytes: bytes.length, milliseconds: Date.now() - started });
        if (format === 'json') {
            const card = JSON.parse(bytes.toString());
            const exportedScript = card.data.extensions.tavern_helper.scripts[0];
            const content = exportedScript.content;
            exportMetrics.push({
                format: 'resource-breakdown',
                ...analyzePayload(readScriptPayload(content), exportedScript),
            });
            expect(content).toContain('"fontEncoding":""');
            expect(content).toContain('"fontOriginalBytes":1531668');
            const font = content.match(/"font":"data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/);
            expect(font).not.toBeNull();
            expect(createHash('sha256').update(Buffer.from(font[1], 'base64')).digest('hex')).toBe(
                'a6c57b9ab19d0cee83c9c1144661e2a10cc4a93d9a38c3249f9d5d6ac92bce8e',
            );
        }
    }
    await author.getByRole('tab', { name: '曲库', exact: true }).click();
    await author.locator('[data-role=card-handoff] summary').click();
    for (const exported of exports) {
        const directory = await mkdtemp(join(tmpdir(), 'stm-handoff-audit-'));
        try {
            const path = join(directory, 'export.' + exported.format);
            await writeFile(path, exported.bytes);
            await author.locator('[data-role=card-handoff] input').setInputFiles(path);
        } finally { await rm(directory, { recursive: true, force: true }); }
        await expect(author.locator('[data-role=handoff-result]')).toContainText(`文件静态核对通过：${largeFixture ? 2 : 1} 首`);
        await expect(author.locator('[data-role=handoff-result]')).toContainText('接收端无需音乐插件');
    }
    await author.locator('[data-role=card-handoff] input').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Binding only', extensions: {} } })) });
    await expect(author.locator('[data-role=handoff-result]')).toContainText('此文件没有随卡播放器记录');
    expect(fontReads).toBe(1);
    expect(nativeWrites).toBe(1);
    exportMetrics.push({ nativeWritesBeforeFontChange: nativeWrites, expected: 'one binding write; unchanged JSON/PNG exports reuse the stored player despite Helper schema key order' });
    const pngBytes = exports.find((file) => file.format === 'png').bytes.length;
    expect(rawPngBytes).toBeGreaterThan(pngBytes);
    expect(pngBytes / rawPngBytes).toBeLessThan(0.55);
    exportMetrics.push({
        rawPngBytes,
        compactPngBytes: pngBytes,
        packagedFontReadsAcrossBindingAndTwoExports: fontReads,
    });
    await author.getByRole('tab', { name: '外观', exact: true }).click();
    if (await author.locator('#stm-font-gallery').isHidden()) await author.locator('#stm-font').click();
    await author.locator('[role=radio][data-font-choice=poxiao]').click();
    await expect(author.locator('#stm-font')).toHaveAttribute('data-font-choice', 'poxiao');
    await author.locator('#export_button').dispatchEvent('click');
    const switchedDownload = author.waitForEvent('download', { timeout: 120000 });
    await author.locator('.export_format[data-format=json]').dispatchEvent('click');
    const switched = await readFile(await (await switchedDownload).path());
    expect(JSON.parse(switched.toString()).data.extensions.tavern_helper.scripts[0].content).toContain(
        '"fontFile":"PoxiaoPixel.woff2"',
    );
    expect(switched.length).toBeLessThan((largeFixture ? 45 : 5) * 1024 * 1024);
    await authorContext.close();
    const { page: recipient } = await session(browser, { portable: true });
    const imported = await importCard(recipient, exports.find((file) => file.format === 'png').bytes, 'png');
    await selectCard(recipient, imported);
    await recipient
        .getByText(/^(确认|Confirm)$/, { exact: true })
        .last()
        .click();
    await expect(recipient.locator(root)).toHaveCount(1, { timeout: 90000 });
    await expect(recipient.locator('[data-role=card-handoff]')).toHaveCount(0);
    await expect(recipient.locator('#stm-font, .stm-font-section, [data-action=import-font]')).toHaveCount(0);
    await expect
        .poll(
            () =>
                recipient.evaluate(() =>
                    [...document.fonts].some(
                        (face) => face.family === 'stm-child' && face.status === 'loaded',
                    ),
                ),
            { timeout: 90000 },
        )
        .toBe(true);
    await recipient.locator('[data-action=play]').click();
    await expect
        .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
        .toBeGreaterThan(0.2);
    await recipient.locator(root).evaluate(
        (node) =>
            (window.__fontPlayer = {
                node,
                api: node.__risereinPlayer,
                audio: node.__risereinPlayer.audio,
            }),
    );
    await home(recipient);
    await expect(recipient.locator(root)).toHaveCount(0);
    expect(
        await recipient.evaluate(
            () =>
                window.__fontPlayer.audio.paused &&
                Object.values(window.__fontPlayer.api.resourceCounts).every((value) => value === 0),
        ),
    ).toBe(true);
    const switchedAvatar = await importCard(recipient, switched, 'json');
    await selectCard(recipient, switchedAvatar);
    // Helper 4.9.5 remembers character permission by name; importing a second
    // export of the same card can run without a second confirmation popup.
    // Require either the real prompt or the actual player, never skip a missing player.
    const confirmation = recipient.getByText(/^(确认|Confirm)$/, { exact: true }).last();
    await expect.poll(async () => await confirmation.isVisible() || await recipient.locator(root).count() === 1, { timeout: 90000 }).toBe(true);
    if (await confirmation.isVisible()) await confirmation.click();
    await expect(recipient.locator(root)).toHaveCount(1);
    await expect(recipient.locator('#stm-font, .stm-font-section, [data-action=import-font]')).toHaveCount(0);
    await expect
        .poll(() =>
            recipient.evaluate(() =>
                [...document.fonts]
                    .filter((face) => face.family.startsWith('stm-'))
                    .map((face) => face.family),
            ),
        )
        .toEqual(['stm-poxiao']);
    await recipient.locator('[data-action=play]').click();
    await expect
        .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
        .toBeGreaterThan(0.2);
});
test.beforeAll(async () => {
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(
        reportPath,
        JSON.stringify({ status: 'running', results: [] }) + '\n',
    );
});
const baseURL = process.env.ST_BASE_URL || 'http://127.0.0.1:8000';
const root = '[data-riserein-card-player]';
const tone = await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3', import.meta.url));
const image = await readFile(new URL('../assets/covers/moon.png', import.meta.url));
let sessions = [],
    cards = [];
async function selectCard(page, avatar) {
    if(process.env.ST_AUDIT_PERF==='1')await page.evaluate(()=>window.__stmPerformance?.roles.push({start:performance.now()}));
    await page.evaluate(async (avatar) => {
        const { selectCharacterById } = await import('/script.js');
        await selectCharacterById(
            SillyTavern.getContext().characters.findIndex((card) => card.avatar === avatar),
        );
    }, avatar);
}
async function home(page) {
    await page.evaluate(async () => {
        const { closeCurrentChat } = await import('/script.js');
        await closeCurrentChat();
    });
}
async function createCard(page, label) {
    const avatar = await page.evaluate(async (label) => {
        const name = 'RSCP_Test_Export_' + label + '_' + crypto.randomUUID().slice(0, 7);
        await TavernHelper.createCharacter(name, {
            description: 'Export fixture description preserved.',
            first_messages: ['Opening one.', 'Opening two.'],
            extensions: {
                unrelated_fixture: { keep: 'world' },
                tavern_helper: { scripts: [], variables: { preserve: 17 } },
            },
        });
        return SillyTavern.getContext().characters.find((card) => card.name === name).avatar;
    }, label);
    cards.push(avatar);
    return avatar;
}
async function session(browser, { portable = false, mobile = false } = {}) {
    const context = await browser.newContext({
        baseURL,
        acceptDownloads: true,
        viewport: mobile ? { width: 375, height: 844 } : { width: 1280, height: 1000 },
        isMobile: mobile,
        hasTouch: mobile,
    });
    const page = await context.newPage();
    if(process.env.ST_AUDIT_PERF==='1'){
        const stop=await performanceSampler(browser,context,page,portable?'recipient':'author',performanceRecords);performanceStops.push(stop);context.on('close',()=>void stop());
    }
    sessions.push({ context, page });
    page.setDefaultTimeout(20000);
    await page.route('**/api/settings/get', async (route) => {
        const response = await route.fetch(),
            body = await response.json(),
            data = JSON.parse(body.settings);
        data.firstRun = false;
        data.main_api = 'kobold'; data.api_server = 'http://fixture.invalid';
        data.extension_settings ||= {};
        data.extension_settings.disabledExtensions = portable ? ['third-party/sillytavern'] : [];
        data.extension_settings.riserein_music_player = {
            tracks: [],
            theme: 'night',
            colorScheme: 'dark',
            surface: 'matte',
            fontPreset: 'sans',
            volume: 0.32,
            mode: 'list',
            panelSize: { width: 640, height: 760 },
        };
        data.extension_settings.tavern_helper = {
            optimize: {
                disable_incompatible_option: false,
                force_recommended_worldbook_global_settings: false,
            },
            script: {
                enabled: { global: false, characters: [], presets: [] },
                popuped: { characters: [], presets: [] },
            },
        };
        body.settings = JSON.stringify(data);
        await route.fulfill({ response, json: body });
    });
    if (portable)
        await page.route('**/scripts/extensions/third-party/sillytavern/**', (route) =>
            route.request().url().split('?')[0].endsWith('/manifest.json') ? route.continue() : route.abort(),
        );
    await page.route('https://media.riserein.example/native-tone.mp3', (route) =>
        route.fulfill({
            body: tone,
            contentType: 'audio/mpeg',
            headers: { 'Access-Control-Allow-Origin': '*' },
        }),
    );
    await page.goto('/');
    await page.waitForFunction(() => !!window.TavernHelper, {}, { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.unroute('**/api/settings/get');
    await home(page);
    expect(await page.evaluate(() => TavernHelper.getTavernHelperVersion())).toBe(helperVersion);
    if (portable) {
        await expect(page.locator('#stm-player')).toHaveCount(0);
        expect(
            await page.evaluate(
                async () =>
                    !(await indexedDB.databases()).some((db) => db.name === 'riserein-sillytavern-music'),
            ),
        ).toBe(true);
    } else {
        await expect(page.locator('#stm-launcher')).toBeVisible();
        await page.locator('#stm-launcher').click();
    }
    return { page, context };
}
async function menu(page, id, value) {
    const text = await page
        .locator(id)
        .evaluate(
            (select, value) => [...select.options].find((option) => option.value === value).textContent,
            value,
        );
    await page.locator(id + '-trigger').click();
    await page
        .locator(id + '-menu')
        .getByRole('option', { name: text, exact: true })
        .click();
}
async function download(page, button) {
    const pending = page.waitForEvent('download');
    await button.click();
    const item = await pending;
    return {
        name: item.suggestedFilename(),
        bytes: await readFile(await item.path()),
    };
}
async function importCard(page, bytes, format = 'json') {
    const started=Date.now();
    // File paths use Playwright's streamed upload for large cards instead of
    // pushing a base64 PNG through one oversized browser protocol message.
    const directory = await mkdtemp(join(tmpdir(), 'stm-native-import-'));
    try {
        const path = join(directory, 'RSCP_Test_Import.' + format);
        await writeFile(path, bytes);
        const pending = page.waitForResponse(
            (response) => response.url().endsWith('/api/characters/import'),
            { timeout: 120000 },
        );
        await page.locator('#character_import_file').setInputFiles(path);
        const response = await pending;
        expect(response.ok()).toBe(true);
        const result = await response.json();
        const avatar = result.file_name + '.png';
        expect(avatar.startsWith('RSCP_Test_')).toBe(true);
        cards.push(avatar);
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (avatar) =>
                            SillyTavern.getContext().characters.some((card) => card.avatar === avatar),
                        avatar,
                    ),
                { timeout: 60000 },
            )
            .toBe(true);
        exportMetrics.push({operation:'native-import',format,bytes:bytes.length,milliseconds:Date.now()-started});return avatar;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
test.beforeEach(() => {
    sessions = [];
    cards = [];
});
test.afterEach(async ({}, info) => {
    try {
        const live = sessions.filter((item) => !item.page.isClosed()).at(-1)?.page;
        if (live) {
            await home(live);
            for (const avatar of cards) {
                if (!avatar.startsWith('RSCP_Test_')) throw new Error('Unsafe fixture cleanup rejected.');
                await live.evaluate(async (avatar) => {
                    const response = await fetch('/api/characters/delete', {
                        method: 'POST',
                        headers: SillyTavern.getContext().getRequestHeaders(),
                        body: JSON.stringify({ avatar_url: avatar, delete_chats: true }),
                    });
                    if (!response.ok) throw new Error('Cleanup failed');
                }, avatar);
            }
            const save = live.waitForResponse(
                (response) => response.url().endsWith('/api/settings/save') && response.ok(),
            );
            await live.evaluate(() => {
                SillyTavern.getContext().extensionSettings.disabledExtensions = [];
                SillyTavern.getContext().saveSettingsDebounced();
            });
            await save;
        }
        results.push({ name: info.title, status: info.status, cleanup: 'passed' });
    } finally {
        for (const item of sessions) await item.context.close();
    }
});

test.afterAll(async () => {
    await Promise.all(performanceStops.map(stop=>stop()));
    const runtime = await readFile(new URL('../card-player/dist/native-runtime.js', import.meta.url));
    await writeFile(
        reportPath,
        JSON.stringify(
            {
                status: results.length && results.every((item) => item.status === 'passed' && item.cleanup === 'passed')
                    ? (results.length === 5 ? 'passed' : 'selected-tests-passed')
                    : 'incomplete-or-failed',
                version: PLAYER_BUILD,
                largeFixture,
                coverage: results.length === 5 ? 'full-suite' : 'partial-or-selected-tests; see runner report for overall status',
                verifiedAt: new Date().toISOString(),
                runtimeSha256: createHash('sha256').update(runtime).digest('hex'),
                sillyTavern: '1.19.0',
                tavernHelper: helperVersion,
                fullPluginInRecipient: false,
                recipientPluginAssetsBlocked: true,
                recipientMusicDatabase: false,
                nativeControls:
                    'ST export control DOM click events, actual save/export handlers and browser downloads; PNG and JSON',
                audio: largeFixture ? 'actual Chromium decoding and playback of original synthetic WAV; not external music-host validation' : 'actual Chromium decoding and playback of original synthetic MP3; HTTPS direct source uses a routed network fixture, not a verified external music host',
                llm: 'real ST regenerate flow with fixture LLM/tokenizer responses',
                mobile: 'Chromium viewport and touch emulation, not physical devices',
                results,
                exportMetrics,
                performanceRecords,
            },
            null,
            2,
        ) + '\n',
    );
});

for (const mobile of [false, true])
    test(`native PNG and JSON carry the shared player to a clean ${mobile ? 'phone' : 'desktop'} recipient`, async ({
        browser,
    }) => {
        const { page: author, context: authorContext } = await session(browser);
        const errors = [];
        author.on('pageerror', (error) => errors.push(error.message));
        const a = await createCard(author, 'NativeAmber');
        await selectCard(author, a);
        await author.evaluate(() =>
            TavernHelper.replaceScriptTrees(
                [
                    {
                        type: 'script',
                        id: 'native-foreign-script',
                        name: 'Other author',
                        enabled: false,
                        content: '/* keep this script */',
                        info: 'foreign',
                        button: { enabled: false, buttons: [] },
                        data: { keep: 13 },
                        export_with: { data: true, button: true },
                    },
                    {
                        type: 'script',
                        id: 'native-private-script',
                        enabled: false,
                        name: 'Private fixture',
                        content: '/* foreign private fixture */',
                        info: 'foreign',
                        data: { privateFixture: 'retain only in author card' },
                        button: { enabled: false, buttons: [{ name: 'Author only', visible: true }] },
                        export_with: { data: false, button: false },
                    },
                ],
                { type: 'character' },
            ),
        );
        await author.getByRole('tab', { name: '曲库', exact: true }).click();
        await author.locator('[data-action=new-playlist]').click();
        await author.locator('#stm-new-playlist').fill('bill');
        await author.getByRole('button', { name: '新建', exact: true }).click();
        const playlist = await author.locator('#stm-library-playlist').inputValue();
        await author.getByRole('tab', { name: '导入', exact: true }).click();
        await menu(author, '#stm-import-playlist', playlist);
        await author.locator('[data-role=files]').setInputFiles(
            ['One', 'Two'].map((name) => ({
                name: name + '.mp3',
                mimeType: 'audio/mpeg',
                buffer: tone,
            })),
        );
        await expect(author.locator('.stm-status')).toContainText('已导入 2 首音乐');
        await author.locator('#stm-url').fill('https://media.riserein.example/native-tone.mp3');
        await author.locator('.stm-url-form button').click();
        await expect(author.locator('.stm-status')).toContainText('已将音乐加入');
        await author.evaluate(async (bytes) => {
            const { LocalMusicStore } = await import(
                '/scripts/extensions/third-party/sillytavern/local-store.js'
            );
            const { prepareCover } = await import('/scripts/extensions/third-party/sillytavern/media.js');
            const state = SillyTavern.getContext().extensionSettings.riserein_music_player;
            const store = new LocalMusicStore();
            state.backgroundId = 'background:' + crypto.randomUUID();
            await store.put(
                state.backgroundId,
                await prepareCover(new Blob([new Uint8Array(bytes)], { type: 'image/png' })),
            );
            state.fontPreset = 'poxiao';
            state.surface = 'glass';
            state.maskOpacity.glass = 0.7;
            state.tracks[0].lyrics = '[00:00.00]Shared UI lyric\n[00:02.00]Music stays with Amber';
        }, Array.from(image));
        await author.getByRole('tab', { name: '曲库', exact: true }).click();
        await author.getByRole('button', { name: '打开歌单：bill', exact: true }).click();
        await author.locator('[data-action=toggle-manager]').click();
        await author.locator('[data-action=bind-roles]').click();
        await author.locator('.stm-role-picker input').evaluateAll((inputs, avatar) => {
            for (const input of inputs) input.checked = input.dataset.avatar === avatar;
        }, a);
        await author.locator('#stm-role-bindings button[type=submit]').click();
        await expect(author.locator('.stm-status')).toContainText('音乐已随卡保存', { timeout: 60000 });
        const stored = await author.evaluate(
            () => SillyTavern.getContext().characters[SillyTavern.getContext().characterId].data.extensions,
        );
        expect(stored.riserein_card_player.mode).toBe('native');
        expect(stored.tavern_helper.scripts).toHaveLength(3);
        const ownScript = stored.tavern_helper.scripts.find(
            (script) => script.id === stored.riserein_card_player.scriptId,
        );
        expect(ownScript.content).toContain('startNativeCharacterPlayer');
        expect(ownScript.content).not.toContain('indexedDB.open');
        await author.evaluate(() => {
            SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0].title = 'One Updated';
        });
        await author.locator('[data-action=close]').click();
        const exports = [];
        for (const format of ['json', 'png']) {
            // Dispatch on ST's own controls: the native handler still saves the card,
            // calls the real export endpoint and creates the actual browser download.
            // Drawer visibility is a host preference unrelated to the music export.
            await author.locator('#export_button').dispatchEvent('click');
            const pending = author.waitForEvent('download');
            await author.locator(`.export_format[data-format=${format}]`).dispatchEvent('click');
            const downloaded = await pending;
            const file = {
                name: downloaded.suggestedFilename(),
                bytes: await readFile(await downloaded.path()),
            };
            expect(file.name.endsWith('.' + format)).toBe(true);
            exports.push({ format, ...file });
            if (format === 'json') {
                const card = JSON.parse(file.bytes.toString());
                expect(card.data.extensions.unrelated_fixture.keep).toBe('world');
                expect(card.data.extensions.tavern_helper.variables.preserve).toBe(17);
                expect(
                    card.data.extensions.tavern_helper.scripts.find(
                        (script) => script.id === stored.riserein_card_player.scriptId,
                    ).content,
                ).toContain('data:audio/mpeg;base64,');
                expect(
                    card.data.extensions.tavern_helper.scripts.find(
                        (script) => script.id === stored.riserein_card_player.scriptId,
                    ).content,
                ).toContain('One Updated');
                expect(
                    card.data.extensions.tavern_helper.scripts.find(
                        (script) => script.id === 'native-foreign-script',
                    ).data.keep,
                ).toBe(13);
                const privateScript = card.data.extensions.tavern_helper.scripts.find(
                    (script) => script.id === 'native-private-script',
                );
                expect(privateScript.data).toEqual({});
                expect(privateScript.button.buttons).toEqual([]);
            }
            // Official Helper restores its temporary export filter asynchronously after
            // character_export_ready; assert the durable end state, not an intermediate write.
            await expect.poll(async()=>author.evaluate(async (avatar) => {
                const response = await fetch('/api/characters/get', {
                    method: 'POST',
                    headers: SillyTavern.getContext().getRequestHeaders(),
                    body: JSON.stringify({ avatar_url: avatar }),
                });
                if (!response.ok) throw new Error('Read saved author card failed');
                const persisted=await response.json();return persisted.data.extensions.tavern_helper.scripts.find(
                    (script) => script.id === 'native-private-script',
                ).data.privateFixture;
            }, a),{timeout:15000}).toBe('retain only in author card');
        }
        await author.evaluate(
            () =>
                new Promise((resolve, reject) => {
                    const request = indexedDB.deleteDatabase('riserein-sillytavern-music');
                    request.onsuccess = resolve;
                    request.onerror = () => reject(request.error);
                    request.onblocked = () => reject(new Error('DB blocked'));
                }),
        );
        await authorContext.close();
        const { page: recipient } = await session(browser, {
            portable: true,
            mobile,
        });
        recipient.on('pageerror', (error) => errors.push(error.message));
        const blank = await createCard(recipient, 'NativeOther');
        for (const file of exports) {
            const avatar = await importCard(recipient, file.bytes, file.format);
            await selectCard(recipient, avatar);
            await recipient
                .getByText(/^(确认|Confirm)$/, { exact: true })
                .last()
                .click();
            await expect(recipient.locator(root)).toHaveCount(1);
            await expect(recipient.locator('#stm-player')).toBeVisible({
                timeout: 30000,
            });
            expect(await recipient.locator('#stm-player').getAttribute('class')).toContain('stm-night-ui');
            expect(await recipient.locator('#stm-launcher').getAttribute('class')).toContain(
                'stm-vinyl-launcher',
            );
            await expect(recipient.getByRole('tab', { name: '导入', exact: true })).toHaveCount(0);
            await expect(recipient.locator('#stm-page-import')).toHaveCount(0);
            await expect(
                recipient.locator('#stm-font, .stm-font-section, [data-action=import-font]'),
            ).toHaveCount(0);
            await expect(recipient.getByRole('tab', { name: '最近播放', exact: true })).toBeVisible();
            await expect(recipient.getByRole('tab', { name: '播放排行', exact: true })).toBeVisible();
            await expect
                .poll(() => recipient.locator('.stm-cover-image').evaluate((image) => image.naturalWidth))
                .toBeGreaterThan(0);
            await expect
                .poll(() =>
                    recipient.evaluate(() =>
                        [...document.fonts].some(
                            (face) => face.family === 'stm-poxiao' && face.status === 'loaded',
                        ),
                    ),
                )
                .toBe(true);
            expect(
                await recipient.locator('#stm-player').evaluate((node) => node.dataset.hasBackground),
            ).toBe('true');
            await recipient.locator('[data-action=play]').click();
            await expect
                .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
                .toBeGreaterThan(0.2);
            await recipient.locator(root).evaluate(
                (node) =>
                    (window.__nativeOld = {
                        node,
                        api: node.__risereinPlayer,
                        audio: node.__risereinPlayer.audio,
                    }),
            );
            if (file.format === 'json') {
                await recipient.locator('.stm-options [data-favorite-id]').click();
                await expect(recipient.locator('.stm-options [data-favorite-id]')).toHaveAttribute('aria-pressed','true');
                await recipient.getByRole('tab',{name:'曲库',exact:true}).click();
                await recipient.locator('.stm-favorites-entry').click();
                await expect(recipient.locator('.stm-favorite-list li')).toHaveCount(1);
                await recipient.getByRole('tab',{name:'播放',exact:true}).click();
                await recipient.locator('.stm-sleep-button').click();
                await recipient.locator('[data-sleep-minutes="15"]').click();
                await recipient.getByRole('button',{name:'关闭睡眠定时器',exact:true}).click();
                await recipient.locator('[data-action=toggle-lyrics]').click();
                await expect(recipient.locator('.stm-lyrics-view')).toContainText('Shared UI lyric');
                await recipient.locator('.stm-lyrics-view').click();
                await recipient.locator('#stm-volume').evaluate((input) => {
                    input.value = '43';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
                expect(await recipient.locator(root + ' audio').evaluate((audio) => audio.volume)).toBe(0.43);
                await recipient.locator('#stm-seek').evaluate((input) => {
                    input.value = '10';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
                await expect
                    .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
                    .toBeGreaterThanOrEqual(10);
                await recipient.locator('.stm-resize-handle').focus();
                await recipient.keyboard.press('ArrowLeft');
                expect(
                    await recipient.locator('#stm-player').evaluate((panel) => {
                        const r = panel.getBoundingClientRect();
                        return (
                            r.width >= Math.min(320, innerWidth - 24) &&
                            r.right <= innerWidth &&
                            r.bottom <= innerHeight
                        );
                    }),
                ).toBe(true);
                await recipient.locator('#stm-player').screenshot({
                    path: `${screenshotDir}/native-${mobile ? 'mobile' : 'desktop'}-playback.png`,
                });
            }
            await recipient.locator('[data-action=close]').click();
            if (!mobile && file.format === 'json') {
                const continuous = async () =>
                    expect(
                        await recipient.evaluate(() => {
                            const old = window.__nativeOld;
                            return (
                                old.node.isConnected &&
                                old.node.__risereinPlayer.audio === old.audio &&
                                !old.audio.paused &&
                                old.audio.currentTime >= 10
                            );
                        }),
                    ).toBe(true);
                await recipient.evaluate(async () => {
                    await TavernHelper.createChatMessages([
                        { role: 'user', message: 'Native lifecycle fixture.' },
                        { role: 'assistant', message: 'Variant one.' },
                    ]);
                });
                await continuous();
                await recipient.evaluate(async () => {
                    const id = SillyTavern.getContext().chat.length - 1;
                    await TavernHelper.setChatMessages([
                        { message_id: id, swipe_id: 0, swipes: ['Variant one.', 'Variant two.'] },
                    ]);
                    const { swipe_right } = await import('/script.js');
                    await swipe_right();
                });
                await expect(recipient.locator('#chat .mes_text').last()).toContainText('Variant two.');
                await continuous();
                const last = recipient.locator('#chat .mes').last();
                await last.locator('.mes_edit').click();
                await last.locator('.edit_textarea').fill('Edited native reply.');
                await last.locator('.mes_edit_done').click();
                await expect(last.locator('.mes_text')).toContainText('Edited native reply.');
                await continuous();
                await recipient.route('**/api/backends/kobold/generate', (route) =>
                    route.fulfill({ json: { results: [{ text: 'Regenerated native response.' }] } }),
                );
                await recipient.route('**/api/tokenizers/**', (route) =>
                    route.fulfill({ json: { count: 5, ids: [1, 2, 3, 4, 5] } }),
                );
                await recipient.evaluate(async () => {
                    const { setOnlineStatus, Generate } = await import('/script.js');
                    setOnlineStatus('Native lifecycle fixture');
                    await Generate('regenerate');
                });
                await expect(recipient.locator('#chat .mes_text').last()).toContainText(
                    'Regenerated native response.',
                );
                await continuous();
            }
            await recipient.evaluate(async () => {
                const { swipe_right, saveChat, openCharacterChat } = await import('/script.js');
                await swipe_right();
                await saveChat({ force: true });
                await openCharacterChat('RSCP_Test_NativeChat_' + crypto.randomUUID());
            });
            expect(
                await recipient.evaluate(() => {
                    const old = window.__nativeOld;
                    return (
                        old.node.isConnected &&
                        old.node.__risereinPlayer.audio === old.audio &&
                        !old.audio.paused &&
                        old.audio.currentTime > 0.2
                    );
                }),
            ).toBe(true);
            await recipient.locator('#stm-launcher').click();
            await recipient.locator('[data-action=next]').click();
            await expect(recipient.locator('[data-role=title]')).toHaveText('Two');
            await recipient.locator('[data-action=next]').click();
            await expect
                .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.src))
                .toBe('https://media.riserein.example/native-tone.mp3');
            await expect
                .poll(() =>
                    recipient
                        .locator(root + ' audio')
                        .evaluate((audio) => !audio.paused && audio.currentTime > 0.1),
                )
                .toBe(true);
            await recipient.getByRole('tab', { name: '最近播放', exact: true }).click();
            await expect(recipient.locator('.stm-mini-player')).toBeVisible();
            await expect(recipient.locator('[data-view=recent] li')).toHaveCount(3);
            await mkdir(screenshotDir, { recursive: true });
            await recipient.locator('#stm-player').screenshot({
                path: `${screenshotDir}/native-${mobile ? 'mobile' : 'desktop'}-${file.format}.png`,
            });
            await selectCard(recipient, blank);
            await expect(recipient.locator(root)).toHaveCount(0);
            expect(
                await recipient.evaluate(() => {
                    const old = window.__nativeOld;
                    return (
                        old.api.disposed &&
                        old.audio.paused &&
                        !old.audio.hasAttribute('src') &&
                        Object.values(old.api.resourceCounts).every((value) => value === 0)
                    );
                }),
            ).toBe(true);
            await selectCard(recipient, avatar);
            await expect(recipient.locator(root)).toHaveCount(1);
            if (file.format === 'json') {
                await expect(recipient.locator('.stm-sleep-button')).toHaveAttribute('data-active','false');
                await recipient.getByRole('tab',{name:'曲库',exact:true}).click();
                await recipient.locator('.stm-favorites-entry').click();
                await expect(recipient.locator('.stm-favorite-list li')).toHaveCount(1);
            }
            await recipient.getByRole('tab', { name: '最近播放', exact: true }).click();
            await expect(recipient.locator('[data-view=recent] li')).toHaveCount(3);
            await selectCard(recipient, blank);
            await expect(recipient.locator(root)).toHaveCount(0);
            if (!mobile && file.format === 'json') {
                for (let i = 0; i < 3; i++) {
                    await selectCard(recipient, avatar);
                    await expect(recipient.locator(root)).toHaveCount(1);
                    await recipient.locator(root).evaluate((node) => {
                        window.__stress = node.__risereinPlayer;
                    });
                    await selectCard(recipient, blank);
                    await expect(recipient.locator(root)).toHaveCount(0);
                    expect(
                        await recipient.evaluate(
                            () =>
                                __stress.audio.paused &&
                                Object.values(__stress.resourceCounts).every((value) => value === 0),
                        ),
                    ).toBe(true);
                }
                await selectCard(recipient, avatar);
                await recipient.evaluate(() => {
                    const scripts = TavernHelper.getScriptTrees({ type: 'character' });
                    const marked =
                        SillyTavern.getContext().characters[SillyTavern.getContext().characterId].data
                            .extensions.riserein_card_player.scriptId;
                    scripts.find((script) => script.id === marked).enabled = false;
                    TavernHelper.replaceScriptTrees(scripts, { type: 'character' });
                });
                await expect(recipient.locator(root)).toHaveCount(0);
                await recipient.evaluate(() => {
                    const scripts = TavernHelper.getScriptTrees({ type: 'character' });
                    const marked =
                        SillyTavern.getContext().characters[SillyTavern.getContext().characterId].data
                            .extensions.riserein_card_player.scriptId;
                    scripts.find((script) => script.id === marked).enabled = true;
                    TavernHelper.replaceScriptTrees(scripts, { type: 'character' });
                });
                await expect(recipient.locator(root)).toHaveCount(1);
                await selectCard(recipient, blank);
                await expect(recipient.locator(root)).toHaveCount(0);
            }
        }
        expect(
            await recipient.evaluate(
                async () =>
                    !(await indexedDB.databases()).some((db) => db.name === 'riserein-sillytavern-music'),
            ),
        ).toBe(true);
        expect(errors).toEqual([]);
    });

test('native export blocks missing resources, preserves the previous card, refreshes old bindings and removes only its own script on unbind', async ({
    browser,
}) => {
    const { page } = await session(browser);
    const avatar = await createCard(page, 'NativeFailure');
    await selectCard(page, avatar);
    await page.evaluate(
        async ({ bytes, avatar }) => {
            const { LocalMusicStore } = await import(
                '/scripts/extensions/third-party/sillytavern/local-store.js'
            );
            const { createPlaylist, addTrackToPlaylist, bindPlaylistCharacters } = await import(
                '/scripts/extensions/third-party/sillytavern/core.js'
            );
            const state = SillyTavern.getContext().extensionSettings.riserein_music_player;
            const id = crypto.randomUUID();
            window.__nativeFixtureTrack = {
                id,
                kind: 'local',
                title: 'Portable original tone',
            };
            state.tracks.push(window.__nativeFixtureTrack);
            const list = createPlaylist(state, 'Failure fixture');
            addTrackToPlaylist(state, list.id, id);
            bindPlaylistCharacters(state, list.id, [avatar]);
            window.__nativeFixturePlaylist = list.id;
            // Simulates a pre-1.12 local binding: no card script exists yet.
            TavernHelper.replaceScriptTrees(
                [
                    {
                        type: 'script',
                        id: 'native-foreign',
                        enabled: false,
                        name: 'Preserve',
                        content: '/* foreign */',
                        info: 'other',
                        data: { untouched: 1 },
                        button: { enabled: false, buttons: [] },
                        export_with: { data: true, button: true },
                    },
                ],
                { type: 'character' },
            );
        },
        { bytes: Array.from(tone), avatar },
    );
    const exportCard = () =>
        page.evaluate(async (avatar) => {
            const response = await fetch('/api/characters/export', {
                method: 'POST',
                headers: SillyTavern.getContext().getRequestHeaders(),
                body: JSON.stringify({ avatar_url: avatar, format: 'json' }),
            });
            return { status: response.status, text: await response.text() };
        }, avatar);
    const missing = await exportCard();
    expect(missing.status).toBe(422);
    expect(missing.text).toContain('本地音频不在当前浏览器');
    expect(
        await page.evaluate(
            () =>
                SillyTavern.getContext().characters[SillyTavern.getContext().characterId].data.extensions
                    .riserein_card_player,
        ),
    ).toBeUndefined();
    await page.evaluate(async (bytes) => {
        const { LocalMusicStore } = await import(
            '/scripts/extensions/third-party/sillytavern/local-store.js'
        );
        await new LocalMusicStore().put(
            window.__nativeFixtureTrack.id,
            new File([new Uint8Array(bytes)], 'fixture.mp3', { type: 'audio/mpeg' }),
        );
    }, Array.from(tone));
    const other = await createCard(page, 'NativeSwitchDuringExport');
    let release,
        resourceHit = false;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    await page.route('**/card-player/dist/native-runtime.js', async (route) => {
        resourceHit = true;
        await gate;
        await route.continue();
    });
    const pending = exportCard();
    await expect.poll(() => resourceHit).toBe(true);
    await selectCard(page, other);
    release();
    const ready = await pending;
    await page.unroute('**/card-player/dist/native-runtime.js');
    expect(await page.evaluate(() => TavernHelper.getScriptTrees({ type: 'character' }))).toEqual([]);
    await selectCard(page, avatar);
    expect(ready.status, ready.text).toBe(200);
    const before = JSON.parse(ready.text),
        marker = before.data.extensions.riserein_card_player;
    expect(marker.mode).toBe('native');
    expect(before.data.extensions.tavern_helper.scripts).toHaveLength(2);
    await page.evaluate(async () => {
        const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js');
        window.__savedGet = LocalMusicStore.prototype.get;
        window.__heldRead = false;
        window.__releaseRead = null;
        const gate = new Promise(resolve => { window.__releaseRead = resolve; });
        LocalMusicStore.prototype.get = async function(id) {
            const blob = await __savedGet.call(this, id);
            if (id === __nativeFixtureTrack.id && !__heldRead) { __heldRead = true; await gate; }
            return blob;
        };
    });
    const staleExport = exportCard();
    await expect.poll(() => page.evaluate(() => __heldRead)).toBe(true);
    await page.evaluate(() => {
        const track = SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0];
        window.__oldTitle = track.title; track.title = 'Edited while resource read was pending'; __releaseRead();
    });
    const staleResult = await staleExport;
    expect(staleResult.status).toBe(422); expect(staleResult.text).toContain('已改变');
    await page.evaluate(async () => {
        const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js');
        LocalMusicStore.prototype.get = __savedGet;
        SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0].title = __oldTitle;
    });
    await page.evaluate(() => {
        SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0].title =
            'Changed before failed save';
    });
    await page.route('**/api/characters/merge-attributes', (route) =>
        route.fulfill({ status: 500, body: 'Fixture save failure' }),
    );
    const saveFailed = await exportCard();
    expect(saveFailed.status).toBe(422);
    expect(saveFailed.text).toContain('500');
    expect(
        await page.evaluate(
            (id) =>
                SillyTavern.getContext().characters[
                    SillyTavern.getContext().characterId
                ].data.extensions.tavern_helper.scripts.find((script) => script.id === id).content,
            marker.scriptId,
        ),
    ).toBe(
        before.data.extensions.tavern_helper.scripts.find((script) => script.id === marker.scriptId).content,
    );
    await page.unroute('**/api/characters/merge-attributes');
    const persisted = await page.evaluate(async (avatar) => {
        const { readCardFile } = await import(
            '/scripts/extensions/third-party/sillytavern/card-player/quality.js'
        );
        const response = await fetch('/characters/' + encodeURIComponent(avatar), { cache: 'no-store' });
        return (await readCardFile(await response.blob(), 'png')).data.extensions.tavern_helper.scripts;
    }, avatar);
    expect(persisted.find((script) => script.id === marker.scriptId).content).toBe(
        before.data.extensions.tavern_helper.scripts.find((script) => script.id === marker.scriptId).content,
    );
    await page.evaluate(async () => {
        const { LocalMusicStore } = await import(
            '/scripts/extensions/third-party/sillytavern/local-store.js'
        );
        await new LocalMusicStore().delete(window.__nativeFixtureTrack.id);
    });
    const failed = await exportCard();
    expect(failed.status).toBe(422);
    const saved = await page.evaluate(
        () =>
            SillyTavern.getContext().characters[SillyTavern.getContext().characterId].data.extensions
                .tavern_helper.scripts,
    );
    expect(saved.find((script) => script.id === marker.scriptId).content).toBe(
        before.data.extensions.tavern_helper.scripts.find((script) => script.id === marker.scriptId).content,
    );
    await page.evaluate(async () => {
        const { bindPlaylistCharacters } = await import(
            '/scripts/extensions/third-party/sillytavern/core.js'
        );
        bindPlaylistCharacters(
            SillyTavern.getContext().extensionSettings.riserein_music_player,
            window.__nativeFixturePlaylist,
            [],
        );
    });
    const unbound = await exportCard();
    expect(unbound.status).toBe(200);
    const clean = JSON.parse(unbound.text);
    expect(clean.data.extensions.riserein_card_player).toBeNull();
    expect(clean.data.extensions.tavern_helper.scripts.map((script) => script.id)).toEqual([
        'native-foreign',
    ]);
    expect(clean.data.extensions.tavern_helper.scripts[0].data.untouched).toBe(1);
});

test('saving local bindings and exporting an imported card never remove its unrelated carried player', async ({ browser }) => {
    test.setTimeout(180000);
    const { page } = await session(browser);
    const own = await createCard(page, 'LocallyManaged');
    const imported = await createCard(page, 'ImportedUnmanaged');
    await selectCard(page, own);
    await page.evaluate(async ({ prefix, bytes, own }) => {
        const { createPlaylist, addTrackToPlaylist, bindPlaylistCharacters } = await import(prefix + 'core.js');
        const { LocalMusicStore } = await import(prefix + 'local-store.js');
        const state = SillyTavern.getContext().extensionSettings.riserein_music_player;
        const id = crypto.randomUUID();
        await new LocalMusicStore().put(id, new Blob([Uint8Array.from(bytes)], { type: 'audio/mpeg' }));
        state.tracks.push({ id, kind: 'local', title: 'Original scope fixture' });
        const list = createPlaylist(state, 'Scoped local playlist');
        addTrackToPlaylist(state, list.id, id);
        bindPlaylistCharacters(state, list.id, [own]);
    }, { prefix: '/scripts/extensions/third-party/sillytavern/', bytes: Array.from(tone), own });
    const original = await page.evaluate(async ({ own, imported }) => {
        const headers = SillyTavern.getContext().getRequestHeaders();
        const response = await fetch('/api/characters/export', { method: 'POST', headers, body: JSON.stringify({ avatar_url: own, format: 'json' }) });
        if (!response.ok) throw new Error(await response.text());
        const card = await response.json();
        const extensions = structuredClone(card.data.extensions);
        const saved = await fetch('/api/characters/merge-attributes', { method: 'POST', headers, body: JSON.stringify({ avatar: imported, data: { extensions } }) });
        if (!saved.ok) throw new Error('Failed to seed imported-card fixture');
        const foreign = SillyTavern.getContext().characters.find(card => card.avatar === imported);
        foreign.data.extensions = structuredClone(extensions);
        const marker = extensions.riserein_card_player;
        return { scriptId: marker.scriptId, content: extensions.tavern_helper.scripts.find(script => script.id === marker.scriptId).content };
    }, { own, imported });
    async function serverCard(avatar) {
        const headers = await page.evaluate(() => SillyTavern.getContext().getRequestHeaders());
        const response = await page.request.post(baseURL + '/api/characters/export', { headers, data: { avatar_url: avatar, format: 'json' } });
        expect(response.ok()).toBe(true);
        return response.json();
    }
    async function bindings(avatars) {
        await page.getByRole('tab', { name: '曲库', exact: true }).click();
        await page.getByRole('button', { name: '打开歌单：Scoped local playlist', exact: true }).click();
        if (await page.locator('#stm-playlist-manager').isHidden()) await page.locator('[data-action=toggle-manager]').click();
        if (await page.locator('#stm-role-bindings').isHidden()) await page.locator('[data-action=bind-roles]').click();
        await page.locator('.stm-role-picker input').evaluateAll((inputs, avatars) => { for (const input of inputs) input.checked = avatars.includes(input.dataset.avatar); }, avatars);
        await page.locator('#stm-role-bindings button[type=submit]').click();
        await expect(page.locator('.stm-status')).toContainText('音乐已随卡保存', { timeout: 120000 });
    }
    await bindings([own]);
    const afterBinding = await serverCard(imported);
    expect(afterBinding.data.extensions.tavern_helper.scripts.find(script => script.id === original.scriptId).content).toBe(original.content);
    const wrapped = await page.evaluate(async avatar => {
        const response = await fetch('/api/characters/export', { method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(), body: JSON.stringify({ avatar_url: avatar, format: 'json' }) });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
    }, imported);
    expect(wrapped.data.extensions.tavern_helper.scripts.find(script => script.id === original.scriptId).content).toBe(original.content);
    await bindings([]);
    const cleared = await serverCard(own);
    expect(cleared.data.extensions.riserein_card_player).toBeNull();
    const preserved = await serverCard(imported);
    expect(preserved.data.extensions.tavern_helper.scripts.find(script => script.id === original.scriptId).content).toBe(original.content);
});
