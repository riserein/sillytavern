import { test, expect, chromium } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const prefix = '/scripts/extensions/third-party/sillytavern/';
const image = await readFile(new URL('../assets/covers/moon.png', import.meta.url));
const font = await readFile(new URL('../assets/fonts/ChildFunSans.woff2', import.meta.url));
test.beforeEach(async ({ page }) => {
    await page.route('**/api/settings/save', route => route.fulfill({ status: 500, body: 'controlled failure; never write fixture settings to the host profile' }));
    await page.route('**/audit-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body><div id="extensions_settings"></div></body>' }));
    await page.goto('/audit-fixture');
});
async function fullPlayer(page) {
    await page.evaluate(async prefix => {
        const { LocalMusicStore } = await import(prefix + 'local-store.js');
        const { initialize } = await import(prefix + 'index.js');
        window.store = new LocalMusicStore();
        window.oldCover = 'cover:11111111-1111-4111-8111-111111111111';
        await store.put(oldCover, new Blob(['old-cover'], { type: 'image/png' }));
        window.savedBodies = [];
        const context = {
            characters: [],
            extensionSettings: { riserein_music_player: { tracks: [{ id: 'original', kind: 'url', title: 'Original song', url: 'https://audio.example.org/a.mp3', coverId: oldCover }], fontPreset: 'inherit' } },
            saveSettingsDebounced() {
                clearTimeout(window.pendingSave);
                window.pendingSave = setTimeout(async () => {
                    const body = JSON.stringify({ extension_settings: window.overridePostedSettings || context.extensionSettings });
                    savedBodies.push(JSON.parse(body));
                    await fetch('/api/settings/save', { method: 'POST', body });
                }, 20);
            },
        };
        // Saves are intercepted in this controlled fixture; no real host settings are written.
        window.appContext = context;
        window.app = initialize({ context });
        app.setOpen(true);
    }, prefix);
}
test('replacing artwork retains the previous bytes when metadata save fails', async ({ page }) => {
    await page.route('**/api/settings/save', route => route.fulfill({ status: 500, body: 'injected save failure' }));
    await fullPlayer(page);
    await page.evaluate(() => window.beforeMetadata = structuredClone(app.settings));
    const saved = page.waitForResponse(response => response.url().endsWith('/api/settings/save'));
    await page.getByRole('tab', { name: '曲库', exact: true }).click();
    await page.getByRole('button', { name: '打开歌单：总曲库', exact: true }).click();
    await page.getByRole('button', { name: '歌曲详情：Original song', exact: true }).click();
    await page.locator('[data-role=song-cover-file]').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: image });
    await saved;
    await expect(page.locator('.stm-status')).toContainText('旧资源已保留');
    expect(await page.evaluate(async () => Boolean(await store.get(oldCover)))).toBe(true);
    expect(await page.evaluate(() => beforeMetadata.tracks[0].coverId)).toBe(await page.evaluate(() => oldCover));
});
test('font import finishing after full-player disposal cannot attach a face or save zombie metadata', async ({ page }) => {
    await page.route('**/api/settings/save', route => route.fulfill({ body: '{"result":"ok"}' }));
    await fullPlayer(page);
    await page.evaluate(() => {
        const Original = FontFace;
        window.FontFace = class extends Original {
            async load() {
                window.fontLoadStarted = true;
                await new Promise(resolve => { window.finishFontLoad = resolve; });
                return super.load();
            }
        };
    });
    await page.locator('[data-role=font-file]').setInputFiles({ name: 'test.woff2', mimeType: 'font/woff2', buffer: font });
    await page.waitForFunction(() => window.fontLoadStarted);
    await page.evaluate(() => { app.dispose(); finishFontLoad(); });
    await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [...document.fonts].filter(face => face.family.startsWith('stm-font-')).length)).toBe(0);
    expect(await page.evaluate(() => app.settings.fonts.length)).toBe(0);
});
test('an HTTP success for old metadata does not delete bytes, then a matching new save can retire them', async ({ page }) => {
    await page.route('**/api/settings/save', route => route.fulfill({ body: '{"result":"ok"}' }));
    await fullPlayer(page);
    await page.evaluate(() => window.overridePostedSettings = structuredClone(appContext.extensionSettings));
    await page.getByRole('tab', { name: '曲库', exact: true }).click();
    await page.getByRole('button', { name: '打开歌单：总曲库', exact: true }).click();
    await page.getByRole('button', { name: '歌曲详情：Original song', exact: true }).click();
    await page.locator('[data-role=song-cover-file]').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: image });
    await expect(page.locator('.stm-status')).toHaveText('歌曲封面已更新。');
    await expect.poll(() => page.evaluate(() => savedBodies.length)).toBeGreaterThan(0);
    expect(await page.evaluate(async () => Boolean(await store.get(oldCover)))).toBe(true);
    await page.evaluate(() => { window.overridePostedSettings = null; appContext.saveSettingsDebounced(); });
    await expect.poll(() => page.evaluate(async () => Boolean(await store.get(oldCover)))).toBe(false);
    expect(await page.evaluate(async () => Boolean(await store.get(app.settings.tracks[0].coverId)))).toBe(true);
});
test('real IndexedDB quota failure leaves the previous resource readable', async () => {
    // A separate disk profile keeps quota testing independent of the other fixtures.
    const directory = await mkdtemp(join(tmpdir(), 'stm-quota-audit-'));
    let context;
    try {
        context = await chromium.launchPersistentContext(directory, { headless: true, executablePath: process.env.CHROMIUM_PATH });
        const page = context.pages()[0];
        await page.route('**/audit-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body><div id="extensions_settings"></div></body>' }));
        await page.route('**/api/settings/save', route => route.fulfill({ status: 500, body: 'controlled' }));
        await page.goto((process.env.ST_BASE_URL || 'http://127.0.0.1:8000') + '/audit-fixture');
        await fullPlayer(page);
        // Restart so IndexedDB cannot use the free-space cache from its successful seed write.
        await context.close();
        context = await chromium.launchPersistentContext(directory, { headless: true, executablePath: process.env.CHROMIUM_PATH });
        const cold = context.pages()[0];
        await cold.route('**/audit-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' }));
        await cold.goto((process.env.ST_BASE_URL || 'http://127.0.0.1:8000') + '/audit-fixture');
        const cdp = await context.newCDPSession(cold);
        await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(cold.url()).origin, quotaSize: 1 });
        const estimate = await cold.evaluate(() => navigator.storage.estimate());
        const backend = await cdp.send('Storage.getUsageAndQuota', { origin: new URL(cold.url()).origin });
        await test.info().attach('quota-estimate', { body: JSON.stringify({ estimate, backend }), contentType: 'application/json' });
        expect(backend.overrideActive).toBe(true);
        const result = await cold.evaluate(async prefix => {
            const { LocalMusicStore } = await import(prefix + 'local-store.js');
            const store = new LocalMusicStore(), oldCover = 'cover:11111111-1111-4111-8111-111111111111';
            let error;
            try { await store.put('quota-new', new Blob([new Uint8Array(32 * 1024 * 1024)])); }
            catch (failure) { error = failure.name; }
            return { error, old: await (await store.get(oldCover)).text(), added: Boolean(await store.get('quota-new')) };
        }, prefix);
        expect(result).toEqual({ error: 'QuotaExceededError', old: 'old-cover', added: false });
    } finally { await context?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('audio import finishing after disposal cannot commit a track or leave its uncommitted blob', async ({ page }) => {
    await fullPlayer(page);
    await page.evaluate(async prefix => {
        const { LocalMusicStore } = await import(prefix + 'local-store.js');
        const put = LocalMusicStore.prototype.put;
        LocalMusicStore.prototype.put = async function(id, blob) {
            if (blob.type.startsWith('audio/')) {
                window.lateAudioId = id;
                await new Promise(resolve => { window.finishAudioWrite = resolve; });
                await put.call(this, id, blob);
                window.audioWriteFinished = true;
                return;
            }
            return put.call(this, id, blob);
        };
    }, prefix);
    const tone = await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3', import.meta.url));
    await page.locator('[data-role=files]').setInputFiles({ name: 'late.mp3', mimeType: 'audio/mpeg', buffer: tone });
    await page.waitForFunction(() => window.lateAudioId);
    await page.evaluate(() => { app.dispose(); finishAudioWrite(); });
    await page.waitForFunction(() => window.audioWriteFinished);
    await expect.poll(() => page.evaluate(async () => Boolean(await store.get(lateAudioId)))).toBe(false);
    expect(await page.evaluate(() => app.settings.tracks.length)).toBe(1);
});
test('lyrics text read finishing after disposal cannot modify the previous player settings', async ({ page }) => {
    await fullPlayer(page);
    await page.getByRole('tab', { name: '曲库', exact: true }).click();
    await page.getByRole('button', { name: '打开歌单：总曲库', exact: true }).click();
    await page.getByRole('button', { name: '歌曲详情：Original song', exact: true }).click();
    await page.evaluate(() => {
        const text = File.prototype.text;
        File.prototype.text = async function() {
            await new Promise(resolve => { window.finishLyricRead = resolve; });
            const value = await text.call(this);
            window.lyricReadFinished = true;
            return value;
        };
    });
    await page.locator('[data-role=lyrics-file]').setInputFiles({ name: 'late.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:01]late lyrics') });
    await page.waitForFunction(() => window.finishLyricRead);
    await page.evaluate(() => { app.dispose(); finishLyricRead(); });
    await page.waitForFunction(() => window.lyricReadFinished);
    expect(await page.evaluate(() => app.settings.tracks[0].lyrics || '')).toBe('');
});
test('manual card verification never runs code carried by an untrusted script', async ({ page }) => {
    const result = await page.evaluate(async prefix => {
        const { verifyCardFile, payloadLiteral } = await import(prefix + 'card-player/quality.js');
        const config = { id: 'audit', title: '<img src=x onerror="window.auditInjected=1">', tracks: [{ id: 'one', src: 'https://audio.example.org/a.mp3', title: '<script>window.auditInjected=1</script>', cover: '' }], appearance: {} };
        const card = { spec: 'chara_card_v3', data: { name: 'Read only', extensions: { riserein_card_player: { scriptId: 'audit', projectId: 'audit' }, tavern_helper: { scripts: [{ type: 'script', id: 'audit', enabled: true, content: 'window.auditInjected=1;'+payloadLiteral({ config }) }] } } } };
        const report = await verifyCardFile(new Blob([JSON.stringify(card)]), 'json');
        return { static: report.static, injected: Boolean(window.auditInjected) };
    }, prefix);
    expect(result).toEqual({ static: 'passed', injected: false });
});
test('character scope refuses a disabled script or a disabled parent folder before mounting UI', async ({ page }) => {
    const errors = await page.evaluate(async prefix => {
        const { createCharacterScope } = await import(prefix + 'card-player/entry.js');
        Object.assign(window, { getScriptId: () => 'audit', getCurrentCharacterId: () => 'audit.png', eventOn() {}, eventRemoveListener() {} });
        const errors = [];
        for (const scripts of [[{ id: 'audit', enabled: false }], [{ type: 'folder', enabled: false, scripts: [{ id: 'audit', enabled: true }] }]]) {
            window.getScriptTrees = () => scripts;
            try { createCharacterScope(); } catch (error) { errors.push(error.message); }
        }
        return errors;
    }, prefix);
    expect(errors).toHaveLength(2);
    expect(errors.every(error => error.includes('已启用角色脚本'))).toBe(true);
});
test('an invalid key in a multi-delete aborts the entire real IndexedDB transaction', async ({ page }) => {
    await fullPlayer(page);
    const result = await page.evaluate(async () => {
        let error;
        try { await store.deleteMany([oldCover, undefined]); }
        catch (failure) { error = failure.name; }
        await new Promise(resolve => setTimeout(resolve, 50));
        return { error, oldPresent: Boolean(await store.get(oldCover)) };
    });
    expect(result).toEqual({ error: 'DataError', oldPresent: true });
});
test('export error notifications render untrusted song titles as text even when another extension enables HTML toasts', async ({ page }) => {
    await page.addScriptTag({ url: '/lib/jquery-3.5.1.min.js' });
    await page.addScriptTag({ url: '/lib/toastr.min.js' });
    await page.route('**/audit-bad-image', route => route.fulfill({ status: 404, body: '' }));
    const result = await page.evaluate(async prefix => {
        const { createNativeCardExport } = await import(prefix + 'card-player/native-export.js');
        const { normalizeSettings } = await import(prefix + 'core.js');
        const title = '<img src="/audit-bad-image" onerror="window.auditToastInjected=1">';
        toastr.options.escapeHtml = false;
        const settings = normalizeSettings({ tracks: [{ id: 'missing', kind: 'local', title }], playlists: [{ id: 'audit-list', name: 'Audit', trackIds: ['missing'], characterAvatars: ['audit.png'] }] });
        const context = { characterId: 0, characters: [{ avatar: 'audit.png', name: 'Audit', data: { name: 'Audit', extensions: {} } }] };
        const api = createNativeCardExport({ settings, store: { get: async () => undefined }, getContext: () => context, showStatus() {} });
        try { return (await fetch('/api/characters/export', { method: 'POST', body: JSON.stringify({ avatar_url: 'audit.png', format: 'json' }) })).status; }
        finally { api.dispose(); }
    }, prefix);
    expect(result).toBe(422);
    if (await page.locator('.toast-message img').count())
        await expect.poll(() => page.locator('.toast-message img').evaluate(node => node.complete)).toBe(true);
    const observation = await page.evaluate(() => ({ injected: Boolean(window.auditToastInjected), htmlImages: document.querySelectorAll('.toast-message img').length }));
    await test.info().attach('toast-observation', { body: JSON.stringify(observation), contentType: 'application/json' });
    await expect(page.locator('.toast-message')).toContainText('<img');
    await expect(page.locator('.toast-message img')).toHaveCount(0);
    expect(await page.evaluate(() => Boolean(window.auditToastInjected))).toBe(false);
});

test('stale project delete rolls back instead of removing a newer revision', async ({ page }) => {
    const result = await page.evaluate(async prefix => {
        const { CardProjectStore } = await import(prefix + 'card-player/project-store.js');
        const a = new CardProjectStore(), b = new CardProjectStore();
        const id = 'stale-' + crypto.randomUUID();
        const old = await a.save({id,title:'old'},0);
        const newer = await b.save({id,title:'new'},old.revision);
        let rejected = false;
        try { await a.delete(id,old.revision); } catch { rejected = true; }
        const retained = await b.get(id);
        await b.delete(id,newer.revision);
        await a.dispose(); await b.dispose();
        return {rejected,title:retained.title,revision:retained.revision};
    }, prefix);
    expect(result).toEqual({rejected:true,title:'new',revision:2});
});
