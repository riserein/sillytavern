import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
const prefix = '/scripts/extensions/third-party/sillytavern/';
const tone = await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3', import.meta.url));

async function fixture(page) {
    await page.route('**/reading-fixture', r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${prefix}ui/player.css"><style>body{margin:0;background:repeating-conic-gradient(#fff 0 25%,#000 0 50%) 0/70px 70px}*,*::before,*::after{animation:none!important;transition:none!important}</style><body></body>` }));
    await page.goto('/reading-fixture');
    await page.evaluate(async prefix => {
        const { initialize } = await import(prefix + 'index.js');
        const lyrics = Array.from({ length: 50 }, (_, i) => `[${String(Math.floor(i * 2 / 60)).padStart(2, '0')}:${String(i * 2 % 60).padStart(2, '0')}]歌词原文 ${i + 1} · 风与故事继续`).join('\n');
        window.testContext = { extensionSettings: { riserein_music_player: { tracks: [{ id: 'read-a', title: '阅读 A', artist: '阅读辅助信息', kind: 'url', url: location.origin + prefix + 'card-player/demo-assets/test-tone-a.mp3', lyrics }, { id: 'read-b', title: '阅读 B', kind: 'url', url: location.origin + prefix + 'card-player/demo-assets/test-tone-b.mp3', lyrics }], theme: 'night', fontPreset: 'sans', colorScheme: 'dark', surface: 'glass', transitionDuration: 0, panelSize: { width: 600, height: 740 } } }, characters: [], saveSettingsDebounced() { window.readingSaves = (window.readingSaves || 0) + 1; } };
        window.app = initialize({ context: testContext }); app.setOpen(true); window.keptReadingAudio = app.audio;
    }, prefix);
    await expect(page.locator('#stm-player')).toHaveAttribute('data-reading', 'clear');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(a => Number.isFinite(a.duration))).toBe(true);
}

test('rendered contrast matrix: all old palettes and all new layouts, schemes, surfaces and image extremes', async ({ page }, info) => {
    await fixture(page);
    const result = await page.evaluate(async prefix => {
        const { contrastRatio, colorChannels, compositeColor } = await import(prefix + 'ui/contrast.js');
        const cases = [], failures = [];
        const palettes = ['inherit', 'mist-blue', 'walnut', 'cream', 'smoke', 'ink', 'blush'];
        const rows = ['night', 'amber', 'ocean', 'forest', 'rose', 'lavender', 'pearl'].map(theme => ({ layout: 'night', theme, designTheme: 'inherit' })).concat(['crystal', 'vinyl', 'cassette', 'pure'].flatMap(layout => palettes.slice(1).map(designTheme => ({ layout, theme: 'night', designTheme }))));
        rows.push({ layout: 'crystal', theme: 'night', designTheme: 'inherit', custom: true });
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
        const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 80, 80); c.fillStyle = '#000'; c.fillRect(0, 0, 40, 40); c.fillRect(40, 40, 40, 40); const image = canvas.toDataURL();
        const { sampleReadingInk: sample } = await import(prefix + 'tests/rendered-reading.js');
        for (const row of rows) for (const scheme of ['dark', 'light']) for (const surface of ['matte', 'glass', 'clear']) for (const hasImage of [false, true]) {
            Object.assign(app.settings, { theme: row.theme, surface, colorScheme: scheme, customColors: row.custom ? { enabled: true, background: '#858585', text: '#898989', accent: '#888888' } : { ...app.settings.customColors, enabled: false } });
            document.querySelector('[data-scheme-choice=' + scheme + ']').click();
            app.setDesign({ layout: row.layout, theme: row.designTheme, ...(row.custom ? { components: { title: { color: '#858585', opacity: .5, size: .65 } } } : {}) });
            const panel = document.querySelector('#stm-player');
            panel.dataset.hasBackground = String(hasImage); panel.style.setProperty('--stm-background-image', hasImage ? `url("${image}")` : 'none'); panel.style.setProperty('--stm-mask-opacity', hasImage ? '0' : surface === 'matte' ? '1' : '.1');
            await new Promise(requestAnimationFrame);
            const samples = { title: sample(panel.querySelector('[data-role=title]')), auxiliary: sample(panel.querySelector('[data-role=source]')), navigation: sample(panel.querySelector('[data-page=recent]')), selection: sample(panel.querySelector('[data-page=playback]')), primary: sample(panel.querySelector('[data-action=play]')) };
            panel.querySelector('[data-action=toggle-lyrics]').click(); app.audio.currentTime = 20; app.audio.dispatchEvent(new Event('timeupdate'));
            samples.lyrics = sample(panel.querySelector('.stm-lyrics-lines p:not(.stm-current-lyric)')); samples.current = sample(panel.querySelector('.stm-current-lyric'));
            panel.querySelector('[data-action=back-cover]').click();
            const item = { ...row, scheme, surface, hasImage, samples }; cases.push(item);
            for (const [name, value] of Object.entries(samples)) if (!value.safe || value.ratio < 4.5 || value.opacity !== 1 || value.size < (name === 'auxiliary' ? 12 : 12)) failures.push({ ...row, scheme, surface, hasImage, name, value });
        }
        return { cases, failures };
    }, prefix);
    await mkdir(process.env.ST_READING_REPORT_DIR || 'docs/readability/results', { recursive: true });
    await writeFile(`${process.env.ST_READING_REPORT_DIR || 'docs/readability/results'}/matrix-${info.project.name}.json`, JSON.stringify(result, null, 2));
    expect(result.cases.length).toBe(384);
    expect(result.failures).toEqual([]);
});

test('manual reading survives new LRC lines; resume, text clicks, keys, reopening and song changes preserve audio', async ({ page }) => {
    await fixture(page);
    // This regression asserts exact centering. Flow motion is tested separately.
    await page.evaluate(() => { app.settings.reading.displayMode = 'centered'; });
    const audio = page.locator('#stm-player audio');
    await page.locator('[data-action=play]').click(); await expect.poll(() => audio.evaluate(a => a.currentTime)).toBeGreaterThan(.2);
    await page.locator('[data-action=toggle-lyrics]').click();
    await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'true');
    const scroll = page.locator('.stm-lyrics-scroll');
    await scroll.hover(); await page.mouse.wheel(0, 400);
    await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'false');
    await expect(page.locator('[data-action=resume-lyrics]')).toBeVisible();
    // Stop wheel momentum before measuring manual position; no timeout weakening.
    await expect.poll(async () => { const a = await scroll.evaluate(n => n.scrollTop); await page.waitForTimeout(60); return Math.abs(a - await scroll.evaluate(n => n.scrollTop)) < 1; }).toBe(true);
    const before = await scroll.evaluate(n => n.scrollTop);
    await audio.evaluate(a => { a.currentTime = 50; a.dispatchEvent(new Event('timeupdate')); });
    await expect(page.locator('.stm-current-lyric')).toContainText('歌词原文 26');
    expect(await scroll.evaluate(n => n.scrollTop)).toBe(before);
    await page.locator('.stm-lyrics-lines p').nth(8).evaluate(n => n.click());
    await expect(page.locator('.stm-lyrics-view')).toBeVisible();
    await page.locator('[data-action=resume-lyrics]').click();
    await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'true');
    const center = await page.locator('.stm-current-lyric').evaluate(n => { const s = n.closest('.stm-lyrics-scroll'); return Math.abs(n.getBoundingClientRect().top + n.clientHeight / 2 - s.getBoundingClientRect().top - s.clientHeight / 2); });
    expect(center).toBeLessThan(3);
    await scroll.focus(); await page.keyboard.press('PageUp');
    await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'false');
    await page.evaluate(() => app.setOpen(false)); await page.locator('#stm-launcher').click();
    await expect(scroll).toBeFocused(); await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'true');
    await page.keyboard.press('Escape'); await expect(page.locator('.stm-lyrics-view')).toBeHidden();
    await page.locator('[data-action=toggle-lyrics]').click(); await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'true');
    await page.locator('[data-action=back-cover]').click(); await page.locator('[data-action=next]').click();
    await expect(page.locator('[data-role=title]')).toHaveText('阅读 B');
    await page.locator('[data-action=toggle-lyrics]').click(); await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'true');
    expect(await page.evaluate(() => keptReadingAudio === app.audio && !app.audio.paused)).toBe(true);
    expect(await page.evaluate(() => app.settings.tracks[0].lyrics)).toContain('[00:00]歌词原文 1');
});

test('component background overrides retain unframed text and cannot defeat the shared reading surface', async ({ page }) => {
    await fixture(page);
    const checks = await page.evaluate(async prefix => {
        const { colorChannels } = await import(prefix + 'ui/contrast.js');
        const { sampleReadingInk } = await import(prefix + 'tests/rendered-reading.js');
        const result = [];
        for (const layout of ['night', 'crystal', 'vinyl', 'cassette', 'pure']) for (const visible of [true, false]) for (const color of ['#ffffff', '#000000']) {
            app.setDesign({ layout, theme: 'inherit', customization: { colors: { background: '#858585', text: '#858585', muted: '#858585', accent: '#858585' } }, components: { background: { color, opacity: .5, visible }, title: { color: '#858585', opacity: .5, size: .65 }, artist: { color: '#858585', opacity: .5, size: .65 } } });
            await new Promise(requestAnimationFrame);
            const title = document.querySelector('[data-role=title]'), artist = document.querySelector('[data-role=source]'), plate = getComputedStyle(document.querySelector('.stm-now-info'));
            const veil=getComputedStyle(document.querySelector('#stm-player'),'::after');
            result.push({ layout, visible, color, plateAlpha: colorChannels(plate.backgroundColor)?.[3], painted: plate.display !== 'contents', veilDisplay:veil.display,veilAlpha:colorChannels(veil.backgroundColor)?.[3],title: sampleReadingInk(title).ratio, artist: sampleReadingInk(artist).ratio, opacity: getComputedStyle(title).opacity, savedOpacity: app.getDesign().components.title.opacity });
        }
        return result;
    }, prefix);
    for (const row of checks) { expect(row.plateAlpha).toBe(0); expect(row.painted).toBe(true);expect(row.veilDisplay).not.toBe('none');expect(row.veilAlpha).toBeGreaterThanOrEqual(.89); expect(row.title,JSON.stringify(row)).toBeGreaterThanOrEqual(4.5); expect(row.artist,JSON.stringify(row)).toBeGreaterThanOrEqual(4.5); expect(row.opacity).toBe('1'); expect(row.savedOpacity).toBe(.5); }
});

test('destructive, error and warning text retain semantic contrast, including pressed buttons', async ({ page }) => {
    await fixture(page);
    await page.getByRole('tab', { name: '曲库', exact: true }).click(); await page.locator('.stm-collection-open[data-collection-id=""]').click();
    await page.getByRole('button', { name: '歌曲详情：阅读 A', exact: true }).click();
    const results = await page.evaluate(async prefix => {
        const { sampleReadingInk } = await import(prefix + 'tests/rendered-reading.js'), panel = document.querySelector('#stm-player');
        const error = document.createElement('p'), warning = document.createElement('p'); error.className = 'stm-error'; warning.className = 'stm-warning'; error.textContent = '测试错误'; warning.textContent = '测试警告'; panel.querySelector('.stm-details-summary').append(error, warning);
        const rows = [];
        for (const scheme of ['light', 'dark']) {
            panel.querySelector('[data-scheme-choice=' + scheme + ']').click();
            for (const node of [error, warning, panel.querySelector('[data-action=detail-delete]')]) { const css = getComputedStyle(node); rows.push({ color: css.color, ratio: sampleReadingInk(node).ratio }); }
        }
        return rows;
    }, prefix);
    for (const row of results) expect(row.ratio).toBeGreaterThanOrEqual(4.5);
    const button = page.locator('[data-action=detail-delete]'); await button.hover(); await page.mouse.down();
    await expect(button).toHaveCSS('filter', 'none');
    // Release off the destructive control: inspect the pressed style without deleting.
    await page.mouse.move(0, 0); await page.mouse.up();
    await page.getByRole('button', { name: '关闭歌曲详情', exact: true }).click();
    await expect(page.locator('.stm-mini-player')).toBeVisible(); await expect(page.locator('.stm-mini-player')).toHaveCSS('border-radius', '24px');
});

test('disposed role guard forwards an in-flight same-account host save through another extension wrapper', async ({ page }) => {
    await page.route('**/reading-guard-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('/reading-guard-fixture');
    await page.evaluate(async prefix => {
        const { identifyAccount } = await import(prefix + 'data/identity.js');
        window.guardWaiting = false; window.guardSaveCount = 0; window.holdGuardRequest = false; window.guardProfile = 'reading-fixture';
        const fixtureFetch = async (url, options = {}) => {
            if (String(url).endsWith('/api/users/me')) {
                if (holdGuardRequest) return new Promise((resolve, reject) => { guardWaiting = true; options.signal.addEventListener('abort', () => reject(new DOMException('role exited', 'AbortError')), { once: true }); });
                return Response.json({ handle: guardProfile, created: 1, name: 'Synthetic test account' });
            }
            guardSaveCount++; return Response.json({ result: 'ok' });
        };
        window.guardAccount = await identifyAccount({ fetcher: fixtureFetch }); window.fetch = fixtureFetch;
        const frame = document.createElement('iframe'); frame.id = 'guard-frame';
        frame.srcdoc = `<script type="module">import {createAccountGuard} from '${prefix}data/identity.js';window.fixtureGuard=createAccountGuard({account:parent.guardAccount,context:{getRequestHeaders(){return {}}},host:parent,onMismatch(){}});parent.guardReady=true;<\/script>`;
        document.body.append(frame);
    }, prefix);
    await page.waitForFunction(() => window.guardReady);
    await page.evaluate(() => {
        holdGuardRequest = true;
        const previous = window.fetch; window.fetch = function (...args) { return previous.apply(this, args); };
        window.guardPending = fetch('/api/settings/save', { method: 'POST' }).then(r => r.json()).catch(e => ({ error: e.message }));
    });
    await page.waitForFunction(() => window.guardWaiting);
    await page.evaluate(() => { holdGuardRequest=false; const f = document.getElementById('guard-frame'); f.contentWindow.fixtureGuard.dispose(); f.remove(); });
    expect(await page.evaluate(() => guardPending)).toEqual({ result: 'ok' });
    expect(await page.evaluate(async () => { try { return await (await fetch('/api/settings/save', { method: 'POST' })).json(); } catch (e) { return { error: e.message }; } })).toEqual({ result: 'ok' });
    expect(await page.evaluate(() => guardSaveCount)).toBe(2);
    await page.evaluate(prefix => {
        holdGuardRequest = false; guardProfile = 'reading-fixture'; window.guardReady = false; guardWaiting=false;
        const frame = document.createElement('iframe'); frame.id = 'guard-frame';
        frame.srcdoc = `<script type="module">import {createAccountGuard} from '${prefix}data/identity.js';window.fixtureGuard=createAccountGuard({account:parent.guardAccount,context:{getRequestHeaders(){return {}}},host:parent,onMismatch(){window.fixtureGuard.dispose()}});parent.guardReady=true;<\/script>`;
        document.body.append(frame);
    }, prefix);
    await page.waitForFunction(() => window.guardReady);
    await page.evaluate(()=>{
        holdGuardRequest=true;
        const prior=fetch;window.fetch=function(...args){return prior.apply(this,args);};
        window.guardPending=fetch('/api/settings/save',{method:'POST'}).then(r=>r.status);
    });
    await page.waitForFunction(()=>guardWaiting);
    await page.evaluate(()=>{holdGuardRequest=false;guardProfile='other-account';const f=document.getElementById('guard-frame');f.contentWindow.fixtureGuard.dispose();f.remove();});
    expect(await page.evaluate(()=>guardPending)).toBe(409);
    expect(await page.evaluate(async () => (await fetch('/api/settings/save', { method: 'POST' })).status)).toBe(409);
    expect(await page.evaluate(() => guardSaveCount)).toBe(2);
});

test('all reading levels and lyric backgrounds protect custom colors; real touch swipes suspend follow', async ({ page }, info) => {
    await fixture(page);
    await page.evaluate(() => app.setDesign({ layout: 'crystal', theme: 'inherit', customization: { colors: { background: '#858585', text: '#858585', muted: '#858585', accent: '#858585' } } }));
    for (const level of ['standard', 'clear', 'high']) for (const background of ['auto', 'transparent', 'soft']) {
        await page.evaluate(({ level, background }) => {
            document.querySelector('[data-page=appearance]').click();
            for (const [id, value] of [['stm-reading-level', level], ['stm-lyric-background', background]]) { const select = document.getElementById(id); select.value = value; select.dispatchEvent(new Event('change')); }
            document.querySelector('[data-page=playback]').click(); document.querySelector('[data-action=toggle-lyrics]').click();
        }, { level, background });
        const data = await page.locator('.stm-lyrics-lines p:not(.stm-current-lyric)').first().evaluate(async n => {
            const { contrastRatio,compositeColor } = await import('/scripts/extensions/third-party/sillytavern/ui/contrast.js'); const css = getComputedStyle(n),mask=getComputedStyle(n.closest('.stm-lyrics-scroll')).backgroundColor;
            return { ratio: Math.min(...['#000000','#ffffff'].map(bg=>contrastRatio(css.color,compositeColor(mask,bg)))), opacity: css.opacity };
        });
        expect(data.ratio).toBeGreaterThanOrEqual(level === 'high' ? 9 : 4.5); expect(data.opacity).toBe('1');
        const currentRatio = await page.locator('.stm-current-lyric').evaluate(async n => { const { contrastRatio,compositeColor } = await import('/scripts/extensions/third-party/sillytavern/ui/contrast.js'); const c = getComputedStyle(n),mask=getComputedStyle(n.closest('.stm-lyrics-scroll')).backgroundColor; return Math.min(...['#000000','#ffffff'].map(bg=>contrastRatio(c.color,compositeColor(mask,bg)))); });
        expect(currentRatio).toBeGreaterThanOrEqual(level === 'high' ? 7 : 4.5);
        if (background === 'transparent') expect(await page.locator('.stm-lyrics-scroll').evaluate(async n=>{const {colorChannels}=await import('/scripts/extensions/third-party/sillytavern/ui/contrast.js');return colorChannels(getComputedStyle(n).backgroundColor)[3];})).toBeCloseTo(.9,2);
        await page.locator('[data-action=back-cover]').click();
    }
    await page.locator('[data-action=toggle-lyrics]').click();
    const scroll = page.locator('.stm-lyrics-scroll');
    if (info.project.use.hasTouch) {
        const box = await scroll.boundingBox(), session = await page.context().newCDPSession(page), x = box.x + box.width / 2, y = box.y + box.height * .7;
        try {
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
            for (let i = 1; i <= 6; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 20, id: 1 }] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally { await session.detach(); }
        await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'false');
    } else { await scroll.focus(); await page.keyboard.press('ArrowDown'); await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'false'); }
});

test('old maker standalone preview uses the same readable colors and explicit lyric reader', async ({ page }) => {
    await page.route('**/old-reading-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body></body>' }));
    await page.goto('/old-reading-fixture');
    await page.evaluate(async ({ prefix, src }) => {
        const { mountCardPlayer } = await import(prefix + 'card-player/runtime.js');
        const noop = () => () => {};
        const scope = { hostWindow: window, hostDocument: document, roleId: 'preview', scriptId: 'reading-legacy', currentRole: () => 'preview', onRoleChange: noop, onScriptExit: noop, onHostExit: noop, onFrameRemoved: noop };
        window.legacyReadingApi = mountCardPlayer({ id: 'legacy-read', tracks: [{ id: 'a', title: '旧制作器歌词', src, lyrics: Array.from({ length: 40 }, (_, i) => `[${String(Math.floor(i * 2 / 60)).padStart(2, '0')}:${String(i * 2 % 60).padStart(2, '0')}]旧预览歌词 ${i + 1}`).join('\n') }], reading: { level: 'high', lyricSize: 24 }, appearance: { background: '#858585', text: '#858585', accent: '#858585' } }, scope);
    }, { prefix, src: 'data:audio/mpeg;base64,' + tone.toString('base64') });
    await page.locator('.play').click(); await expect.poll(() => page.evaluate(() => legacyReadingApi.audio.currentTime)).toBeGreaterThan(.2);
    await page.locator('.cover').click();
    await expect(page.locator('.lyrics .lyric-lines p').first()).toHaveCSS('font-size', '24px');
    const ratio = await page.locator('.lyrics .lyric-lines p:not(.active)').first().evaluate(async n => { const { contrastRatio,compositeColor } = await import('/scripts/extensions/third-party/sillytavern/ui/contrast.js'); const s = getComputedStyle(n),mask=getComputedStyle(n.closest('.lyric-scroll')).backgroundColor; return Math.min(...['#000000','#ffffff'].map(bg=>contrastRatio(s.color,compositeColor(mask,bg)))); });
    expect(ratio).toBeGreaterThanOrEqual(9);
    await page.locator('.lyric-scroll').focus(); await page.keyboard.press('PageDown');
    await expect(page.locator('.lyrics')).toHaveAttribute('data-follow', 'false');
    await page.locator('[data-action=resume-lyrics]').click(); await expect(page.locator('.lyrics')).toHaveAttribute('data-follow', 'true');
    await page.getByRole('button',{name:'收起角色播放器',exact:true}).click(); await page.locator('.ball').click();
    await expect(page.locator('.lyric-scroll')).toBeFocused(); await expect(page.locator('.lyrics')).toHaveAttribute('data-follow', 'true');
    await page.locator('[data-action=back-cover]').click(); await expect(page.locator('.lyrics')).toBeHidden();
    expect(await page.evaluate(() => !legacyReadingApi.audio.paused)).toBe(true);
    await page.evaluate(() => legacyReadingApi.dispose()); await expect(page.locator('[data-riserein-card-player]')).toHaveCount(0);
});

test('reading preferences persist through real IndexedDB binary ZIP restore including maker drafts', async ({ page }) => {
    await fixture(page);
    const restored = await page.evaluate(async ({ prefix, tone }) => {
        const { LocalMusicStore } = await import(prefix + 'local-store.js'), { CardProjectStore } = await import(prefix + 'card-player/project-store.js'), { MaintenanceJournal } = await import(prefix + 'data/journal.js');
        const { createBackup, inspectBackup } = await import(prefix + 'data/backup.js'), { makeRestorePlan, applyRestore, verifyReferences } = await import(prefix + 'data/restore.js'), { normalizeSettings } = await import(prefix + 'core.js');
        const store = new LocalMusicStore(), projects = new CardProjectStore(), journal = new MaintenanceJournal();
        const reading = { level: 'high', lyricSize: 26, lineHeight: 2.3, autoFollow: false, lyricBackground: 'transparent' };
        const id = 'reading-backup-local'; await store.put(id, new Blob([new Uint8Array(tone)], { type: 'audio/mpeg' }));
        const settings = normalizeSettings({ tracks: [{ id, title: '备份原音频', kind: 'local', lyrics: '[00:00]保留原文' }], reading,lyricOffsets:{[id]:700},visibility:{state:'hidden',resume:{id,time:5}} });
        await projects.save({ id: 'rscp:reading', title: '阅读草稿', tracks: [{ ...settings.tracks[0], exportBlob: await store.get(id) }], sourceSettings: { reading }, form: {'stm-maker-recipient-display':'docked'} });
        const backup = await createBackup({ settings, store, projects: await projects.list() });
        const inspected = await inspectBackup(backup.blob);
        const current = normalizeSettings();
        const plan = await makeRestorePlan({ backup: inspected, current, store, projects: await projects.list(), mode: 'copy', restorePreferences: true });
        let acknowledged;
        await applyRestore({ plan, store, projects, journal, settings: current, commitSettings: async next => { acknowledged = structuredClone(next); return 'confirmed'; } });
        await verifyReferences(acknowledged, store, await projects.list());
        const drafts = await projects.list();
        const result = { offset: acknowledged.lyricOffsets[acknowledged.tracks[0].id], resume:acknowledged.visibility.resume, restoredId:acknowledged.tracks[0].id, reading: acknowledged.reading, draftReading: drafts.find(p => p.id !== 'rscp:reading').sourceSettings.reading, draftDisplay:drafts.find(p=>p.id!=='rscp:reading').form['stm-maker-recipient-display'],oldDraft: Boolean(drafts.find(p => p.id === 'rscp:reading')), bytes: (await store.get(acknowledged.tracks[0].id)).size, lyrics: acknowledged.tracks[0].lyrics };
        await store.close(); await projects.dispose(); await journal.close(); return result;
    }, { prefix, tone: [...tone] });
    expect(restored.draftDisplay).toBe('docked');expect(restored.offset).toBe(700);expect(restored.resume.id).toBe(restored.restoredId);expect(restored.resume.time).toBe(5);
    expect(restored.reading).toEqual({ level: 'high', lyricSize: 26, lineHeight: 2.3, autoFollow: false, lyricBackground: 'transparent', displayMode: 'flow', nextLine: true });
    expect({...restored.draftReading,displayMode:'flow',nextLine:true}).toEqual(restored.reading); expect(restored.oldDraft).toBe(true); expect(restored.bytes).toBe(tone.length); expect(restored.lyrics).toBe('[00:00]保留原文');
});

test('actual host reading controls, designer contrast warnings and layout changes retain one playing Audio', async ({ page }) => {
    await page.route('**/api/settings/get', async route => { const response = await route.fetch(), body = await response.json(), s = JSON.parse(body.settings); s.firstRun = false; s.main_api = 'kobold'; s.api_server = ''; s.extension_settings ||= {}; s.extension_settings.riserein_music_player = { tracks: [{ id: 'host-reading', kind: 'url', title: '真实酒馆阅读', url: new URL(prefix + 'card-player/demo-assets/test-tone-a.mp3', route.request().url()).href, lyrics: '[00:00]实际酒馆歌词\n[00:02]阅读不中断' }], fontPreset: 'sans', colorScheme: 'dark', theme: 'night', transitionDuration: 0 }; body.settings = JSON.stringify(s); await route.fulfill({ response, json: body }); });
    await page.goto('/'); await expect(page.locator('#stm-launcher')).toBeVisible({ timeout: 30000 }); await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.evaluate(async () => (await import('/script.js')).closeCurrentChat());
    await page.locator('#stm-launcher').click(); await page.locator('[data-action=play]').click(); await expect.poll(() => page.locator('#stm-player audio').evaluate(a => a.currentTime)).toBeGreaterThan(.2);
    await page.evaluate(() => { window.hostReadingAudio = document.querySelector('#stm-player audio'); });
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    const persisted = page.waitForResponse(response => {
        if (!response.url().endsWith('/api/settings/save') || !response.ok()) return false;
        const req = response.request(), body = req.headers()['content-encoding'] === 'gzip' ? JSON.parse(gunzipSync(req.postDataBuffer()).toString()) : req.postDataJSON();
        return body?.extension_settings?.riserein_music_player?.reading?.lyricSize === 25 && body.extension_settings.riserein_music_player.reading.autoFollow === false;
    });
    await page.locator('#stm-lyric-size').evaluate(n => { n.value = '25'; n.dispatchEvent(new Event('input')); });
    await page.locator('#stm-lyric-height').evaluate(n => { n.value = '2.2'; n.dispatchEvent(new Event('input')); });
    await page.locator('#stm-lyric-follow').uncheck();
    await persisted;
    await page.locator('[data-action=open-designer]').click();
    const studio = page.locator('.stm-design-editor');
    if (page.viewportSize().width < 850) await studio.locator('[data-step=templates]').click();
    for (const key of ['background', 'text', 'muted', 'accent']) {
        await studio.locator('[data-color=' + key + ']').evaluate(n => { n.value = '#858585'; n.dispatchEvent(new Event('change')); });
    }
    await expect(studio.locator('[data-color-warning]')).toContainText('辅助文字');
    await expect(studio.locator('[data-color-warning]')).toContainText('歌词');
    await expect(studio.locator('[data-color-warning]')).toContainText('低对比度');
    for (const key of ['background', 'text', 'muted', 'accent']) { const label = studio.locator('[data-color=' + key + ']').locator('..'); await label.locator('input[type=checkbox]').check(); }
    await studio.locator('[data-random]').click();
    for (const key of ['background', 'text', 'muted', 'accent']) await expect(studio.locator('[data-color=' + key + ']')).toHaveValue('#858585');
    await studio.locator('[data-editor-close]').click();
    await page.getByRole('tab', { name: '播放', exact: true }).click(); await page.locator('[data-action=toggle-lyrics]').click();
    await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'false');
    await expect(page.locator('.stm-lyrics-lines p').first()).toHaveCSS('font-size', '25px');
    await page.locator('[data-action=resume-lyrics]').click(); await expect(page.locator('.stm-lyrics-view')).toHaveAttribute('data-follow', 'true');
    expect(await page.evaluate(() => hostReadingAudio === document.querySelector('#stm-player audio') && !hostReadingAudio.paused)).toBe(true);
    await page.unroute('**/api/settings/get');
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    await expect(page.locator('#stm-lyric-size')).toHaveValue('25'); await expect(page.locator('#stm-lyric-follow')).not.toBeChecked();
});
