const makerReport=process.env.ST_MAKER_REPORT||'docs/card-player/export-validation.json';
const screenshotDir=process.env.ST_SCREENSHOT_DIR||'docs/card-player';
import { createHash } from 'node:crypto';
import { PLAYER_BUILD } from '../card-player/quality.js';
import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const runtimeSha256 = createHash('sha256')
    .update(await readFile(new URL('../card-player/dist/runtime.js', import.meta.url)))
    .digest('hex');
const baseURL = process.env.ST_BASE_URL || 'http://127.0.0.1:8000';
const root = '[data-riserein-card-player]',
    results = [];
const tone = await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3', import.meta.url));
const image = await readFile(new URL('../assets/covers/moon.png', import.meta.url));
let sessions = [],
    cards = [];
async function selectCard(page, avatar) {
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
    await page.goto('/');
    await page.waitForFunction(() => !!window.TavernHelper, {}, { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.unroute('**/api/settings/get');
    await home(page);
    expect(await page.evaluate(() => TavernHelper.getTavernHelperVersion())).toBe('4.11.3');
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
    const trigger = page.locator(id + '-trigger');
    await trigger.scrollIntoViewIfNeeded();
    // Menus intentionally close on ancestor scrolling. Let the scroll events
    // finish before opening, as when a user scrolls to a control then clicks.
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await trigger.click();
    await page
        .locator(id + '-menu')
        .getByRole('option', { name: text, exact: true })
        .click();
}
async function download(page, button) {
    const pending = page.waitForEvent('download');
    await button.click();
    const item = await pending;
    return { name: item.suggestedFilename(), bytes: await readFile(await item.path()) };
}
async function importCard(page, bytes) {
    const avatar = await page.evaluate(async (bytes) => {
        const form = new FormData();
        form.append(
            'avatar',
            new File([new Uint8Array(bytes)], 'RSCP_Test_Import.json', { type: 'application/json' }),
        );
        form.append('file_type', 'json');
        const headers = SillyTavern.getContext().getRequestHeaders();
        delete headers['Content-Type'];
        const response = await fetch('/api/characters/import', { method: 'POST', headers, body: form });
        if (!response.ok) throw new Error('Actual JSON character import failed: ' + response.status);
        const result = await response.json();
        const { getCharacters } = await import('/script.js');
        await getCharacters();
        return result.file_name + '.png';
    }, Array.from(bytes));
    expect(avatar.startsWith('RSCP_Test_')).toBe(true);
    cards.push(avatar);
    return avatar;
}
async function enable(page) {
    await page
        .getByText(/^(确认|Confirm)$/, { exact: true })
        .last()
        .click();
    await expect(page.locator(root)).toHaveCount(1, { timeout: 30000 });
}
async function remember(page) {
    await page.locator(root).evaluate((node) => {
        window.__portableOriginal = { node, api: node.__risereinPlayer, audio: node.__risereinPlayer.audio };
    });
}
async function continuous(page, floor) {
    expect(
        await page.evaluate(() => {
            const old = window.__portableOriginal,
                node = document.querySelector('[data-riserein-card-player]');
            return node === old.node && node.__risereinPlayer.audio === old.audio && !old.audio.paused;
        }),
    ).toBe(true);
    await expect
        .poll(() => page.locator(root + ' audio').evaluate((audio) => audio.currentTime))
        .toBeGreaterThanOrEqual(floor);
}
async function gone(page) {
    await expect(page.locator(root)).toHaveCount(0);
    expect(
        await page.evaluate(() => {
            const old = window.__portableOriginal;
            return (
                old.api.disposed &&
                old.audio.paused &&
                !old.audio.hasAttribute('src') &&
                !old.node.isConnected &&
                Object.values(old.api.resourceCounts).every((value) => value === 0)
            );
        }),
    ).toBe(true);
}

test.beforeAll(async () => {
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(
        makerReport,
        JSON.stringify({ status: 'running', results: [] }) + '\n',
    );
});
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
    await writeFile(
        makerReport,
        JSON.stringify(
            {
                status:
                    results.length === 4 &&
                    results.every((item) => item.status === 'passed' && item.cleanup === 'passed')
                        ? 'passed'
                        : 'incomplete-or-failed',
                version: PLAYER_BUILD,
                runtimeSha256,
                verifiedAt: new Date().toISOString(),
                sillyTavern: '1.19.0',
                tavernHelper: '4.11.3',
                fullPluginInRecipient: false,
                recipientMusicDatabase: false,
                recipientPluginAssetsBlocked: true,
                audio: 'real browser decoding/playback of original synthetic MP3, not music API mocks',
                mobile: 'Chromium viewport/touch emulation, not physical hardware',
                results,
            },
            null,
            2,
        ) + '\n',
    );
});

for (const mobile of [false, true])
    test(`maker exports a real playlist to character JSON, reimport plays independently in a fresh ${mobile ? 'phone' : 'desktop'} browser`, async ({
        browser,
    }) => {
        const { page: author, context: authorContext } = await session(browser);
        const a = await createCard(author, mobile ? 'Phone' : 'Desktop');
        await selectCard(author, a);
        await author.getByRole('tab', { name: '曲库', exact: true }).click();
        await author.locator('[data-action=new-playlist]').click();
        await author.locator('#stm-new-playlist').fill('导出测试歌单');
        await author.getByRole('button', { name: '新建', exact: true }).click();
        const playlist = await author.locator('#stm-library-playlist').inputValue();
        await author.getByRole('tab', { name: '导入', exact: true }).click();
        await menu(author, '#stm-import-playlist', playlist);
        await author
            .locator('[data-role=files]')
            .setInputFiles(
                ['雨声', '夜航', '晨光'].map((name) => ({
                    name: name + '.mp3',
                    mimeType: 'audio/mpeg',
                    buffer: tone,
                })),
            );
        await expect(author.locator('.stm-status')).toContainText('已导入 3 首音乐');
        // Real stored background/font fixture; authoring export reads their bytes from IDB/repository.
        await author.evaluate(async (bytes) => {
            const { LocalMusicStore } = await import(
                '/scripts/extensions/third-party/sillytavern/local-store.js'
            );
            const { prepareCover } = await import('/scripts/extensions/third-party/sillytavern/media.js');
            const settings = SillyTavern.getContext().extensionSettings.riserein_music_player;
            const id = 'background:' + crypto.randomUUID();
            await new LocalMusicStore().put(
                id,
                await prepareCover(new Blob([new Uint8Array(bytes)], { type: 'image/png' })),
            );
            settings.backgroundId = id;
            settings.fontPreset = 'poxiao';
        }, Array.from(image));
        await author.getByRole('tab', { name: '曲库', exact: true }).click();
        await author.locator('[data-action=card-maker]').click();
        const maker = author.getByRole('dialog', { name: '角色卡播放器制作', exact: true });
        await expect(maker).toBeVisible();
        await expect(author.locator('.stm-maker-tracks>li')).toHaveCount(3);
        await expect(author.locator('#stm-maker-collection')).toHaveValue(playlist);
        await author.getByRole('textbox', { name: '第1首歌名', exact: true }).fill('第一首测试音乐');
        await author.getByRole('textbox', { name: '第1首歌手', exact: true }).fill('制作者');
        const first = author.locator('.stm-maker-tracks>li').first();
        await first.locator('summary').click();
        await author
            .getByRole('textbox', { name: '第1首歌词', exact: true })
            .fill('[00:00.00]第一句\n[00:08.00]第二句');
        await first
            .locator('input[type=file][accept^="image/"]')
            .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: image });
        await expect(author.locator('.stm-maker-status')).toHaveText('已更换这首歌的导出封面。');
        await first.getByRole('button', { name: '下移', exact: true }).click();
        await menu(author, '#stm-maker-theme', 'hongkong');
        await author.locator('[data-maker=prepare]').click();
        await expect(author.locator('.stm-maker-status')).toContainText('检查通过', { timeout: 60000 });
        await expect(author.locator('.stm-maker-preview')).toBeVisible();
        const preview = author.frameLocator('.stm-maker-preview');
        await preview.getByRole('button', { name: '播放角色音乐', exact: true }).click();
        await expect
            .poll(() => preview.locator(root + ' audio').evaluate((audio) => audio.currentTime))
            .toBeGreaterThan(0.2);
        await preview.locator(root).evaluate((node) => {
            window.__previewAudio = node.__risereinPlayer.audio;
        });
        await author.locator('[data-maker-color=accent]').fill('#d3aa63');
        await author.locator('[data-maker-color=accent]').dispatchEvent('input');
        await expect
            .poll(() =>
                preview
                    .locator(root)
                    .evaluate(
                        (node) =>
                            node.__risereinPlayer.audio === window.__previewAudio &&
                            !window.__previewAudio.paused &&
                            node.style.getPropertyValue('--accent') === '#d3aa63',
                    ),
            )
            .toBe(true);
        expect(
            await author.evaluate(
                () => SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0].title,
            ),
        ).toBe('雨声');
        expect(
            await author.evaluate(
                () =>
                    SillyTavern.getContext().extensionSettings.riserein_music_player.playlists[0].trackIds
                        .length,
            ),
        ).toBe(3);
        const exported = await download(author, author.locator('[data-maker=export-current]'));
        const card = JSON.parse(exported.bytes.toString());
        expect(card.data.description).toBe('Export fixture description preserved.');
        expect(card.data.extensions.unrelated_fixture).toEqual({ keep: 'world' });
        expect(card.data.extensions.tavern_helper.variables).toEqual({ preserve: 17 });
        expect(card.data.extensions.tavern_helper.scripts).toHaveLength(1);
        expect(card.data.extensions.tavern_helper.scripts[0].enabled).toBe(true);
        expect(card.data.extensions.tavern_helper.scripts[0].content).not.toContain('blob:');
        const scriptFile = await download(author, author.locator('[data-maker=script-json]'));
        expect(JSON.parse(scriptFile.bytes.toString()).content).toBe(
            card.data.extensions.tavern_helper.scripts[0].content,
        );
        const songsFile = await download(author, author.locator('[data-maker=songs]'));
        expect(JSON.parse(songsFile.bytes.toString()).font.license).toContain('SIL OPEN FONT LICENSE');
        expect(JSON.parse(songsFile.bytes.toString()).tracks.map((track) => track.title)).toEqual([
            '夜航',
            '第一首测试音乐',
            '晨光',
        ]);
        // Also exercise selecting an existing V3 card JSON, preserving an unrelated disabled script.
        const external = {
            ...structuredClone(card),
            data: {
                ...structuredClone(card.data),
                extensions: {
                    extra_data: { preserve: 'yes' },
                    tavern_helper: {
                        scripts: [
                            {
                                type: 'script',
                                id: 'unrelated-script',
                                enabled: false,
                                name: '保留原脚本',
                                content: '// keep',
                                button: { enabled: false, buttons: [] },
                                data: {},
                                info: 'original',
                                export_with: { data: true, button: true },
                            },
                        ],
                        variables: { keep: 9 },
                    },
                },
            },
        };
        const pending = author.waitForEvent('filechooser');
        await author.locator('[data-maker=export-file]').click();
        const chooser = await pending;
        const finalDownload = author.waitForEvent('download');
        await chooser.setFiles({
            name: 'existing-card.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(external)),
        });
        const merged = JSON.parse((await readFile(await (await finalDownload).path())).toString());
        expect(merged.data.extensions.extra_data).toEqual({ preserve: 'yes' });
        expect(merged.data.extensions.tavern_helper.scripts).toHaveLength(2);
        expect(merged.data.extensions.tavern_helper.scripts[0].id).toBe('unrelated-script');
        await author.locator('.stm-maker-preview').scrollIntoViewIfNeeded();
        if (!mobile) await author.screenshot({ path: `${screenshotDir}/maker-desktop.png` });
        const htmlFile = await download(author, author.locator('[data-maker=preview]'));
        const standalone = await authorContext.newPage();
        await standalone.setContent(htmlFile.bytes.toString());
        await standalone.getByRole('button', { name: '播放角色音乐', exact: true }).click();
        await expect
            .poll(() => standalone.locator(root + ' audio').evaluate((audio) => audio.currentTime))
            .toBeGreaterThan(0.1);
        await standalone.close();
        await author.evaluate(
            () =>
                new Promise((resolve, reject) => {
                    const request = indexedDB.deleteDatabase('riserein-sillytavern-music');
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                    request.onblocked = () => reject(new Error('Fixture database deletion blocked'));
                }),
        );
        await authorContext.close();
        // A distinct browser context has no source library, cached files, IDB or full-plugin runtime.
        const { page: recipient } = await session(browser, { portable: true, mobile });
        const imported = await importCard(recipient, Buffer.from(JSON.stringify(merged)));
        await selectCard(recipient, imported);
        await enable(recipient);
        await expect(recipient.locator(root + ' ol li')).toHaveCount(3);
        expect(
            await recipient.locator(root).evaluate((node) => node.style.getPropertyValue('--accent')),
        ).toBe('#d3aa63');
        await expect
            .poll(() => recipient.locator(root + ' .cover img').evaluate((img) => img.naturalWidth))
            .toBeGreaterThan(0);
        await expect
            .poll(() =>
                recipient.evaluate(
                    () =>
                        [...document.fonts].filter(
                            (face) => face.family.startsWith('rscp-') && face.status === 'loaded',
                        ).length,
                ),
            )
            .toBe(1);
        await recipient.getByRole('button', { name: '播放角色音乐', exact: true }).click();
        await expect
            .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
            .toBeGreaterThan(0.2);
        await remember(recipient);
        expect(
            await recipient
                .locator(root + ' audio')
                .evaluate((audio) => audio.src.startsWith('data:audio/mpeg;base64,')),
        ).toBe(true);
        expect(
            await recipient.evaluate(
                async () =>
                    !(await indexedDB.databases()).some((db) => db.name === 'riserein-sillytavern-music'),
            ),
        ).toBe(true);
        await recipient.getByRole('button', { name: '选择角色歌曲：第一首测试音乐', exact: true }).click();
        // Switching now fades the old track first. Its advancing time cannot prove
        // the new recording is loaded; wait for the actual selected title.
        await expect(recipient.locator(root + ' .title')).toHaveText('第一首测试音乐');
        await expect
            .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
            .toBeGreaterThan(0.1);
        await recipient.locator(root + ' .seek').fill('9');
        await recipient.locator(root + ' .seek').dispatchEvent('input');
        await recipient.getByRole('button', { name: '显示角色音乐歌词', exact: true }).click();
        await expect(recipient.locator(root + ' .lyrics .active')).toHaveText('第二句');
        await recipient.getByRole('button', { name: '返回角色音乐封面', exact: true }).click();
        await recipient.getByRole('button', { name: '暂停角色音乐', exact: true }).click();
        const paused = await recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime);
        await recipient.getByRole('button', { name: '播放角色音乐', exact: true }).click();
        await expect
            .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
            .toBeGreaterThan(paused);
        await recipient.getByRole('button', { name: '角色音乐下一首', exact: true }).click();
        await expect(recipient.locator(root + ' .title')).toHaveText('晨光');
        await recipient.getByRole('button', { name: '角色音乐上一首', exact: true }).click();
        await expect(recipient.locator(root + ' .title')).toHaveText('第一首测试音乐');
        for (const name of ['单曲循环', '随机播放', '顺序播放', '列表循环']) {
            await recipient.locator(root + ' .mode').click();
            await expect(recipient.locator(root + ' .mode')).toHaveAttribute(
                'aria-label',
                '角色播放模式：' + name,
            );
        }
        await recipient.getByRole('button', { name: '角色音乐下一首', exact: true }).click();
        await recipient.locator(root + ' .seek').fill('119.8');
        await recipient.locator(root + ' .seek').dispatchEvent('input');
        await expect(recipient.locator(root + ' .title')).toHaveText('夜航', { timeout: 10000 });
        await expect
            .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
            .toBeGreaterThan(0.1);
        await recipient.locator(root + ' .volume input').fill('77');
        await recipient.locator(root + ' .volume input').dispatchEvent('input');
        expect(await recipient.locator(root + ' audio').evaluate((audio) => audio.volume)).toBe(0.77);
        await recipient.getByRole('button', { name: '选择角色歌曲：第一首测试音乐', exact: true }).click();
        await recipient.locator(root + ' .seek').fill('9');
        await recipient.locator(root + ' .seek').dispatchEvent('input');
        await remember(recipient);
        await recipient.evaluate(async () => {
            const { swipe_right, openCharacterChat } = await import('/script.js');
            await swipe_right();
            await openCharacterChat('RSCP_Test_JSON_' + crypto.randomUUID());
        });
        await continuous(recipient, 9);
        // Mouse and touch flows both retain the same host audio, and the vinyl can move independently.
        if (!mobile) {
            const handle = recipient.locator(root + ' .head');
            const point = await handle.boundingBox();
            await recipient.mouse.move(point.x + 40, point.y + 15);
            await recipient.mouse.down();
            await recipient.mouse.move(point.x + 85, point.y - 25, { steps: 5 });
            await recipient.mouse.up();
        }
        await recipient.getByRole('button', { name: '收起角色播放器', exact: true }).click();
        const ball = recipient.getByRole('button', { name: '展开角色音乐播放器', exact: true });
        if (mobile) await ball.tap();
        else await ball.click();
        await continuous(recipient, 9);
        if (mobile)
            expect((await recipient.locator(root + ' .volume').boundingBox()).height).toBeLessThanOrEqual(30);
        await recipient.screenshot({ path: `${screenshotDir}/json-${mobile ? 'mobile' : 'desktop'}.png` });
        const b = await createCard(recipient, 'B');
        await selectCard(recipient, b);
        await gone(recipient);
        expect(
            await recipient.evaluate(
                () => [...document.fonts].filter((face) => face.family.startsWith('rscp-')).length,
            ),
        ).toBe(0);
        await selectCard(recipient, imported);
        await expect(recipient.locator(root)).toHaveCount(1);
        await remember(recipient);
        await home(recipient);
        await gone(recipient);
        // Export using ST's real JSON endpoint, reimport that file, and play once more.
        const roundTrip = await recipient.evaluate(async (avatar) => {
            const response = await fetch('/api/characters/export', {
                method: 'POST',
                headers: SillyTavern.getContext().getRequestHeaders(),
                body: JSON.stringify({ avatar_url: avatar, format: 'json' }),
            });
            if (!response.ok) throw new Error('JSON re-export failed');
            return response.json();
        }, imported);
        const again = await importCard(recipient, Buffer.from(JSON.stringify(roundTrip)));
        await selectCard(recipient, again);
        await enable(recipient);
        await recipient.getByRole('button', { name: '播放角色音乐', exact: true }).click();
        await expect
            .poll(() => recipient.locator(root + ' audio').evaluate((audio) => audio.currentTime))
            .toBeGreaterThan(0.1);
        await remember(recipient);
        await home(recipient);
        await gone(recipient);
    });

test('resource failures and edits prevent stale or partial exports without changing the original library', async ({
    browser,
}) => {
    const { page } = await session(browser, { mobile: true });
    await page.getByRole('tab', { name: '导入', exact: true }).click();
    await page
        .locator('[data-role=files]')
        .setInputFiles({ name: '不会丢失.mp3', mimeType: 'audio/mpeg', buffer: tone });
    await expect(page.locator('.stm-status')).toContainText('已导入 1 首音乐');
    await page.getByRole('tab', { name: '曲库', exact: true }).click();
    await page.locator('[data-action=card-maker]').click();
    await page
        .getByRole('textbox', { name: '第1首导出直链', exact: true })
        .fill('https://localhost/private.mp3');
    await page.locator('[data-maker=prepare]').click();
    await expect(page.locator('.stm-maker-status')).toContainText('不能使用本机');
    await expect(page.locator('.stm-maker-downloads')).toBeHidden();
    await page.getByRole('textbox', { name: '第1首导出直链', exact: true }).fill('');
    await page.locator('[data-maker=prepare]').click();
    await expect(page.locator('.stm-maker-status')).toContainText('检查通过', { timeout: 30000 });
    await page.getByRole('textbox', { name: '第1首歌名', exact: true }).fill('仅修改导出副本');
    await expect(page.locator('.stm-maker-downloads')).toBeHidden();
    expect(
        await page.evaluate(
            () => SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0].title,
        ),
    ).toBe('不会丢失');
    // A saved project owns its bytes even if the original library file is removed.
    await page.evaluate(async () => {
        const { LocalMusicStore } = await import(
            '/scripts/extensions/third-party/sillytavern/local-store.js'
        );
        await new LocalMusicStore().delete(
            SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0].id,
        );
    });
    await page.locator('[data-maker=prepare]').click();
    await expect(page.locator('.stm-maker-status')).toContainText('检查通过');
    // A NEW project copied from the now-missing library entry has no embedded draft copy.
    await page.locator('[data-maker=project-new]').click();
    await expect(page.getByRole('textbox', { name: '第1首歌名', exact: true })).toHaveValue('不会丢失');
    await page.locator('[data-maker=prepare]').click();
    await expect(page.locator('.stm-maker-status')).toContainText('本地音频不在当前浏览器');
    await expect(page.locator('.stm-maker-downloads')).toBeHidden();
    await page.locator('[data-maker=close]').click();
    await expect(page.locator('[data-action=card-maker]')).toBeEnabled();
});

test('maker shared design exports independent JS, HTML and Helper JSON then plays in a clean recipient',async({browser})=>{
 test.setTimeout(180000);const{page:author,context:authorContext}=await session(browser),a=await createCard(author,'SharedStudio');await selectCard(author,a);await author.getByRole('tab',{name:'导入',exact:true}).click();await author.locator('[data-role=files]').setInputFiles({name:'shared.mp3',mimeType:'audio/mpeg',buffer:tone});await expect(author.locator('.stm-status')).toContainText('已导入 1 首');
 await author.getByRole('tab',{name:'外观',exact:true}).click();await menu(author,'#stm-design-layout','cassette');await menu(author,'#stm-design-theme','smoke');await menu(author,'#stm-design-launcher','cd');
 await author.getByRole('tab',{name:'曲库',exact:true}).click();await author.locator('[data-action=card-maker]').click();await author.locator('[data-maker=capture-design]').click();await expect(author.locator('[data-maker=shared-design]')).toBeChecked();await menu(author,'#stm-maker-recipient-display','docked');await author.locator('[data-maker=prepare]').click();await expect(author.locator('.stm-maker-status')).toContainText('检查通过',{timeout:60000});
 const preview=author.frameLocator('.stm-maker-preview');await expect(preview.locator('#stm-player')).toHaveAttribute('data-layout','cassette');await expect(preview.locator('#stm-player')).toBeHidden();await expect(preview.locator('.stm-launcher')).toHaveAttribute('data-display','docked');await preview.locator('.stm-launcher').click();await preview.locator('[data-action=play]').click();await expect.poll(()=>preview.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);
 for(const [action,expected]of [['javascript','startNativeCharacterPlayer'],['preview','startNativePreview'],['script-json','export_with']]){const pending=author.waitForEvent('download');await author.locator('[data-maker='+action+']').click();const file=await pending,content=await readFile(await file.path(),'utf8');expect(content).toContain(expected);expect(content).not.toContain('indexedDB.open');}
 const pending=author.waitForEvent('download');await author.locator('[data-maker=export-current]').click();const file=await pending,bytes=await readFile(await file.path());await expect(author.locator('.stm-maker-status')).toContainText('已导出含播放器');await authorContext.close();const{page:recipient}=await session(browser,{portable:true});const imported=await importCard(recipient,bytes);await selectCard(recipient,imported);await enable(recipient);await expect(recipient.locator('#stm-player')).toHaveAttribute('data-layout','cassette');await expect(recipient.locator('#stm-launcher')).toHaveAttribute('data-launcher','cd');await expect(recipient.locator('[data-action=open-designer]')).toHaveCount(0);await expect(recipient.locator('#stm-player')).toBeHidden();await expect(recipient.locator('.stm-launcher')).toHaveAttribute('data-display','docked');await recipient.locator('.stm-launcher').click();await recipient.locator('[data-action=play]').click();await expect.poll(()=>recipient.locator('#stm-player audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);await remember(recipient);await home(recipient);await gone(recipient);
});
