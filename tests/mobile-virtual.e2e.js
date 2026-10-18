import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const prefix = '/scripts/extensions/third-party/sillytavern/';
const tone = await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3', import.meta.url));
const layouts = [['crystal', 'mist-blue'], ['vinyl', 'walnut'], ['cassette', 'smoke'], ['pure', 'cream']];

async function choose(page, id, value) {
    const name = await page.locator(id).evaluate((el, value) => [...el.options].find(o => o.value === value).textContent, value);
    await page.locator(id + '-trigger').tap();
    await page.locator(id + '-menu').getByRole('option', { name, exact: true }).tap();
}

async function touchDrag(page, locator, dx, dy) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const start = { x: box.x + Math.min(20, box.width / 2), y: box.y + box.height / 2 };
    const session = await page.context().newCDPSession(page);
    try {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
        for (let i = 1; i <= 6; i++) {
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + dx * i / 6, y: start.y + dy * i / 6, id: 1 }] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await session.detach(); }
}

async function inViewport(page, locator) {
    await expect.poll(async () => {
        const rect = await locator.boundingBox(), size = page.viewportSize();
        return Boolean(rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= size.width + 1 && rect.y + rect.height <= size.height + 1);
    }).toBe(true);
}

test('real host: touch import/play, four layouts, rotation, lyrics, queue, seeking and floating drag', async ({ page }, info) => {
    // Real SillyTavern UI and IndexedDB; settings writes are intercepted to avoid
    // replacing the test server account's settings. This is not a persistence test.
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch(), body = await response.json(), s = JSON.parse(body.settings);
        s.firstRun = false; s.main_api = 'kobold'; s.api_server = '';
        s.extension_settings ||= {};
        s.extension_settings.riserein_music_player = { tracks: [], theme: 'night', colorScheme: 'dark', fontPreset: 'sans', transitionDuration: 0 };
        body.settings = JSON.stringify(s);
        await route.fulfill({ response, json: body });
    });
    await page.route('**/api/settings/save', route => route.fulfill({ json: { result: 'ok' } }));
    await page.goto('/');
    await expect(page.locator('#stm-launcher')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.evaluate(async () => (await import('/script.js')).closeCurrentChat());
    await page.evaluate(() => {
        window.touchPointers = 0;
        document.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') touchPointers++; });
    });
    await page.locator('#stm-launcher').tap();
    await page.getByRole('tab', { name: '导入', exact: true }).tap();
    await page.locator('[data-role=files]').setInputFiles([0, 1].map(i => ({ name: `触摸测试${i}.mp3`, mimeType: 'audio/mpeg', buffer: tone })));
    await expect(page.locator('.stm-status')).toContainText('已导入 2 首音乐');
    await page.getByRole('tab', { name: '曲库', exact: true }).tap();
    await page.locator('.stm-collection-open[data-collection-id=""]').tap();
    await page.getByRole('button', { name: '歌曲详情：触摸测试0', exact: true }).tap();
    await page.locator('[data-role=lyrics-file]').setInputFiles({ name: 'touch.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]触摸歌词起点\n[00:02]旋转后音乐继续') });
    await page.getByRole('button', { name: '关闭歌曲详情', exact: true }).tap();
    await page.getByRole('tab', { name: '播放', exact: true }).tap();
    await page.locator('[data-action=play]').tap();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(a => a.currentTime)).toBeGreaterThan(.2);
    await page.evaluate(() => { window.mobileAudio = document.querySelector('#stm-player audio'); window.mobileSource = mobileAudio.src; });
    const portrait = page.viewportSize();
    for (const [layout, theme] of layouts) {
        await page.getByRole('tab', { name: '外观', exact: true }).tap();
        await choose(page, '#stm-design-layout', layout);
        await choose(page, '#stm-design-theme', theme);
        await page.getByRole('tab', { name: '播放', exact: true }).tap();
        await expect(page.locator('#stm-player')).toHaveAttribute('data-layout', layout);
        for (const size of [portrait, { width: portrait.height, height: portrait.width }]) {
            const before = await page.locator('#stm-player audio').evaluate(a => a.currentTime);
            await page.setViewportSize(size);
            await inViewport(page, page.locator('#stm-player'));
            expect(await page.evaluate(() => mobileAudio === document.querySelector('#stm-player audio') && mobileAudio.src === mobileSource && !mobileAudio.paused)).toBe(true);
            await expect.poll(() => page.locator('#stm-player audio').evaluate(a => a.currentTime)).toBeGreaterThan(before);
            await page.locator('[data-action=toggle-lyrics]').tap();
            await expect(page.locator('.stm-lyrics-view')).toContainText('旋转后音乐继续');
            await page.getByRole('button', { name: '显示封面', exact: true }).tap();
            await page.locator('[data-action=toggle-queue]').tap();
            await expect(page.locator('.stm-queue-track')).toHaveCount(2);
            await page.getByRole('button', { name: '关闭播放列表', exact: true }).tap();
        }
        await page.setViewportSize(portrait);
    }
    await page.locator('[data-action=play]').tap();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(a => a.paused)).toBe(true);
    const seek = page.locator('#stm-seek');
    await seek.scrollIntoViewIfNeeded();
    const seekBox = await seek.boundingBox();
    await page.touchscreen.tap(seekBox.x + seekBox.width * .6, seekBox.y + seekBox.height / 2);
    await expect.poll(() => page.locator('#stm-player audio').evaluate(a => a.currentTime / a.duration)).toBeGreaterThan(.35);
    await page.locator('[data-action=play]').tap();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(a => !a.paused)).toBe(true);
    await page.locator('[data-action=close]').tap();
    const launcher = page.locator('#stm-launcher'), before = await launcher.boundingBox();
    await touchDrag(page, launcher, 0, -100);
    await expect(page.locator('#stm-player')).toBeHidden();
    await expect.poll(async () => (await launcher.boundingBox()).y).toBeLessThan(before.y - 20);
    await inViewport(page, launcher);
    expect(await page.evaluate(() => mobileAudio === document.querySelector('#stm-player audio') && !mobileAudio.paused && touchPointers > 15)).toBe(true);
    await launcher.tap();
    await expect(page.locator('#stm-player')).toBeVisible();
    await page.locator('[data-action=play]').tap();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(a => a.paused)).toBe(true);
    await mkdir('docs/v2/ui/mobile-virtual', { recursive: true });
    await page.screenshot({ path: `docs/v2/ui/mobile-virtual/${info.project.name}.png` });
});

test('standalone carried runtime: touch playback and duplicate/role exit cleanup with simulated lifecycle', async ({ page }) => {
    await page.route('**/mobile-carried-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body></body>' }));
    await page.goto('/mobile-carried-fixture');
    await page.addScriptTag({ content: (await readFile(new URL('../card-player/dist/native-runtime.js', import.meta.url))).toString() });
    await page.evaluate(src => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
        canvas.getContext('2d').fillRect(0, 0, 32, 32);
        const cover = canvas.toDataURL(), noop = () => () => {};
        window.mobileRole = 'role-A';
        window.exitMobileRole = null;
        window.portablePayload = { version: 1, config: { id: 'mobile-portable', tracks: [{ id: 'tone', title: '随卡触摸测试音', src, cover }], transitionDuration: 0 }, ui: { fontPreset: 'inherit', uiDesign: { uiVersion: 1, layout: 'crystal' } }, playlist: { id: 'mobile-list', name: '测试歌单' }, assets: Object.fromEntries(['forest', 'moon', 'sunroom'].map(k => ['assets/covers/' + k + '.png', cover])) };
        window.mobileScope = { hostWindow: window, hostDocument: document, roleId: mobileRole, scriptId: 'mobile-script', currentRole: () => mobileRole, onRoleChange: fn => { exitMobileRole = fn; return () => { exitMobileRole = null; }; }, onScriptExit: noop, onHostExit: noop, onFrameRemoved: noop };
        window.carriedApi = RisereinNativePlayer.mountNativePlayer(portablePayload, mobileScope);
        window.carriedAudio = carriedApi.audio;
    }, 'data:audio/mpeg;base64,' + tone.toString('base64'));
    await expect(page.getByRole('tab', { name: '导入', exact: true })).toHaveCount(0);
    await page.locator('[data-action=play]').tap();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(a => a.currentTime)).toBeGreaterThan(.2);
    expect(await page.evaluate(() => RisereinNativePlayer.mountNativePlayer(portablePayload, mobileScope) === carriedApi)).toBe(true);
    await expect(page.locator('#stm-player audio')).toHaveCount(1);
    await page.evaluate(() => exitMobileRole());
    expect(await page.evaluate(() => !carriedAudio.paused)).toBe(true);
    await page.evaluate(() => { mobileRole = 'role-B'; exitMobileRole(); });
    await expect(page.locator('[data-riserein-card-player]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => carriedAudio.paused && !carriedAudio.getAttribute('src') && Object.values(carriedApi.resourceCounts).every(n => n === 0))).toBe(true);
});
