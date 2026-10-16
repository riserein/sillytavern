import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

function wav(seconds = 8) {
    const rate = 8000;
    const samples = rate * seconds;
    const buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write('WAVE', 8); buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
    buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
    for (let n = 0; n < samples; n++) buffer.writeInt16LE(Math.round(Math.sin(n * 2 * Math.PI * 440 / rate) * 1200), 44 + n * 2);
    return buffer;
}

async function playerPage(page, name) {
    if (await page.locator('.stm-lyrics-view').isVisible()) await page.getByRole('button', { name: '显示封面', exact: true }).click();
    if (await page.locator('#stm-queue').isVisible()) await page.getByRole('button', { name: '关闭播放列表', exact: true }).click();
    if (await page.locator('#stm-details').isVisible()) await page.getByRole('button', { name: '关闭歌曲详情', exact: true }).click();
    await page.getByRole('tab', { name, exact: true }).click();
    if (name === '曲库') {
        const id = await page.locator('#stm-library-playlist').inputValue();
        await page.locator(`.stm-collection-open[data-collection-id="${id}"]`).click();
    }
}

async function selectFont(page, id) {
    await playerPage(page, '外观');
    if (await page.locator('#stm-font-gallery').isHidden()) await page.locator('#stm-font').click();
    await page.locator(`[role="radio"][data-font-choice="${id}"]`).click();
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', id, { timeout: 30000 });
}

async function chooseSelect(page, selector, value) {
    const name = await page.locator(selector).evaluate((select, selected) => [...select.options].find(option => option.value === selected)?.textContent, value);
    await page.locator(`${selector}-trigger`).click();
    await page.locator(`${selector}-menu`).getByRole('option', { name, exact: true }).click();
    await expect(page.locator(selector)).toHaveValue(value);
}

async function chooseMode(page, value) {
    for (let n = 0; n < 4 && await page.locator('#stm-mode').getAttribute('data-mode') !== value; n++) await page.locator('#stm-mode').click();
    await expect(page.locator('#stm-mode')).toHaveAttribute('data-mode', value);
}

async function playSong(page, name) {
    await playerPage(page, '播放');
    if (await page.locator('#stm-queue').isHidden()) await page.locator('[data-action="toggle-queue"]').click();
    await page.getByRole('button', { name: `播放队列歌曲：${name}`, exact: true }).click();
    await page.getByRole('button', { name: '关闭播放列表', exact: true }).click();
}

async function selectAlbum(page, id) {
    // These legacy scenarios intentionally change the playing source as well as opening its editor.
    await playerPage(page, '播放');
    await chooseSelect(page, '#stm-playlist', id);
    await page.getByRole('tab', { name: '曲库', exact: true }).click();
    await page.locator(`.stm-collection-open[data-collection-id="${id}"]`).click();
    await expect(page.locator('#stm-library-playlist')).toHaveValue(id);
    if (id) await page.locator('[data-action="toggle-manager"]').click();
}

async function songAction(page, name) {
    const title = name.slice(name.indexOf('：') + 1);
    if (await page.locator('#stm-details').isHidden()) await page.getByRole('button', {name:`歌曲详情：${title}`,exact:true}).click();
    await page.getByRole('button', {name,exact:true}).click();
}

async function importSongs(page, names = ['雨夜', '旅途']) {
    await playerPage(page, '导入');
    await playerPage(page, '导入');
    await page.locator('[data-role="files"]').setInputFiles(names.map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wav() })));
    await expect(page.locator('.stm-track')).toHaveCount(names.length);
    await expect(page.locator('.stm-status')).toContainText(`已导入 ${names.length} 首音乐`);
}

async function imageFixture(page) {
    const data = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 600;
        const painter = canvas.getContext('2d');
        painter.fillStyle = '#ed3a48'; painter.fillRect(0, 0, 450, 600);
        painter.fillStyle = '#2572e6'; painter.fillRect(450, 0, 450, 600);
        return canvas.toDataURL('image/png').split(',')[1];
    });
    return { name: '双色背景.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}

function taggedMp3(cover) {
    const sync = size => Buffer.from([size >> 21 & 127, size >> 14 & 127, size >> 7 & 127, size & 127]);
    const frame = (id, data) => { const header = Buffer.alloc(10); header.write(id); header.writeUInt32BE(data.length, 4); return Buffer.concat([header, data]); };
    const text = value => Buffer.concat([Buffer.from([3]), Buffer.from(value)]);
    const tags = Buffer.concat([
        frame('TIT2', text('标签里的歌名')), frame('TPE1', text('内嵌歌手')),
        frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3, 0]), cover])),
        frame('USLT', Buffer.concat([Buffer.from([3]), Buffer.from('zho\0[00:00.00]第一句\n[00:02.00]第二句\n[00:04.00]第三句')])),
    ]);
    let audio = readFileSync(new URL('./fixtures/tone.mp3', import.meta.url));
    if (audio.subarray(0, 3).toString() === 'ID3') audio = audio.subarray(10 + audio.subarray(6, 10).reduce((size, byte) => size * 128 + (byte & 127), 0));
    return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), sync(tags.length), tags, audio]);
}

async function importBackground(page) {
    await playerPage(page, '外观');
    await page.locator('[data-role="background-file"]').setInputFiles(await imageFixture(page));
    await expect(page.getByRole('dialog', { name: '裁剪背景图片', exact: true })).toBeVisible();
}

function waitForPlayerSave(page, predicate) {
    return page.waitForResponse(response => {
        if (!response.url().endsWith('/api/settings/save') || !response.ok()) return false;
        try {
            const player = response.request().postDataJSON()?.extension_settings?.riserein_music_player;
            return Boolean(player && predicate(player));
        } catch { return false; }
    });
}

test.beforeEach(async ({ page }) => {
    // Only reset the extension in a disposable ST profile; all other APIs and the loader are real.
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch();
        const body = await response.json();
        const settings = JSON.parse(body.settings);
        settings.firstRun = false;
        settings.extension_settings ||= {};
        settings.extension_settings.riserein_music_player = { tracks: [], volume: 0.6, mode: 'list', currentId: null };
        body.settings = JSON.stringify(settings);
        await route.fulfill({ response, json: body });
    });
    await page.goto('/');
    await expect(page.locator('#stm-launcher')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.evaluate(async () => { const { closeCurrentChat } = await import('/script.js'); await closeCurrentChat(); });
    await page.unroute('**/api/settings/get');
    await page.locator('#stm-launcher').click();
    await expect(page.getByRole('dialog', { name: '音乐播放器', exact: true })).toBeVisible();
});

test('SillyTavern loads the extension and the empty player is usable', async ({ page }) => {
    await expect(page.locator('[data-action="play"]')).toBeDisabled();
    await expect(page.locator('.stm-queue-empty')).toBeVisible();
    await expect(page.locator('.stm-settings-entry')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
    await expect(page.locator('#stm-player')).toBeHidden();
    await page.locator('#stm-launcher').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#stm-player')).toBeHidden();
    await expect(page.locator('#stm-launcher')).toBeFocused();
});

test('local imports play actual audio, seek, adjust volume, and keep playing with panel closed', async ({ page }) => {
    await importSongs(page);
    await playSong(page, '雨夜');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await expect(page.locator('[data-action="play"]')).toHaveAttribute('aria-label', '暂停');
    await playerPage(page, '播放');
    await page.locator('#stm-seek').fill('3');
    await page.locator('#stm-seek').dispatchEvent('input');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThanOrEqual(3);
    await playerPage(page, '播放');
    await page.locator('#stm-volume').fill('25');
    await page.locator('#stm-volume').dispatchEvent('input');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.volume)).toBe(0.25);
    await playerPage(page, '播放');
    await page.getByRole('button', { name: '静音', exact: true }).click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.muted)).toBe(true);
    await playerPage(page, '播放');
    await page.getByRole('button', { name: '取消静音', exact: true }).click();
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    await page.locator('#stm-launcher').click();
    await playerPage(page, '播放');
    await page.locator('[data-action="play"]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
});

test('manual switching and all four completion modes behave correctly', async ({ page }) => {
    await importSongs(page);
    await playerPage(page, '播放');
    await page.getByRole('button', { name: '下一首', exact: true }).click();
    await expect(page.locator('[data-role="title"]')).toHaveText('旅途');
    await playerPage(page, '播放');
    await page.getByRole('button', { name: '上一首', exact: true }).click();
    await expect(page.locator('[data-role="title"]')).toHaveText('雨夜');
    await playerPage(page, '播放');
    await chooseMode(page, 'single');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('雨夜');
    await playerPage(page, '播放');
    await chooseMode(page, 'shuffle');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('旅途');
    await playerPage(page, '播放');
    await chooseMode(page, 'list');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('雨夜');
    await playSong(page, '旅途');
    await playerPage(page, '播放');
    await chooseMode(page, 'sequence');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2);
    // Move to the real end, rather than merely checking that a method was called.
    await page.locator('#stm-player audio').evaluate(audio => { audio.currentTime = audio.duration - 0.05; });
    await expect(page.locator('.stm-status')).toHaveText('播放列表已播放完毕。');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
});

test('settings and IndexedDB music survive a real page reload without autoplay', async ({ page }) => {
    await importSongs(page, ['记住这首歌']);
    await playerPage(page, '播放');
    await chooseMode(page, 'single');
    const saved = waitForPlayerSave(page, player => player.volume === 0.35);
    await playerPage(page, '播放');
    await page.locator('#stm-volume').fill('35');
    await page.locator('#stm-volume').dispatchEvent('input');
    await saved;
    await page.reload();
    await expect(page.locator('#stm-launcher')).toBeVisible();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await expect(page.locator('.stm-track')).toHaveCount(1);
    await expect(page.locator('#stm-mode')).toHaveAttribute('data-mode', 'single');
    await expect(page.locator('#stm-volume')).toHaveValue('35');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
    await playerPage(page, '播放');
    await page.locator('[data-action="play"]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
});

test('audio URLs play and duplicate entries are rejected', async ({ page }) => {
    await page.route('https://music.example.test/theme.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav() }));
    await playerPage(page, '导入');
    await page.locator('#stm-url').fill('https://music.example.test/theme.wav');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await playSong(page, 'theme');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await playerPage(page, '导入');
    await page.locator('#stm-url').fill('https://music.example.test/theme.wav');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.locator('.stm-status')).toContainText('已经在总曲库');
    await expect(page.locator('.stm-track')).toHaveCount(1);
});

test('invalid files, broken links and browser playback restrictions explain recovery', async ({ page }) => {
    await playerPage(page, '导入');
    await page.locator('[data-role="files"]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
    await expect(page.locator('.stm-status')).toContainText('请选择音频文件');
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await page.route('https://music.example.test/missing.mp3', route => route.fulfill({ status: 404, body: 'missing' }));
    await playerPage(page, '导入');
    await page.locator('#stm-url').fill('https://music.example.test/missing.mp3');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.locator('.stm-status')).toContainText('音乐加载失败');
    page.once('dialog', dialog => dialog.accept());
    await playerPage(page, '曲库');
    await songAction(page, '删除：missing');
    await importSongs(page, ['需要点击播放']);
    await page.locator('#stm-player audio').evaluate(audio => { audio.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError')); });
    await playerPage(page, '播放');
    await page.locator('[data-action="play"]').click();
    await expect(page.locator('.stm-status')).toContainText('浏览器阻止了自动播放');
});

test('deleting a selected local track clears playback and its stored audio', async ({ page }) => {
    await importSongs(page, ['要删除的音乐']);
    const id = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.currentId);
    await playerPage(page, '播放');
    await page.locator('[data-action="play"]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    page.once('dialog', dialog => dialog.accept());
    await playerPage(page, '曲库');
    await songAction(page, '删除：要删除的音乐');
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await expect(page.locator('[data-action="play"]')).toBeDisabled();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
    const hasBlob = await page.evaluate(async id => {
        const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js');
        return Boolean(await new LocalMusicStore().get(id));
    }, id);
    expect(hasBlob).toBe(false);
});

test('filenames are rendered as text, and the player fits a small screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await importSongs(page, ['<img src=x onerror=alert(1)>']);
    await expect(page.locator('.stm-track-title')).toHaveText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#stm-player img[src="x"]')).toHaveCount(0);
    await expect(page.locator('.stm-cover-image')).toHaveCount(1);
    const bounds = await page.locator('#stm-player').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    await page.locator('#stm-player').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
    await expect(page.locator('.stm-mini-player')).toBeInViewport();
});

async function dragTo(page, element, target) {
    const bounds = await element.boundingBox();
    if (!bounds) throw new Error('Missing drag handle');
    await page.mouse.move(bounds.x + 12, bounds.y + 12);
    await page.mouse.down();
    await page.mouse.move(target.x + 12, target.y + 12, { steps: 8 });
    await page.mouse.up();
}

test('the launcher and window drag independently, preserve their positions and do not toggle on drag', async ({ page }) => {
    await expect(page.locator('#stm-player h2')).toHaveCount(0);
    await expect(page.locator('#stm-player')).not.toContainText('酒馆音乐播放器');
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
    await dragTo(page, page.locator('#stm-launcher'), { x: 180, y: 160 });
    let launcher = await page.locator('#stm-launcher').boundingBox();
    expect(launcher.x).toBeCloseTo(180, 0);
    expect(launcher.y).toBeCloseTo(160, 0);
    await expect(page.locator('#stm-player')).toBeHidden();
    await page.locator('#stm-launcher').click();
    const header = await page.locator('.stm-header').boundingBox();
    const original = await page.locator('#stm-player').boundingBox();
    const viewport = page.viewportSize();
    const saved = waitForPlayerSave(page, player => player.positions?.panel
        && Math.abs(player.positions.panel.x * viewport.width - 350) < 0.5
        && Math.abs(player.positions.panel.y * viewport.height - 40) < 0.5);
    await dragTo(page, page.locator('.stm-header'), { x: 350 + header.x - original.x, y: 40 + header.y - original.y });
    await saved;
    const panel = await page.locator('#stm-player').boundingBox();
    expect(panel.x).toBeCloseTo(350, 0);
    expect(panel.y).toBeCloseTo(40, 0);
    launcher = await page.locator('#stm-launcher').boundingBox();
    expect(launcher.x).toBeCloseTo(180, 0);
    await page.reload();
    await expect(page.locator('#stm-launcher')).toBeVisible();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    launcher = await page.locator('#stm-launcher').boundingBox();
    expect(launcher.x).toBeCloseTo(180, 0);
    expect(launcher.y).toBeCloseTo(160, 0);
    await page.locator('#stm-launcher').click();
    const restored = await page.locator('#stm-player').boundingBox();
    expect(restored.x).toBeCloseTo(350, 0);
    expect(restored.y).toBeCloseTo(40, 0);
});

test('dragging is bounded, a smaller viewport remains usable, and positions can be reset', async ({ page }) => {
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
    await dragTo(page, page.locator('#stm-launcher'), { x: -50, y: -50 });
    let launcher = await page.locator('#stm-launcher').boundingBox();
    expect(launcher.x).toBeCloseTo(8, 0);
    expect(launcher.y).toBeCloseTo(8, 0);
    await dragTo(page, page.locator('#stm-launcher'), { x: 1150, y: 620 });
    await page.locator('#stm-launcher').click();
    await dragTo(page, page.locator('.stm-header'), { x: 1050, y: 600 });
    await page.setViewportSize({ width: 375, height: 667 });
    await expect.poll(async () => {
        const panel = await page.locator('#stm-player').boundingBox();
        const ball = await page.locator('#stm-launcher').boundingBox();
        return [panel, ball].every(box => box.x >= 7 && box.y >= 7 && box.x + box.width <= 368 && box.y + box.height <= 660);
    }).toBe(true);
    await page.locator('[data-action="appearance"]').click();
    await page.getByRole('button', { name: '重置窗口大小与位置', exact: true }).click();
    launcher = await page.locator('#stm-launcher').boundingBox();
    expect(launcher.x).toBeCloseTo(317, 0);
    expect(launcher.y).toBeCloseTo(535, 0);
    await expect.poll(() => page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.positions)).toEqual({ launcher: null, panel: null });
});

test('all six palettes and both materials apply to both controls without interrupting music, and persist', async ({ page }) => {
    await importSongs(page, ['配色时继续播放']);
    await playSong(page, '配色时继续播放');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await page.locator('[data-action="appearance"]').click();
    const colors = new Set();
    for (const theme of ['amber', 'ocean', 'forest', 'rose', 'lavender', 'pearl']) {
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        await expect(page.locator('#stm-player')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('#stm-launcher')).toHaveAttribute('data-theme', theme);
        await expect(page.locator(`[data-theme-choice="${theme}"]`)).toHaveAttribute('aria-pressed', 'true');
        colors.add(await page.locator('#stm-player').evaluate(panel => getComputedStyle(panel).color));
    }
    expect(colors.size).toBe(6);
    const glass = await page.locator('#stm-player').evaluate(panel => getComputedStyle(panel).backdropFilter);
    await page.getByRole('button', { name: '雾面', exact: true }).click();
    await expect(page.locator('#stm-launcher')).toHaveAttribute('data-surface', 'matte');
    const matte = await page.locator('#stm-player').evaluate(panel => getComputedStyle(panel).backdropFilter);
    expect(glass).not.toBe(matte);
    expect(glass).toContain('blur(24px)');
    expect(matte).toContain('blur(12px)');
    const saved = waitForPlayerSave(page, player => player.theme === 'lavender' && player.surface === 'matte');
    await page.getByRole('button', { name: '配色：月紫', exact: true }).click();
    await saved;
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    await page.reload();
    await expect(page.locator('#stm-launcher')).toHaveAttribute('data-theme', 'lavender');
    await expect(page.locator('#stm-launcher')).toHaveAttribute('data-surface', 'matte');
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await expect(page.locator('#stm-player')).toHaveAttribute('data-theme', 'lavender');
    await expect(page.locator('#stm-player')).toHaveAttribute('data-surface', 'matte');
});

test.describe('touch dragging', () => {
    test.use({ hasTouch: true });
    test('touch moves the ball and header, and a cancelled gesture does not break the next click', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
        const client = await page.context().newCDPSession(page);
        const original = await page.locator('#stm-launcher').boundingBox();
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: original.x + 23, y: original.y + 23, id: 1 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 230, id: 1 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const ball = await page.locator('#stm-launcher').boundingBox();
        expect(ball.x).toBeCloseTo(177, 0);
        expect(ball.y).toBeCloseTo(207, 0);
        await expect(page.locator('#stm-player')).toBeHidden();
        await page.locator('#stm-launcher').click();
        const before = await page.locator('#stm-player').boundingBox();
        const header = await page.locator('.stm-header').boundingBox();
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: header.x + 15, y: header.y + 15, id: 2 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: header.x + 15, y: header.y + 65, id: 2 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        const after = await page.locator('#stm-player').boundingBox();
        expect(after.y).toBeGreaterThan(before.y);
        await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
        await expect(page.locator('#stm-player')).toBeHidden();
        await page.locator('#stm-launcher').click();
        await expect(page.locator('#stm-player')).toBeVisible();
        await client.detach();
    });
    test('touch drags the background crop and saves the selected area', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await importBackground(page);
        const box = await page.locator('.stm-crop-editor canvas').boundingBox();
        const client = await page.context().newCDPSession(page);
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 35, y, id: 7 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        expect(Number(await page.getByRole('slider', { name: '裁剪左右位置', exact: true }).inputValue())).toBeGreaterThan(50);
        await page.getByRole('button', { name: '使用此区域', exact: true }).click();
        await expect(page.locator('.stm-crop-editor')).toBeHidden();
        await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background', 'true');
        await client.detach();
    });
});

async function createAlbum(page, name) {
    await playerPage(page, '曲库');
    await page.getByRole('tab', {name:'曲库',exact:true}).click();
    await page.locator('[data-action="new-playlist"]').click();
    await page.locator('#stm-new-playlist').fill(name);
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await expect(page.locator('[data-role="collection-title"]')).toHaveText(name);
    return page.locator('#stm-library-playlist').inputValue();
}

async function addExisting(page, song, playlistId) {
    await selectAlbum(page, '');
    await songAction(page, `加入歌单：${song}`);
    await chooseSelect(page, '#stm-add-target', playlistId);
    await page.getByRole('button', { name: '加入歌单', exact: true }).click();
}

async function createTestCard(page, suffix) {
    const name = `STM_Test_${suffix}_${crypto.randomUUID().slice(0, 8)}`;
    const result = await page.evaluate(async name => {
        const response = await fetch('/api/characters/create', {
            method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(),
            body: JSON.stringify({ ch_name: name, description: 'Music extension integration test fixture', first_mes: 'Hello.' }),
        });
        return { status: response.status, avatar: await response.text() };
    }, name);
    expect(result.status).toBe(200);
    expect(result.avatar).toMatch(/^STM_Test_.*\.png$/);
    await page.evaluate(async () => { const { getCharacters } = await import('/script.js'); await getCharacters(); });
    return { name, avatar: result.avatar };
}

async function selectCard(page, card) {
    await page.evaluate(async avatar => {
        const { selectCharacterById } = await import('/script.js');
        const index = SillyTavern.getContext().characters.findIndex(character => character.avatar === avatar);
        if (index < 0) throw new Error('Test card missing');
        await selectCharacterById(index);
    }, card.avatar);
}

async function bindCards(page, cards) {
    await playerPage(page, '曲库');
    if (await page.locator('#stm-playlist-manager').isHidden()) await page.locator('[data-action="toggle-manager"]').click();
    if (await page.locator('#stm-role-bindings').isHidden()) await page.getByRole('button', { name: '绑定角色', exact: true }).click();
    for (const card of cards) await page.getByRole('checkbox', { name: `${card.name}（${card.avatar}）`, exact: true }).check();
    await page.getByRole('button', { name: '保存绑定', exact: true }).click();
    await expect(page.locator('.stm-status')).toContainText('角色绑定已保存');
}

async function removeTestCards(page, cards) {
    await page.evaluate(async avatars => {
        const { closeCurrentChat, getCharacters } = await import('/script.js');
        await closeCurrentChat();
        for (const avatar of avatars) {
            if (!avatar.startsWith('STM_Test_')) throw new Error('Refusing to delete a non-fixture card');
            const response = await fetch('/api/characters/delete', {
                method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(),
                body: JSON.stringify({ avatar_url: avatar, delete_chats: true }),
            });
            if (!response.ok) throw new Error(`Fixture cleanup failed: ${response.status}`);
        }
        await getCharacters();
    }, cards.map(card => card.avatar));
}

test('import destinations, album rename and deletion preserve music and survive reload', async ({ page }) => {
    const albumId = await createAlbum(page, '雨夜歌单');
    await playerPage(page, '导入');
    await chooseSelect(page, '#stm-import-playlist', albumId);
    await importSongs(page, ['雨声', '炉火']);
    await expect(page.locator('#stm-playlist')).toHaveValue(albumId);
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.tracks.length)).toBe(2);
    await playerPage(page, '导入');
    await chooseSelect(page, '#stm-import-playlist', '');
    await playerPage(page, '导入');
    await page.locator('[data-role="files"]').setInputFiles({ name: '独立音乐.wav', mimeType: 'audio/wav', buffer: wav() });
    await expect(page.locator('#stm-playlist')).toHaveValue('');
    await expect(page.locator('.stm-track')).toHaveCount(3);
    await selectAlbum(page, albumId);
    await expect(page.locator('.stm-track')).toHaveCount(2);
    const saved = waitForPlayerSave(page, player => player.playlists?.some(playlist => playlist.id === albumId && playlist.name === '新的雨夜'));
    await page.locator('#stm-playlist-name').fill('新的雨夜');
    await page.getByRole('button', { name: '保存名称', exact: true }).click();
    await saved;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await expect(page.locator('[data-role="collection-title"]')).toHaveText('新的雨夜');
    await expect(page.locator('.stm-track')).toHaveCount(2);
    const id = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playlists[0].trackIds[0]);
    await page.getByRole('button', { name: '歌单管理', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '删除歌单', exact: true }).click();
    await expect(page.locator('.stm-track')).toHaveCount(3);
    expect(await page.evaluate(async id => {
        const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js');
        return Boolean(await new LocalMusicStore().get(id));
    }, id)).toBe(true);
    await playSong(page, '雨声');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
});

test('shared songs, album-only removal and confirmed global deletion have distinct effects', async ({ page }) => {
    await importSongs(page, ['共有曲', '其他曲']);
    const first = await createAlbum(page, '第一张');
    const second = await createAlbum(page, '第二张');
    await addExisting(page, '共有曲', first);
    await addExisting(page, '共有曲', second);
    await expect(page.locator('.stm-track')).toHaveCount(2);
    await selectAlbum(page, first);
    await expect(page.locator('.stm-track')).toHaveCount(1);
    await playSong(page, '共有曲');
    await playerPage(page, '播放');
    await page.getByRole('button', { name: '下一首', exact: true }).click();
    await expect(page.locator('[data-role="title"]')).toHaveText('共有曲');
    await playerPage(page, '曲库');
    await songAction(page, '从歌单移除：共有曲');
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await selectAlbum(page, second);
    await expect(page.locator('.stm-track')).toHaveCount(1);
    page.once('dialog', dialog => dialog.dismiss());
    await playerPage(page, '曲库');
    await songAction(page, '删除：共有曲');
    await expect(page.locator('.stm-track')).toHaveCount(1);
    page.once('dialog', dialog => dialog.accept());
    await playerPage(page, '曲库');
    await songAction(page, '删除：共有曲');
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await selectAlbum(page, '');
    await expect(page.locator('.stm-track')).toHaveCount(1);
    await expect(page.locator('.stm-track-title')).toHaveText('其他曲');
});

test('one album binds multiple real cards, card changes never autoplay, and going home pauses music', async ({ page }) => {
    const cards = [];
    try {
        cards.push(await createTestCard(page, 'A'));
        cards.push(await createTestCard(page, 'B'));
        cards.push(await createTestCard(page, 'C'));
        const first = await createAlbum(page, '两位角色的歌单');
        await playerPage(page, '导入');
        await chooseSelect(page, '#stm-import-playlist', first);
        await importSongs(page, ['共同背景']);
        await bindCards(page, cards.slice(0, 2));
        const second = await createAlbum(page, '另一位角色的歌单');
        await playerPage(page, '导入');
        await chooseSelect(page, '#stm-import-playlist', second);
        await importSongs(page, ['另一个背景']);
        await bindCards(page, cards.slice(2));
        const saved = waitForPlayerSave(page, player => player.volume === 0.45 && player.playlists?.some(playlist => playlist.characterAvatars.length === 2));
        await playerPage(page, '播放');
        await page.locator('#stm-volume').fill('45');
        await page.locator('#stm-volume').dispatchEvent('input');
        await saved;
        await page.reload();
        await page.waitForFunction(() => !document.getElementById('preloader'));
        await selectCard(page, cards[0]);
        await expect(page.locator('#stm-player')).toBeVisible();
        await expect(page.locator('#stm-playlist')).toHaveValue(first);
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
        await playerPage(page, '播放');
        await page.locator('[data-action="play"]').click();
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
        await page.evaluate(async () => { const ctx = SillyTavern.getContext(); await ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, ctx.chatId); });
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
        await selectCard(page, cards[1]);
        await expect(page.locator('#stm-playlist')).toHaveValue(first);
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
        await selectCard(page, cards[2]);
        await expect(page.locator('#stm-playlist')).toHaveValue(second);
        await expect(page.locator('.stm-track-title')).toHaveText('另一个背景');
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
        await playerPage(page, '播放');
        await page.locator('[data-action="play"]').click();
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
        await page.evaluate(async () => { const { closeCurrentChat } = await import('/script.js'); await closeCurrentChat(); });
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
        await expect(page.locator('.stm-status')).toContainText('已暂停');
        await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
    } finally { await removeTestCards(page, cards); }
});

test('going home cancels pending local audio loads without reopening a stale role playlist', async ({ page }) => {
    const cards = [];
    try {
        cards.push(await createTestCard(page, 'Pending'));
        const album = await createAlbum(page, '慢速读取歌单');
        await playerPage(page, '导入');
        await chooseSelect(page, '#stm-import-playlist', album);
        await importSongs(page, ['等待加载的音乐']);
        await bindCards(page, cards);
        await selectAlbum(page, '');
        await page.evaluate(async avatar => {
            const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js');
            const { selectCharacterById } = await import('/script.js');
            window.__stmOriginalGet = LocalMusicStore.prototype.get;
            LocalMusicStore.prototype.get = async function(id) {
                const blob = await window.__stmOriginalGet.call(this, id);
                window.__stmPendingRead = true;
                await new Promise(resolve => { window.__stmReleaseRead = resolve; });
                return blob;
            };
            // Clear the already-loaded source so switching into the bound album reads storage.
            document.querySelector('#stm-player audio').removeAttribute('src');
            const index = SillyTavern.getContext().characters.findIndex(character => character.avatar === avatar);
            window.__stmCardSwitch = selectCharacterById(index);
        }, cards[0].avatar);
        await page.waitForFunction(() => window.__stmPendingRead);
        await page.evaluate(async () => { const { closeCurrentChat } = await import('/script.js'); await closeCurrentChat(); });
        await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
        await page.evaluate(async () => { window.__stmReleaseRead(); await window.__stmCardSwitch; });
        await expect(page.locator('#stm-player')).toBeHidden();
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
        expect(await page.evaluate(() => SillyTavern.getContext().characterId)).toBeUndefined();
    } finally {
        await page.evaluate(async () => {
            const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js');
            if (window.__stmOriginalGet) LocalMusicStore.prototype.get = window.__stmOriginalGet;
            window.__stmReleaseRead?.();
        });
        await removeTestCards(page, cards);
    }
});

test('separate pages keep management away from playback and preserve audio across tabs', async ({ page }) => {
    await expect(page.locator('#stm-page-playback')).toBeVisible();
    await expect(page.locator('#stm-new-playlist')).toBeHidden();
    await expect(page.locator('#stm-url')).toBeHidden();
    await importSongs(page, ['分页背景音乐']);
    await expect(page.locator('#stm-page-playback')).toBeHidden();
    await expect(page.locator('#stm-url')).toBeVisible();
    await playSong(page, '分页背景音乐');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    for (const name of ['最近播放', '播放排行', '外观', '导入', '曲库', '播放']) {
        await playerPage(page, name);
        await expect(page.locator('.stm-page:visible')).toHaveCount(1);
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    }
    await page.getByRole('tab', { name: '播放', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '曲库', exact: true })).toBeFocused();
    await expect(page.locator('#stm-page-library')).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.locator('#stm-appearance')).toBeVisible();
});

test('recent and ranking pages record successful starts once, support replay, persist and clean up deletions', async ({ page }) => {
    await playerPage(page, '导入');
    await page.locator('[data-role="files"]').setInputFiles(['甲曲', '乙曲'].map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wav(90) })));
    await expect(page.locator('.stm-track')).toHaveCount(2);
    const history = () => page.evaluate(() => {
        const settings = SillyTavern.getContext().extensionSettings.riserein_music_player;
        return settings.playEvents.length;
    });
    expect(await history()).toBe(0);
    await playSong(page, '甲曲');
    await expect.poll(history).toBe(1);
    await page.locator('[data-action="play"]').click();
    await page.locator('[data-action="play"]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    expect(await history()).toBe(1);
    await playSong(page, '乙曲');
    await expect.poll(history).toBe(2);
    await playSong(page, '甲曲');
    await expect.poll(history).toBe(3);
    await playerPage(page, '最近播放');
    await expect(page.locator('.stm-recent-list .stm-song-title')).toHaveText(['甲曲', '乙曲']);
    await playerPage(page, '播放排行');
    await expect(page.locator('.stm-ranking-list .stm-song-title')).toHaveText(['甲曲', '乙曲']);
    await expect(page.locator('.stm-ranking-list small')).toHaveText(['2 次播放', '1 次播放']);
    const saved = waitForPlayerSave(page, settings => settings.playEvents?.length === 4);
    await page.getByRole('button', { name: '播放排行歌曲：乙曲', exact: true }).click();
    await expect.poll(history).toBe(4);
    await saved;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
    await playerPage(page, '最近播放');
    await expect(page.locator('.stm-recent-list .stm-song-title')).toHaveText(['乙曲', '甲曲']);
    await playerPage(page, '曲库');
    page.once('dialog', dialog => dialog.accept());
    await songAction(page, '删除：甲曲');
    await playerPage(page, '播放排行');
    await expect(page.locator('.stm-ranking-list .stm-song-title')).toHaveText(['乙曲']);
    await playerPage(page, '最近播放');
    await expect(page.locator('.stm-recent-list .stm-song-title')).toHaveText(['乙曲']);
});

test('recent page shows only 100 songs and rolling rankings drop expired plays', async ({ page }) => {
    // Install the clock before the app creates its refresh interval.
    await page.clock.install();
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch();
        const body = await response.json();
        const settings = JSON.parse(body.settings);
        const now = Date.now();
        settings.extension_settings.riserein_music_player = {
            tracks: Array.from({ length: 110 }, (_, i) => ({ id: `history-${i}`, kind: 'local', title: `历史歌曲 ${i}` })),
            recentPlays: Array.from({ length: 110 }, (_, i) => ({ trackId: `history-${i}`, at: now - i * 1000 })),
            playEvents: [{ trackId: 'history-0', at: now - 72 * 3600000 - 1 }, { trackId: 'history-1', at: now - 1000 }],
        };
        body.settings = JSON.stringify(settings);
        await route.fulfill({ response, json: body });
    });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await playerPage(page, '最近播放');
    await expect(page.locator('.stm-recent-list li')).toHaveCount(100);
    await expect(page.locator('.stm-recent-list .stm-song-title').first()).toHaveText('历史歌曲 0');
    await expect(page.locator('.stm-recent-list .stm-song-title').last()).toHaveText('历史歌曲 99');
    await playerPage(page, '播放排行');
    await expect(page.locator('.stm-ranking-list .stm-song-title')).toHaveText(['历史歌曲 1']);
    await page.clock.fastForward(72 * 3600000 + 60000);
    await expect(page.locator('.stm-ranking-list li')).toHaveCount(0);
    await expect(page.locator('.stm-ranking-empty')).toBeVisible();
});

test('cropping chooses the actual region, layers themes and materials, persists and removes stored images', async ({ page }) => {
    await importSongs(page, ['换背景时继续播放']);
    await playSong(page, '换背景时继续播放');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await playerPage(page, '外观');
    await expect(page.getByRole('button', { name: '清透', exact: true })).toBeDisabled();
    await importBackground(page);
    await page.getByRole('slider', { name: '裁剪左右位置', exact: true }).fill('100');
    await page.getByRole('slider', { name: '裁剪缩放', exact: true }).fill('1.3');
    const saved = waitForPlayerSave(page, settings => settings.backgroundId && settings.surface === 'clear');
    await page.getByRole('button', { name: '使用此区域', exact: true }).click();
    await expect(page.locator('.stm-crop-editor')).toBeHidden();
    await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background', 'true');
    const id = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.backgroundId);
    const pixel = await page.evaluate(async id => {
        const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js');
        const bitmap = await createImageBitmap(await new LocalMusicStore().get(id));
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const pixel = [...canvas.getContext('2d').getImageData(384, 576, 1, 1).data];
        const result = { width: bitmap.width, height: bitmap.height, pixel };
        bitmap.close();
        return result;
    }, id);
    expect(pixel.width).toBe(768);
    const panelBounds = await page.locator('#stm-player').boundingBox();
    expect(pixel.height).toBe(Math.round(768 * panelBounds.height / panelBounds.width));
    expect(pixel.pixel[2]).toBeGreaterThan(pixel.pixel[0] + 100);
    await page.getByRole('button', { name: '清透', exact: true }).click();
    await saved;
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element, '::before').filter)).toBe('none');
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0');
    const filters = [];
    for (const surface of ['matte', 'glass']) {
        await page.locator(`[data-surface-choice="${surface}"]`).click();
        filters.push(await page.locator('#stm-player').evaluate(element => getComputedStyle(element, '::before').filter));
    }
    expect(filters[0]).not.toBe(filters[1]);
    for (const theme of ['amber', 'ocean', 'forest', 'rose', 'lavender', 'pearl']) {
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background', 'true');
        await expect(page.locator('#stm-player')).toHaveAttribute('data-theme', theme);
    }
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    const lastSave = waitForPlayerSave(page, settings => settings.backgroundId === id && settings.surface === 'clear' && settings.theme === 'pearl');
    await page.getByRole('button', { name: '清透', exact: true }).click();
    await lastSave;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background', 'true');
    await expect(page.locator('#stm-player')).toHaveAttribute('data-surface', 'clear');
    await playerPage(page, '外观');
    await page.getByRole('button', { name: '重新裁剪', exact: true }).click();
    await expect(page.locator('.stm-crop-editor')).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.backgroundId)).toBe(id);
    await page.getByRole('button', { name: '移除图片', exact: true }).click();
    await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background', 'false');
    await expect(page.getByRole('button', { name: '清透', exact: true })).toBeDisabled();
    await expect(page.locator('#stm-player')).toHaveAttribute('data-surface', 'glass');
    expect(await page.evaluate(async id => {
        const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js');
        const store = new LocalMusicStore();
        return Boolean(await store.get(id) || await store.get(`${id}:original`));
    }, id)).toBe(false);
});

test('crop dragging, cancellation and invalid image recovery work on a small screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await importBackground(page);
    const canvas = page.locator('.stm-crop-editor canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
    await page.mouse.up();
    expect(Number(await page.getByRole('slider', { name: '裁剪左右位置', exact: true }).inputValue())).toBeGreaterThan(50);
    await page.keyboard.press('Escape');
    await expect(page.locator('.stm-crop-editor')).toBeHidden();
    await expect(page.locator('#stm-player')).toBeVisible();
    await expect(page.getByRole('button', { name: '导入背景图片', exact: true })).toBeFocused();
    await page.locator('[data-role="background-file"]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(page.locator('.stm-status')).toHaveClass(/stm-error/);
    await expect(page.locator('.stm-crop-editor')).toBeHidden();
    await importBackground(page);
    await page.getByRole('button', { name: '使用此区域', exact: true }).click();
    await expect(page.locator('.stm-crop-editor')).toBeHidden();
    await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background', 'true');
    await expect(page.locator('.stm-mini-player')).toBeInViewport();
});

test('mask transparency is independent per material, preserves clear mode, and persists across reloads', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await importBackground(page);
    await page.getByRole('button', { name: '使用此区域', exact: true }).click();
    await expect(page.locator('.stm-crop-editor')).toBeHidden();
    await page.getByRole('button', { name: '毛玻璃', exact: true }).click();
    await page.getByRole('slider', { name: '遮罩透明度', exact: true }).fill('80');
    await expect(page.locator('[data-role="mask-transparency"]')).toHaveText('80%');
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0.2');
    await page.getByRole('button', { name: '雾面', exact: true }).click();
    await page.getByRole('slider', { name: '遮罩透明度', exact: true }).fill('25');
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0.75');
    await page.getByRole('button', { name: '清透', exact: true }).click();
    await expect(page.getByRole('slider', { name: '遮罩透明度', exact: true })).toBeDisabled();
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0');
    await page.getByRole('button', { name: '毛玻璃', exact: true }).click();
    await expect(page.getByRole('slider', { name: '遮罩透明度', exact: true })).toHaveValue('80');
    const saved = waitForPlayerSave(page, settings => settings.maskOpacity?.glass === .2 && settings.maskOpacity?.matte === .75);
    await page.getByRole('button', { name: '雾面', exact: true }).click();
    await saved;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await playerPage(page, '外观');
    await expect(page.getByRole('slider', { name: '遮罩透明度', exact: true })).toHaveValue('25');
    await page.getByRole('button', { name: '重置透明度', exact: true }).click();
    await expect(page.getByRole('slider', { name: '遮罩透明度', exact: true })).toHaveValue('35');
    await page.getByRole('button', { name: '移除图片', exact: true }).click();
    await expect(page.getByRole('slider', { name: '遮罩透明度', exact: true })).toHaveValue('3');
    await page.getByRole('slider', { name: '遮罩透明度', exact: true }).fill('50');
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(247, 241, 230, 0.5)');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(37, 33, 30, 0.5)');
});

test('custom accent, background and text colors update both controls, preserve music and image, and restore presets', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await importSongs(page, ['自定义颜色时继续播放']);
    await playSong(page, '自定义颜色时继续播放');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await importBackground(page);
    await page.getByRole('button', { name: '使用此区域', exact: true }).click();
    await expect(page.locator('.stm-crop-editor')).toBeHidden();
    for (const [color, value] of [['accent', '#88e1c1'], ['background', '#172c38'], ['text', '#fff0dc']]) await page.locator(`[data-color="${color}"]`).fill(value);
    await expect(page.locator('#stm-custom-colors')).toBeChecked();
    for (const selector of ['#stm-player', '#stm-launcher']) {
        const colors = await page.locator(selector).evaluate(element => {
            const css = getComputedStyle(element);
            return ['--stm-accent', '--stm-solid', '--stm-body'].map(name => css.getPropertyValue(name).trim());
        });
        expect(colors).toEqual(['#88e1c1', '#172c38', '#fff0dc']);
    }
    await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background', 'true');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    const saved = waitForPlayerSave(page, settings => settings.customColors?.enabled && settings.customColors?.text === '#fff0dc' && !settings.clickEffects);
    await page.getByRole('checkbox', { name: '播放器点击涟漪', exact: true }).uncheck();
    await saved;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await playerPage(page, '外观');
    await expect(page.locator('[data-color="accent"]')).toHaveValue('#88e1c1');
    await expect(page.locator('[data-color="background"]')).toHaveValue('#172c38');
    await expect(page.locator('[data-color="text"]')).toHaveValue('#fff0dc');
    await expect(page.locator('#stm-custom-colors')).toBeChecked();
    await expect(page.getByRole('checkbox', { name: '播放器点击涟漪', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: '配色：烟粉', exact: true }).click();
    await expect(page.locator('#stm-custom-colors')).not.toBeChecked();
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).getPropertyValue('--stm-accent').trim())).toBe('#a35877');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).getPropertyValue('--stm-accent').trim())).toBe('#efadc3');
    await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background', 'true');
    await page.getByRole('checkbox', { name: '自定义配色', exact: true }).check();
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).getPropertyValue('--stm-accent').trim())).toBe('#88e1c1');
});

test('click halos animate, clean up, respect reduced motion and never turn drags into clicks', async ({ page }) => {
    await page.clock.install();
    await playerPage(page, '最近播放');
    await expect(page.locator('#stm-player .stm-click-wave')).toHaveCount(1);
    const wave = await page.locator('#stm-player .stm-click-wave').evaluate(element => {
        const animation = element.getAnimations()[0];
        return { duration: animation.effect.getTiming().duration, pointerEvents: getComputedStyle(element).pointerEvents };
    });
    expect(wave.duration).toBe(480);
    expect(wave.pointerEvents).toBe('none');
    await expect(page.locator('#stm-player .stm-click-wave')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await playerPage(page, '曲库');
    await expect(page.locator('#stm-player .stm-click-wave')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
    await expect(page.locator('#stm-player')).toBeHidden();
    await dragTo(page, page.locator('#stm-launcher'), { x: 200, y: 180 });
    await expect(page.locator('#stm-player')).toBeHidden();
    await expect(page.locator('#stm-player .stm-click-wave')).toHaveCount(0);
    await page.locator('#stm-launcher').click();
    await expect(page.locator('#stm-player')).toBeVisible();
});

test('library and import are independent, and covers switch to synchronized embedded MP3 lyrics', async ({ page }) => {
    await playerPage(page, '曲库');
    await expect(page.locator('#stm-url')).toBeHidden();
    await expect(page.locator('#stm-import-playlist')).toBeHidden();
    await expect(page.locator('#stm-new-playlist')).toBeHidden();
    const image = await imageFixture(page);
    await playerPage(page, '导入');
    await expect(page.locator('.stm-track-list')).toBeHidden();
    await page.locator('[data-role="files"]').setInputFiles({ name: 'unknown.mp3', mimeType: 'audio/mpeg', buffer: taggedMp3(image.buffer) });
    await expect(page.locator('.stm-status')).toContainText('已导入 1 首');
    await playerPage(page, '曲库');
    await expect(page.locator('.stm-track-title')).toHaveText('标签里的歌名');
    await expect(page.locator('.stm-track-select small').first()).toHaveText('内嵌歌手');
    await playSong(page, '标签里的歌名');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await expect(page.locator('.stm-cover-image')).toHaveAttribute('src', /^blob:/);
    const size = await page.locator('.stm-cover-stage').boundingBox();
    expect(size.width).toBeGreaterThan(200); expect(Math.abs(size.width - size.height)).toBeLessThan(1);
    await page.getByRole('button', { name: '显示歌词', exact: true }).click();
    await expect(page.locator('.stm-lyrics-lines p')).toHaveText(['第一句', '第二句', '第三句']);
    await page.locator('#stm-player audio').evaluate(audio => { audio.currentTime = 3; });
    await expect(page.locator('.stm-current-lyric')).toHaveText('第二句');
    await page.getByRole('button', { name: '显示封面', exact: true }).click();
    await expect(page.locator('.stm-lyrics-view')).toBeHidden();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    const saved = waitForPlayerSave(page, settings => settings.fontPreset === 'song' && settings.tracks?.[0]?.coverId);
    await playerPage(page, '外观'); await selectFont(page, 'song'); await saved;
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await expect(page.locator('.stm-cover-image')).toHaveAttribute('src', /^blob:/);
    await page.getByRole('button', { name: '显示歌词', exact: true }).click();
    await expect(page.locator('.stm-lyrics-lines p')).toHaveText(['第一句', '第二句', '第三句']);
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
});

test('missing art uses bundled images; manual cover and LRC imports persist and delete with the song', async ({ page }) => {
    await importSongs(page, ['没有封面的歌']);
    await playerPage(page, '播放');
    await expect(page.locator('.stm-cover-image')).toHaveAttribute('src', /assets\/covers\/(forest|moon|sunroom)\.png$/);
    await page.getByRole('button', { name: '显示歌词', exact: true }).click();
    await expect(page.locator('.stm-no-lyrics')).toHaveText('暂无歌词');
    for (const cover of ['forest', 'moon', 'sunroom']) {
        const ok = await page.evaluate(async name => { const image = new Image(); image.src = `/scripts/extensions/third-party/sillytavern/assets/covers/${name}.png`; await image.decode(); return image.naturalWidth > 200; }, cover);
        expect(ok).toBe(true);
    }
    await playerPage(page, '曲库');
    await page.getByRole('button', { name: '歌曲详情：没有封面的歌', exact: true }).click();
    await page.locator('[data-role="song-cover-file"]').setInputFiles(await imageFixture(page));
    await expect(page.locator('.stm-status')).toHaveText('歌曲封面已更新。');
    await page.locator('[data-role="lyrics-file"]').setInputFiles({ name: '歌词.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]月光\n[00:02]照进窗台') });
    await expect(page.locator('.stm-status')).toContainText('歌词已导入');
    await playerPage(page, '播放');
    await expect(page.locator('.stm-cover-image')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('.stm-lyrics-lines p')).toHaveText(['月光', '照进窗台']);
    const keys = await page.evaluate(() => { const track = SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0]; return [track.id, track.coverId]; });
    await playerPage(page, '曲库'); page.once('dialog', dialog => dialog.accept());
    await songAction(page, '删除：没有封面的歌');
    expect(await page.evaluate(async keys => { const {LocalMusicStore} = await import('/scripts/extensions/third-party/sillytavern/local-store.js'); const store=new LocalMusicStore(); return (await Promise.all(keys.map(key=>store.get(key)))).every(value=>!value); }, keys)).toBe(true);
    await expect(page.locator('.stm-track')).toHaveCount(0);
});

test('the bundled GenWan font works offline, custom fonts persist, and font changes stay inside the player', async ({ page }) => {
    const hostFont = await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily);
    await playerPage(page, '外观'); await selectFont(page, 'genwan');
    await expect(page.locator('[data-role="font-status"]')).toContainText('完整字库已内置', { timeout: 30000 });
    expect(await page.evaluate(() => [...document.fonts].some(face => face.family === 'stm-genwan' && face.status === 'loaded'))).toBe(true);
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toBe(hostFont);
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).fontFamily)).toContain('stm-genwan');
    await page.locator('[data-role="font-file"]').setInputFiles('assets/fonts/GenWanMin2TC-R.woff2');
    await expect(page.locator('.stm-status')).toContainText('字体已导入', { timeout: 30000 });
    const id = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.fontId);
    const saved = waitForPlayerSave(page, settings => settings.fontId === id && settings.fontPreset === 'custom' && settings.volume === .29);
    await playerPage(page, '播放'); await page.locator('#stm-volume').fill('29'); await saved;
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await playerPage(page, '外观');
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', id);
    await expect(page.locator('[data-role="font-status"]')).toContainText('当前使用', { timeout: 30000 });
    await page.locator('[data-role="font-file"]').setInputFiles({ name:'broken.ttf', mimeType:'font/ttf', buffer:Buffer.from('broken') });
    await expect(page.locator('.stm-status')).toHaveClass(/stm-error/);
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.fontId)).toBe(id);
    if (await page.locator('#stm-font-gallery').isHidden()) await page.locator('#stm-font').click();
    await page.getByRole('button', { name:'删除字体：GenWanMin2TC-R', exact:true }).click();
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', 'inherit');
    expect(await page.evaluate(async id => { const {LocalMusicStore} = await import('/scripts/extensions/third-party/sillytavern/local-store.js'); return Boolean(await new LocalMusicStore().get(id)); },id)).toBe(false);
});

test('all seven bundled faces show their own previews, work without the font CDN, and support keyboard selection', async ({ page }) => {
    test.setTimeout(90000);
    const remoteFonts = [];
    page.on('request', request => { if (/fontsapi|zeoseven/.test(request.url())) remoteFonts.push(request.url()); });
    await page.route('https://fontsapi.zeoseven.com/**', route => route.abort());
    const bodyFont = await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily);
    await playerPage(page, '外观');
    await page.locator('#stm-font').click();
    const renderedSamples = [];
    for (const id of ['genwan', 'poxiao', 'chill', 'ukai', 'child', 'kinghwa', 'huiwen']) {
        const row = page.locator(`.stm-font-row[data-font-id="${id}"]`);
        await row.scrollIntoViewIfNeeded();
        await expect(row).toHaveAttribute('data-preview', 'ready', { timeout: 30000 });
        const sample = row.locator('.stm-font-sample');
        await expect(sample).toBeVisible();
        expect((await row.boundingBox()).height).toBeLessThan(48);
        await expect(sample.locator('small')).toHaveCount(0);
        expect(await sample.evaluate(element => getComputedStyle(element).whiteSpace)).toBe('nowrap');
        expect(await sample.evaluate(element => getComputedStyle(element).fontFamily)).toContain(`stm-${id}`);
        await row.getByRole('radio').click();
        await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', id);
        await expect(row.getByRole('radio')).toHaveAttribute('aria-checked', 'true');
        expect(await page.evaluate(family => [...document.fonts].some(face => face.family === family && face.status === 'loaded'), `stm-${id}`)).toBe(true);
        renderedSamples.push(await sample.evaluate(element => { const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 80; const painter = canvas.getContext('2d'); painter.font = `28px ${getComputedStyle(element).fontFamily}`; painter.fillText('听见故事里的风 · Music 0123456789', 5, 40); return canvas.toDataURL(); }));
        expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).fontFamily)).toContain(`stm-${id}`);
    }
    expect(new Set(renderedSamples).size).toBe(7);
    expect(remoteFonts).toEqual([]);
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toBe(bodyFont);
    await page.keyboard.press('Home');
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', 'inherit');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', 'sans');
    await page.keyboard.press('Escape');
    await expect(page.locator('#stm-font-gallery')).toBeHidden();
    await expect(page.locator('#stm-player')).toBeVisible();
});

test('batch font imports preserve both files, reject duplicates and invalid files, and delete independently after reload', async ({ page }) => {
    await playerPage(page, '外观');
    await page.locator('[data-role="font-file"]').setInputFiles(['assets/fonts/PoxiaoPixel.woff2', 'assets/fonts/ChildFunSans.woff2']);
    await expect(page.locator('.stm-status')).toContainText('字体已导入 2 款');
    const fonts = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.fonts);
    expect(fonts).toHaveLength(2);
    const saved = waitForPlayerSave(page, settings => settings.fonts?.length === 2 && settings.volume === .27);
    await playerPage(page, '播放'); await page.locator('#stm-volume').fill('27'); await saved;
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await playerPage(page, '外观');
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', fonts[1].id);
    await page.locator('#stm-font').click();
    for (const font of fonts) {
        const row = page.locator(`.stm-font-row[data-font-id="${font.id}"]`);
        await row.scrollIntoViewIfNeeded(); await expect(row).toHaveAttribute('data-preview', 'ready');
    }
    await page.locator('[data-role="font-file"]').setInputFiles('assets/fonts/PoxiaoPixel.woff2');
    await expect(page.locator('.stm-status')).toContainText('重复字体');
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.fonts.length)).toBe(2);
    await page.locator('[data-role="font-file"]').setInputFiles({ name: 'broken.ttf', mimeType: 'font/ttf', buffer: Buffer.from('broken') });
    await expect(page.locator('.stm-status')).toHaveClass(/stm-error/);
    await page.getByRole('button', { name: '删除字体：ChildFunSans', exact: true }).click();
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', fonts[0].id);
    expect(await page.evaluate(async id => { const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js'); return Boolean(await new LocalMusicStore().get(id)); }, fonts[1].id)).toBe(false);
    await selectFont(page, 'kinghwa');
    await page.getByRole('button', { name: '删除字体：PoxiaoPixel', exact: true }).click();
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', 'kinghwa');
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.fonts)).toEqual([]);
});

test('a legacy single custom font survives upgrading to the preview library', async ({ page }) => {
    await playerPage(page, '外观');
    await page.locator('[data-role="font-file"]').setInputFiles('assets/fonts/ChildFunSans.woff2');
    await expect(page.locator('.stm-status')).toContainText('字体已导入');
    const saved = waitForPlayerSave(page, settings => settings.fontPreset === 'custom' && !settings.fonts);
    const id = await page.evaluate(() => {
        const context = SillyTavern.getContext(); const settings = context.extensionSettings.riserein_music_player;
        delete settings.fonts; context.saveSettingsDebounced(); return settings.fontId;
    });
    await saved; await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await playerPage(page, '外观');
    await expect(page.locator('[data-role="font-status"]')).toContainText('当前使用');
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', id);
    const fonts = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.fonts);
    expect(fonts).toEqual([{ id, name: 'ChildFunSans' }]);
});

test('font previews fit mobile and failed bundled downloads keep the current font until a successful retry', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.route('**/assets/fonts/KingHwaOldSong.ttf', route => route.abort());
    await selectFont(page, 'child');
    const row = page.locator('.stm-font-row[data-font-id="kinghwa"]');
    await row.scrollIntoViewIfNeeded();
    await expect(row).toHaveAttribute('data-preview', 'error');
    await expect(row.locator('.stm-font-sample')).toBeHidden();
    await row.getByRole('radio').click();
    await expect(page.locator('[data-role="font-status"]')).toContainText('加载失败');
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', 'child');
    const sizes = await page.locator('#stm-font-gallery').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
    expect(sizes.right).toBeLessThanOrEqual(375);
    await page.unroute('**/assets/fonts/KingHwaOldSong.ttf');
    await row.getByRole('radio').click();
    await expect(page.locator('#stm-font')).toHaveAttribute('data-font-choice', 'kinghwa');
    await expect(row).toHaveAttribute('data-preview', 'ready');
    await expect(row.locator('.stm-font-sample')).toBeVisible();
});

test('lyrics occupy the transparent full panel, preserve playback, and return with a click or Escape', async ({ page }) => {
    await importSongs(page, ['透明歌词']);
    await playerPage(page, '曲库');
    await page.getByRole('button', { name: '歌曲详情：透明歌词', exact: true }).click();
    await page.locator('[data-role="lyrics-file"]').setInputFiles({ name: 'lyrics.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]第一行歌词\n[00:02]第二行歌词\n[00:04]第三行歌词') });
    await playSong(page, '透明歌词');
    await page.getByRole('button', { name: '显示歌词', exact: true }).click();
    const lyrics = page.locator('.stm-lyrics-view');
    const box = await lyrics.boundingBox(), panel = await page.locator('#stm-player').boundingBox();
    expect(box.height).toBeGreaterThan(panel.height - 35); expect(box.width).toBeGreaterThan(panel.width - 35);
    expect(await lyrics.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('#stm-seek')).toBeHidden();
    await expect(page.locator('.stm-tabs')).toBeHidden();
    expect(await page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(lyrics).toBeHidden(); await expect(page.locator('#stm-player')).toBeVisible();
    await page.getByRole('button', { name: '显示歌词', exact: true }).click();
    await page.getByRole('button', { name: '显示封面', exact: true }).click({ position: { x: 20, y: 20 } });
    await expect(page.locator('.stm-cover-stage')).toBeVisible();
    expect(await page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
});

test('frosted playlist menus are readable, keyboard accessible, and stay inside a phone-sized panel', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const first = await createAlbum(page, '月光歌单'), second = await createAlbum(page, '森林歌单');
    await playerPage(page, '播放');
    const button = page.locator('#stm-playlist-trigger');
    await button.focus(); await page.keyboard.press('ArrowDown');
    const menu = page.locator('#stm-playlist-menu');
    await expect(menu).toBeVisible();
    const style = await menu.evaluate(element => ({ blur: getComputedStyle(element).backdropFilter, color: getComputedStyle(element).backgroundColor }));
    expect(style.blur).toContain('blur(24px)'); expect(style.color).not.toBe('rgb(255, 255, 255)');
    const bounds = await menu.boundingBox(), panel = await page.locator('#stm-player').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(panel.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(bounds.y).toBeGreaterThanOrEqual(panel.y); expect(bounds.y + bounds.height).toBeLessThanOrEqual(panel.y + panel.height);
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(page.locator('#stm-playlist')).toHaveValue(first); await expect(menu).toBeHidden();
    await chooseSelect(page, '#stm-playlist', second);
    await button.click(); await page.keyboard.press('Escape');
    await expect(menu).toBeHidden(); await expect(page.locator('#stm-player')).toBeVisible();
    await button.click(); await page.locator('.stm-now-info').click(); await expect(menu).toBeHidden();
    await expect(page.locator('#stm-mode svg')).toHaveCount(1);
    await chooseMode(page, 'shuffle');
    await expect(page.locator('#stm-mode')).toHaveAttribute('aria-label', '播放模式：随机播放');
});

test('resizing clamps the panel, saves size and position, preserves audio and recovers after viewport changes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await importSongs(page, ['窗口大小']); await playSong(page, '窗口大小');
    const handle = page.locator('.stm-resize-handle');
    await handle.focus();
    for (let n = 0; n < 4; n++) await page.keyboard.press('Shift+ArrowRight');
    for (let n = 0; n < 2; n++) await page.keyboard.press('Shift+ArrowDown');
    let box = await page.locator('#stm-player').boundingBox();
    expect(box.width).toBe(550); expect(box.height).toBe(740);
    const saved = waitForPlayerSave(page, settings => settings.panelSize?.width === 550 && settings.volume === .33);
    await page.locator('#stm-volume').fill('33'); await saved;
    expect(await page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    box = await page.locator('#stm-player').boundingBox(); expect(box.width).toBe(550); expect(box.height).toBe(740);
    const start = await handle.boundingBox();
    await page.mouse.move(start.x + 13, start.y + 13); await page.mouse.down(); await page.mouse.move(5, 5, { steps: 10 }); await page.mouse.up();
    box = await page.locator('#stm-player').boundingBox(); expect(box.width).toBe(320); expect(box.height).toBe(420);
    await dragTo(page, handle, { x: 1270, y: 990 });
    box = await page.locator('#stm-player').boundingBox(); expect(box.width).toBeLessThanOrEqual(720); expect(box.height).toBeLessThanOrEqual(960);
    await page.setViewportSize({ width: 375, height: 667 });
    await expect.poll(async () => (await page.locator('#stm-player').boundingBox()).width).toBeLessThanOrEqual(351);
    box = await page.locator('#stm-player').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(8); expect(box.y).toBeGreaterThanOrEqual(8); expect(box.y + box.height).toBeLessThanOrEqual(659);
    await playerPage(page, '外观'); await page.locator('[data-action="reset-position"]').click();
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.panelSize)).toBe(null);
});

test('system day/night changes update both controls while manual mode and custom colors remain saved', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('#stm-player')).toHaveAttribute('data-color-scheme', 'dark');
    const dark = await page.locator('#stm-player').evaluate(element => getComputedStyle(element).getPropertyValue('--stm-solid'));
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('#stm-player')).toHaveAttribute('data-color-scheme', 'light');
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).getPropertyValue('--stm-solid'))).not.toBe(dark);
    await playerPage(page, '外观');
    const saved = waitForPlayerSave(page, settings => settings.colorScheme === 'light');
    await page.getByRole('button', { name: '日间', exact: true }).click(); await saved;
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('#stm-launcher')).toHaveAttribute('data-color-scheme', 'light');
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await expect(page.locator('#stm-player')).toHaveAttribute('data-color-scheme', 'light');
    await playerPage(page, '外观');
    await page.locator('[data-color="background"]').fill('#193746');
    await page.getByRole('button', { name: '夜间', exact: true }).click();
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).getPropertyValue('--stm-solid'))).toBe('#193746');
    await page.getByRole('button', { name: '跟随系统', exact: true }).click();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('#stm-player')).toHaveAttribute('data-color-scheme', 'light');
});

test('only player clicks and blank areas trigger small optional ripples without intercepting tavern input', async ({ page }) => {
    await page.evaluate(() => { const blank = document.createElement('div'); blank.id = 'stm-test-blank'; Object.assign(blank.style, { position: 'fixed', left: '10px', top: '200px', width: '40px', height: '40px', zIndex: '5000' }); document.body.append(blank); });
    await page.locator('#stm-test-blank').click();
    await expect(page.locator('#stm-player .stm-click-wave')).toHaveCount(0);
    expect(await page.locator('#stm-player .stm-click-effects').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
    await expect(page.locator('.stm-click-wave')).toHaveCount(0);
    await playerPage(page, '外观');
    // Measure connected nodes when they appear; the real 480 ms animation may finish between tool round trips.
    await page.evaluate(() => {
        window.__stmObservedWaveWidths = [];
        window.__stmWaveObserver = new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && node.matches('.stm-click-wave') && node.isConnected) {
                    window.__stmObservedWaveWidths.push(getComputedStyle(node).width);
                }
            }
        });
        window.__stmWaveObserver.observe(document.querySelector('#stm-player .stm-click-effects'), { childList: true });
    });
    await page.locator('#stm-appearance > .stm-page-heading').click();
    await expect.poll(() => page.evaluate(() => window.__stmObservedWaveWidths)).toContain('30px');
    await page.evaluate(() => window.__stmWaveObserver.disconnect());
    await page.locator('#stm-click-effects').uncheck();
    await expect(page.locator('.stm-click-wave')).toHaveCount(0);
    await page.locator('#stm-test-blank').click(); await expect(page.locator('.stm-click-wave')).toHaveCount(0);
});

test.describe('touch resizing', () => {
    test.use({ hasTouch: true });
    test('the resize grip works with touch and keeps all edges visible', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const client = await page.context().newCDPSession(page);
        const grip = await page.locator('.stm-resize-handle').boundingBox();
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x + 12, y: grip.y + 12, id: 1 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: grip.x - 70, y: grip.y - 80, id: 1 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const box = await page.locator('#stm-player').boundingBox();
        expect(box.width).toBe(320); expect(box.height).toBeGreaterThanOrEqual(420); expect(box.height).toBeLessThan(635);
        expect(box.x).toBeGreaterThanOrEqual(8); expect(box.y).toBeGreaterThanOrEqual(8);
        expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.panelSize.width)).toBe(320);
    });
});

test('checkbox ticks remain visible and scrollbars are slim without white tracks', async ({ page }) => {
    await playerPage(page, '外观');
    const check = page.locator('#stm-click-effects');
    for (const theme of ['配色：珍珠白', '配色：松绿']) {
        await page.getByRole('button', { name: theme, exact: true }).click();
        await check.uncheck();
        await expect.poll(() => check.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('0');
        await check.check();
        await expect.poll(() => check.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('1');
        const tick = await check.evaluate(element => {
            const css = getComputedStyle(element, '::before');
            return { opacity: css.opacity, border: css.borderBottomWidth, color: css.borderBottomColor, background: getComputedStyle(element).backgroundColor };
        });
        expect(tick.opacity).toBe('1'); expect(tick.border).toBe('2px'); expect(tick.color).not.toBe(tick.background);
    }
    const scroll = await page.locator('#stm-appearance').evaluate(element => ({
        width: getComputedStyle(element, '::-webkit-scrollbar').width,
        track: getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor,
        arrows: getComputedStyle(element, '::-webkit-scrollbar-button').display,
    }));
    expect(scroll).toEqual({ width: '4px', track: 'rgba(0, 0, 0, 0)', arrows: 'none' });
});

test('my music lists library first, creates an album from a song, and saves an independent playlist cover', async ({ page }) => {
    await importSongs(page, ['放入新歌单']);
    await page.getByRole('tab', { name: '曲库', exact: true }).click();
    await expect(page.locator('#stm-created-playlists')).toBeHidden();
    await expect(page.locator('#stm-library-playlist')).toBeHidden();
    await expect(page.locator('#stm-library-playlist-trigger')).toHaveCount(0);
    await page.getByRole('button', { name: '打开歌单：总曲库', exact: true }).click();
    await songAction(page, '加入歌单：放入新歌单');
    await expect(page.locator('[data-role="membership-title"]')).toHaveText('将「放入新歌单」加入歌单');
    await expect(page.locator('[data-action="confirm-membership"]')).toBeDisabled();
    await page.locator('[data-action="create-for-song"]').click();
    await expect(page.locator('[data-role="create-title"]')).toContainText('放入新歌单');
    await page.locator('#stm-new-playlist').fill('我的午后');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await expect(page.locator('[data-role="collection-title"]')).toHaveText('我的午后');
    await expect(page.locator('.stm-track')).toHaveCount(1);
    const albumId = await page.locator('#stm-library-playlist').inputValue();
    await expect(page.locator('#stm-playlist option')).toHaveText(['总曲库', '我的午后']);
    const audioId = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[0].id);
    await page.locator('[data-action="toggle-manager"]').click();
    const saved = waitForPlayerSave(page, settings => settings.playlists?.some(playlist => playlist.id === albumId && playlist.coverId));
    await page.locator('[data-role="playlist-cover-file"]').setInputFiles(await imageFixture(page));
    await saved;
    const coverId = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playlists[0].coverId);
    await page.getByRole('tab', { name: '曲库', exact: true }).click();
    await expect(page.locator('[data-role="all-collection"] strong, [data-role="playlist-collections"] strong')).toHaveText(['总曲库', '我的午后']);
    await expect(page.locator(`[data-collection-id="${albumId}"] img`)).toHaveAttribute('src', /^blob:/);
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await page.getByRole('tab', { name: '曲库', exact: true }).click();
    await expect(page.locator(`[data-collection-id="${albumId}"] img`)).toHaveAttribute('src', /^blob:/);
    await page.getByRole('button', { name: '管理歌单：我的午后', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '删除歌单', exact: true }).click();
    await expect.poll(() => page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playlists.length)).toBe(0);
    expect(await page.evaluate(async ({coverId, audioId}) => {
        const { LocalMusicStore } = await import('/scripts/extensions/third-party/sillytavern/local-store.js'); const store = new LocalMusicStore();
        return { cover: Boolean(await store.get(coverId)), audio: Boolean(await store.get(audioId)) };
    }, {coverId, audioId})).toEqual({cover:false, audio:true});
});

test('recent and library song controls pause and resume in place and stay in sync with the mini player', async ({ page }) => {
    await importSongs(page, ['原地继续']); await playSong(page, '原地继续');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(.3);
    await playerPage(page, '最近播放');
    const recent = page.locator('.stm-recent-list .stm-row-play');
    await expect(recent).toHaveAttribute('aria-label', '暂停歌曲：原地继续');
    await recent.click();
    await expect(recent).toHaveAttribute('aria-label', '播放歌曲：原地继续');
    const position = await page.locator('#stm-player audio').evaluate(audio => audio.currentTime);
    await expect(page.locator('.stm-mini-play')).toHaveAttribute('aria-label', '底栏播放');
    await recent.click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(position);
    await playerPage(page, '曲库');
    const control = page.locator('.stm-track .stm-row-play');
    await expect(control).toHaveAttribute('aria-label', '暂停歌曲：原地继续');
    await control.click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
    await page.locator('.stm-mini-play').click();
    await expect(control).toHaveAttribute('aria-label', '暂停歌曲：原地继续');
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playEvents.length)).toBe(1);
    expect(await control.evaluate(element => element === element.parentElement.lastElementChild)).toBe(true);
});

test('vinyl mini bar animates only while playing and its queue uses two thirds of desktop and mobile player', async ({ page }) => {
    const long = '月光落在你的窗前，陪你听完这个很长很长的故事，再慢慢说晚安';
    await importSongs(page, [long, ...Array.from({length:14}, (_, index) => `排队${index}`), '下一首']); await playSong(page, long);
    await playerPage(page, '最近播放');
    await expect(page.locator('.stm-mini-player')).toBeVisible();
    await expect(page.locator('.stm-mini-title')).toHaveClass(/stm-marquee/);
    expect(await page.locator('.stm-mini-disc').evaluate(element => getComputedStyle(element).animationPlayState)).toBe('running');
    await page.locator('.stm-mini-play').click();
    expect(await page.locator('.stm-mini-disc').evaluate(element => getComputedStyle(element).animationPlayState)).toBe('paused');
    for (const viewport of [{width:1280,height:900}, {width:375,height:667}]) {
        await page.setViewportSize(viewport);
        await page.locator('.stm-mini-queue').click();
        await expect(page.locator('.stm-queue-track')).toHaveCount(16);
        const panel = await page.locator('#stm-player').boundingBox(), sheet = await page.locator('#stm-queue .stm-queue-sheet').boundingBox();
        expect(sheet.height).toBeLessThanOrEqual(panel.height * 2/3 + 1); expect(sheet.height).toBeGreaterThan(panel.height * .6);
        expect(sheet.y+sheet.height).toBeLessThanOrEqual(panel.y+panel.height);
        await page.getByRole('button', {name: '播放队列歌曲：下一首', exact:true}).click();
        await expect(page.locator('#stm-queue')).toBeVisible();
        await expect(page.locator('.stm-queue-track').last().locator('.stm-row-play')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', {name: '播放队列歌曲：下一首', exact:true})).toBeFocused();
        expect(await page.locator('.stm-queue-list').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
        await expect(page.locator('.stm-mini-queue')).toBeFocused();
        if (!await page.locator('#stm-player audio').evaluate(audio => audio.paused)) await page.locator('.stm-mini-play').click();
    }
    await page.locator('.stm-mini-info').click();
    await expect(page.getByRole('tab', {name:'播放',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.stm-mini-player')).toBeHidden();
});

test('song details open as a two thirds bottom sheet and retain controls, focus and playback after cover edits', async ({ page }) => {
    await importSongs(page, ['我的封面与歌词']); await playSong(page, '我的封面与歌词');
    await playerPage(page, '曲库');
    const opener = page.getByRole('button', {name:'歌曲详情：我的封面与歌词', exact:true});
    for (const viewport of [{width:1280,height:900}, {width:375,height:667}]) {
        await page.setViewportSize(viewport); await opener.click();
        const sheet = page.getByRole('dialog', {name:'歌曲详情', exact:true});
        await expect(sheet).toBeVisible();
        const panel = await page.locator('#stm-player').boundingBox(), box = await sheet.boundingBox();
        expect(box.height).toBeLessThanOrEqual(panel.height*2/3+1);
        expect(box.y).toBeGreaterThanOrEqual(panel.y+panel.height/3-1);
        expect(box.y+box.height).toBeLessThanOrEqual(panel.y+panel.height);
        await expect(page.locator('[data-role="details-title"]')).toHaveText('我的封面与歌词');
        await expect(page.getByRole('button', {name:'关闭歌曲详情',exact:true})).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.getByRole('button', {name:'清除歌词',exact:true})).toBeFocused();
        await page.locator('[data-role="song-cover-file"]').setInputFiles(await imageFixture(page));
        await expect(page.locator('.stm-details-cover')).toHaveAttribute('src', /^blob:/);
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden(); await expect(opener).toBeFocused();
        await opener.click();
        const scrim = page.locator('#stm-details > .stm-queue-scrim');
        await scrim.click({position:{x:(await scrim.boundingBox()).width/2,y:70}});
        await expect(sheet).toBeHidden(); await expect(opener).toBeFocused();
    }
});

test('background saves leave no lingering message and the compact mini bar stays at the bottom in both color schemes', async ({ page }) => {
    await importBackground(page); await page.getByRole('button', {name:'使用此区域',exact:true}).click();
    await expect(page.locator('.stm-crop-editor')).toBeHidden();
    await expect(page.locator('#stm-player')).toHaveAttribute('data-has-background','true');
    await expect(page.locator('.stm-status')).toBeEmpty();
    await page.addStyleTag({content:'#stm-player h3 { color: hotpink !important; }'});
    for (const [viewport, colorScheme] of [[{width:1280,height:900},'light'],[{width:375,height:667},'dark']]) {
        await page.setViewportSize(viewport); await page.emulateMedia({colorScheme});
        const heading = page.getByRole('heading', {name:'配色与背景',exact:true});
        const colors = await heading.evaluate(element => ({heading:getComputedStyle(element).color, body:getComputedStyle(document.getElementById('stm-player')).color}));
        expect(colors.heading).toBe(colors.body); expect(colors.heading).not.toBe('rgb(255, 105, 180)');
        const panel = await page.locator('#stm-player').boundingBox(), mini = await page.locator('.stm-mini-player').boundingBox();
        expect(mini.height).toBeLessThanOrEqual(46);
        expect(panel.y+panel.height-mini.y-mini.height).toBeGreaterThanOrEqual(4);
        expect(panel.y+panel.height-mini.y-mini.height).toBeLessThanOrEqual(8);
        await expect(page.locator('.stm-footer')).toBeHidden();
    }
    await playerPage(page,'播放'); await page.clock.install(); await page.locator('#stm-mode').click();
    await expect(page.locator('.stm-status')).toContainText('播放模式：');
    await playerPage(page,'外观');
    const panel = await page.locator('#stm-player').boundingBox(), mini = await page.locator('.stm-mini-player').boundingBox();
    expect(panel.y+panel.height-mini.y-mini.height).toBeLessThanOrEqual(8);
    await page.clock.fastForward(4100); await expect(page.locator('.stm-status')).toBeEmpty();
    await page.locator('[data-role="files"]').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('bad')});
    await expect(page.locator('.stm-status')).toHaveClass(/stm-error/);
    await page.clock.fastForward(6500); await expect(page.locator('.stm-status')).not.toBeEmpty();
    await page.clock.fastForward(1600); await expect(page.locator('.stm-status')).toBeEmpty();
});

const platformFixtureId = '12345678-1234-1234-1234-123456789abc';
function onlineFixture(overrides={}) {
    return {id:platformFixtureId,title:'公开许可测试音频',creator:'测试作者',url:'https://audio.example.test/platform.wav',duration:30000,license:'by',license_version:'4.0',license_url:'https://creativecommons.org/licenses/by/4.0/',foreign_landing_url:'https://example.test/recording',...overrides};
}
async function mockOnline(page, record=onlineFixture()) {
    const requests=[];
    await page.route('https://api.openverse.org/v1/audio/**', route=>{
        requests.push(route.request().url());const url=new URL(route.request().url());
        return route.fulfill({json:url.pathname===`/v1/audio/${platformFixtureId}/`?record:{result_count:1,next:null,results:[record]},headers:{'access-control-allow-origin':'*'}});
    });
    await page.route('https://audio.example.test/platform.wav',route=>route.fulfill({contentType:'audio/wav',body:wav(30)}));
    return requests;
}
async function onlineMode(page,name){await playerPage(page,'导入');await page.getByRole('tab',{name,exact:true}).click();}

test('online search plays real fixture audio, shows attribution, deduplicates saves and reloads without fetching on startup',async({page})=>{
    const requests=await mockOnline(page);
    await onlineMode(page,'在线搜索');
    expect(await page.locator('#stm-online-platform option').allTextContents()).toEqual(['全部可用来源','Openverse']);
    await page.locator('#stm-online-query').fill('piano');await page.locator('.stm-search-form button[type=submit]').click();
    await expect(page.locator('.stm-online-result')).toHaveCount(1);await expect(page.locator('.stm-online-result')).toContainText('测试作者');
    await expect(page.locator('.stm-online-result')).toContainText('BY 4.0');
    await page.locator('.stm-online-result .stm-row-play').click();
    await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.1);
    expect(await page.locator('#stm-player audio').evaluate(audio=>audio.duration)).toBe(30);
    await expect(page.locator('.stm-online-result .stm-row-play')).toHaveAttribute('aria-pressed','true');
    expect(requests).toHaveLength(1); // Search metadata is reused; playing does not spend an extra anonymous request.
    await page.locator('.stm-online-result .stm-row-play').click();
    await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.paused)).toBe(true);
    await page.getByRole('button',{name:'加入曲库或歌单：公开许可测试音频',exact:true}).click();
    await expect(page.locator('.stm-track')).toHaveCount(1);
    const saved=waitForPlayerSave(page,settings=>settings.volume===.31&&settings.tracks.some(track=>track.kind==='platform'));
    await playerPage(page,'播放');await page.locator('#stm-volume').fill('31');await saved;
    await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();
    expect(requests).toHaveLength(1);await expect(page.locator('.stm-track')).toHaveCount(1);
    await page.locator('[data-action="play"]').click();await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.1);
    expect(requests).toHaveLength(2);
});

test('sharing unsupported platform songs produces explicit external bookmarks while unsupported playlists never import',async({page})=>{
    await page.setViewportSize({width:375,height:667});await onlineMode(page,'分享链接');
    await page.locator('#stm-share-text').fill('分享歌曲 https://music.163.com/song?id=123。');await page.locator('.stm-share-form button[type=submit]').click();
    await expect(page.locator('[data-online="preview-warning"]')).toContainText('只能保存来源链接');
    await expect(page.locator('[data-online="preview-count"]')).toContainText('站内播放 0 首');
    await page.locator('#stm-share-title').fill('我的网易云收藏');await page.locator('[data-online-action=confirm]').click();
    await expect(page.locator('.stm-track')).toHaveCount(1);
    await playerPage(page,'曲库');await expect(page.locator('.stm-track .stm-external-source')).toHaveAttribute('href','https://music.163.com/song?id=123');
    await expect(page.locator('.stm-track .stm-row-play')).toHaveCount(0);
    await page.getByRole('button',{name:'查看来源：我的网易云收藏',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'歌曲详情',exact:true})).toBeVisible();
    await expect(page.locator('[data-role=platform-credit]')).toContainText('仅支持前往官方平台');
    await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.paused)).toBe(true);
    expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.playEvents.length)).toBe(0);
    await onlineMode(page,'分享链接');await page.locator('#stm-share-text').fill('https://music.163.com/playlist?id=456');await page.locator('.stm-share-form button[type=submit]').click();
    await expect(page.locator('[data-online=status]')).toContainText('没有导入歌曲');await expect(page.locator('.stm-share-preview')).toBeHidden();
    expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.playlists.length)).toBe(0);
});

test('share previews are invalidated when edited, confirm target albums, and preserve local/platform mixed playback and binding',async({page})=>{
    const cards=[];try{
        await mockOnline(page);await importSongs(page,['本地保留']);const album=await createAlbum(page,'混合歌单');await addExisting(page,'本地保留',album);
        await onlineMode(page,'分享链接');await chooseSelect(page,'#stm-import-playlist',album);
        await page.locator('#stm-share-text').fill(`https://openverse.org/audio/${platformFixtureId}/`);await page.locator('.stm-share-form button[type=submit]').click();
        await expect(page.locator('.stm-share-preview')).toBeVisible();
        await page.locator('#stm-share-text').fill('新分享 https://open.spotify.com/track/ABC');await expect(page.locator('.stm-share-preview')).toBeHidden();
        await page.locator('#stm-share-text').fill(`https://openverse.org/audio/${platformFixtureId}/`);await page.locator('.stm-share-form button[type=submit]').click();await page.locator('[data-online-action=confirm]').click();
        await selectAlbum(page,album);await expect(page.locator('.stm-track')).toHaveCount(2);await playSong(page,'本地保留');
        await page.getByRole('button',{name:'下一首',exact:true}).click();await expect(page.locator('[data-role=title]')).toHaveText('公开许可测试音频');
        await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.1);
        cards.push(await createTestCard(page,'Online'));await bindCards(page,cards);await selectCard(page,cards[0]);
        await expect(page.locator('#stm-playlist')).toHaveValue(album);await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.paused)).toBe(true);
    }finally{if(cards.length)await removeTestCards(page,cards);}
});

test('failed and cancelled online searches leave local music usable and enforce rate-limit cooldown',async({page})=>{
    await importSongs(page,['离线仍可用']);let requests=0;
    await page.route('https://api.openverse.org/v1/audio/**',route=>{requests++;return route.fulfill({status:429,json:{detail:'throttled'},headers:{'Retry-After':'60','access-control-allow-origin':'*'}});});
    await onlineMode(page,'在线搜索');await page.locator('#stm-online-query').fill('piano');await page.locator('.stm-search-form button[type=submit]').click();
    await expect(page.locator('[data-online=status]')).toContainText('次数已达上限');
    await page.locator('#stm-online-query').fill('rain');await page.locator('.stm-search-form button[type=submit]').click();await expect(page.locator('[data-online=status]')).toContainText('正在限流');expect(requests).toBe(1);
    await playSong(page,'离线仍可用');await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.1);
});

test('empty default catalog stays separate, can be hidden, and never invents preset songs',async({page})=>{
    await page.getByRole('tab',{name:'曲库',exact:true}).click();await expect(page.getByRole('button',{name:'打开默认曲库',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'打开默认曲库',exact:true}).click();await expect(page.locator('.stm-empty')).toContainText('尚未配置默认曲目');
    expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.tracks.length)).toBe(0);
    await playerPage(page,'外观');const saved=waitForPlayerSave(page,s=>s.builtinHidden);await page.locator('#stm-hide-builtin').check();await saved;
    await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();await page.getByRole('tab',{name:'曲库',exact:true}).click();
    await expect(page.getByRole('button',{name:'打开默认曲库',exact:true})).toBeHidden();expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.playlists.length)).toBe(0);
});

test('cancelling an online request prevents stale results from replacing a later successful search',async({page})=>{
    let release;const gate=new Promise(resolve=>{release=resolve;});let calls=0;
    await page.route('https://api.openverse.org/v1/audio/**',async route=>{const first=++calls===1;if(first)await gate;await route.fulfill({json:{results:[onlineFixture({title:first?'迟到的结果':'当前结果'})],next:null},headers:{'access-control-allow-origin':'*'}}).catch(()=>{});});
    await onlineMode(page,'在线搜索');await page.locator('#stm-online-query').fill('first');await page.locator('.stm-search-form button[type=submit]').click();
    await expect.poll(()=>calls).toBe(1);await page.locator('[data-online-action=cancel]').click();await expect(page.locator('[data-online=status]')).toContainText('已取消');
    await page.locator('#stm-online-query').fill('second');await page.locator('.stm-search-form button[type=submit]').click();await expect(page.locator('.stm-online-result')).toContainText('当前结果');release();
    await expect(page.locator('.stm-online-result')).toHaveCount(1);await expect(page.locator('.stm-online-result')).not.toContainText('迟到的结果');
});

test('bundled catalog updates do not fetch playlists at startup or overwrite copied songs and user memberships',async({page})=>{
    await mockOnline(page);let version=1;
    const one={id:`platform:openverse:${platformFixtureId}`,kind:'platform',platform:'openverse',platformTrackId:platformFixtureId,title:'开发者测试预设',sourceUrl:`https://openverse.org/audio/${platformFixtureId}/`,playback:'full'};
    await page.route('**/builtin-tracks.js',route=>route.fulfill({contentType:'text/javascript',body:`export const BUILTIN_CATALOG = ${JSON.stringify({version,title:'测试预设',tracks:version===1?[one]:[{...one,title:'开发者更新名称'},{...one,id:undefined,platformTrackId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',title:'新增测试曲目'}]})};`}));
    const clean=waitForPlayerSave(page,s=>s.volume===.32&&s.tracks.length===0);await playerPage(page,'播放');await page.locator('#stm-volume').fill('32');await clean;
    await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();
    const album=await createAlbum(page,'保留自己的收藏');
    await page.getByRole('tab',{name:'曲库',exact:true}).click();await page.getByRole('button',{name:'打开默认曲库',exact:true}).click();
    await expect(page.locator('.stm-track-title')).toHaveText('开发者测试预设');
    await songAction(page, '加入歌单：开发者测试预设');await chooseSelect(page,'#stm-add-target',album);
    const saved=waitForPlayerSave(page,s=>s.tracks.length===1&&s.playlists[0].trackIds.length===1);await page.locator('[data-action=confirm-membership]').click();await saved;
    const renamed=waitForPlayerSave(page,s=>s.tracks[0].title==='用户自己的名称');await page.evaluate(()=>{const c=SillyTavern.getContext();c.extensionSettings.riserein_music_player.tracks[0].title='用户自己的名称';c.saveSettingsDebounced();});await renamed;
    version=2;await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();
    expect(await page.evaluate(()=>{const s=SillyTavern.getContext().extensionSettings.riserein_music_player;return {own:s.tracks.map(t=>t.title),defaults:s.builtinCatalog.tracks.length,version:s.builtinCatalog.version,lists:s.playlists.length,serialized:Object.hasOwn(JSON.parse(JSON.stringify(s)),'builtinCatalog')};})).toEqual({own:['用户自己的名称'],defaults:2,version:2,lists:1,serialized:false});
    await selectAlbum(page,album);await expect(page.locator('.stm-track-title')).toHaveText('用户自己的名称');
});

test('conditional playlist adapter previews every page, refuses overflow and reuses repeated source playlists',async({page})=>{
    let total=205;
    await page.route('**/platforms/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const PLATFORM_CONFIG = {audius:{apiKey:"public-fixture-key",baseUrl:"https://api.audius.co/v1/"}};'}));
    await page.route('https://api.audius.co/v1/**',route=>{
        const url=new URL(route.request().url());const headers={'access-control-allow-origin':'*'};
        if(url.pathname.endsWith('/resolve'))return route.fulfill({json:{data:[{id:'fixture-list',playlist_name:'Audius 测试歌单',track_count:total}]},headers});
        const offset=Number(url.searchParams.get('offset'));
        return route.fulfill({json:{data:Array.from({length:Math.min(100,total-offset)},(_,n)=>({id:`fixture${n+offset}`,title:`顺序 ${n+offset}`,user:{name:'测试作者',handle:'test'},permalink:`/test/fixture${n+offset}`,is_stream_gated:n+offset===3}))},headers});
    });
    const clean=waitForPlayerSave(page,s=>s.volume===.33&&s.tracks.length===0);await playerPage(page,'播放');await page.locator('#stm-volume').fill('33');await clean;
    await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();
    await onlineMode(page,'分享链接');await page.locator('#stm-share-text').fill('https://audius.co/test/playlist/fixture');await page.locator('.stm-share-form button[type=submit]').click();
    await expect(page.locator('[data-online="preview-count"]')).toContainText('共 205 首');await expect(page.locator('.stm-share-tracks li')).toHaveCount(205);
    await page.locator('[data-online-action=confirm]').click();await expect(page.locator('[data-online=status]')).toContainText('超出上限');
    expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.tracks.length)).toBe(0);
    total=101;await page.locator('#stm-share-text').fill('https://audius.co/test/playlist/fixture?v=2');
    // Search responses have a short cache; a fresh service on reload proves no partial data was persisted.
    await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();await onlineMode(page,'分享链接');
    await page.locator('#stm-share-text').fill('https://audius.co/test/playlist/fixture?v=2');await page.locator('.stm-share-form button[type=submit]').click();
    await expect(page.locator('[data-online="preview-count"]')).toContainText('共 101 首');await expect(page.locator('[data-online="preview-count"]')).toContainText('站外或受限 1 首');
    await page.locator('[data-online-action=confirm]').click();await expect(page.locator('[data-online=status]')).toContainText('新增 101 首');
    await page.locator('[data-online-action=confirm]').click();await expect(page.locator('[data-online=status]')).toContainText('新增 0 首');
    expect(await page.evaluate(()=>{const s=SillyTavern.getContext().extensionSettings.riserein_music_player;return {tracks:s.tracks.length,lists:s.playlists.length,last:s.tracks.at(-1).title,members:s.playlists[0].trackIds.length};})).toEqual({tracks:101,lists:1,last:'顺序 100',members:101});
});

test('official music embeds preserve metadata, pause native playback, stop on dismissal and never fabricate history', async ({ page }) => {
    await page.route('**/platforms/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const PLATFORM_CONFIG={embeds:{spotify:true,soundcloud:true}};' }));
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await importSongs(page, ['原生音乐']); await playSong(page, '原生音乐');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(.1);
    await page.route('https://open.spotify.com/oembed**', route => route.fulfill({ json: { provider_name: 'Spotify', title: '官方测试曲目', thumbnail_url: 'https://example.test/art.jpg', html: '<script>window.bad=true</script>' }, headers: { 'access-control-allow-origin': '*' } }));
    await page.route('https://open.spotify.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<p>官方播放器测试替身；没有音乐</p>' }));
    await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.tracks.push({ id:'platform:spotify:ABC',kind:'platform',platform:'spotify',platformTrackId:'ABC',sourceUrl:'https://open.spotify.com/track/ABC',title:'Spotify · ABC',metadataStatus:'reference',playback:'external',lyrics:'个人歌词保留' }));
    await onlineMode(page, '分享链接'); await page.locator('#stm-share-text').fill('https://open.spotify.com/track/ABC');
    await page.locator('.stm-share-form button[type=submit]').click();
    await expect(page.locator('[data-online="preview-warning"]')).toContainText('官方播放器');
    await page.locator('[data-online-action=confirm]').click();
    await playerPage(page, '曲库');
    await expect(page.locator('.stm-track-title')).toHaveText(['原生音乐', '官方测试曲目']);
    expect(await page.evaluate(() => { const t=SillyTavern.getContext().extensionSettings.riserein_music_player.tracks[1]; return { reference:t.metadataStatus,lyrics:t.lyrics }; })).toEqual({ reference:undefined,lyrics:'个人歌词保留' });
    const before = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playEvents.length);
    await page.getByRole('button', { name: '打开官方播放器：官方测试曲目', exact: true }).click();
    await expect(page.locator('[data-role="official-player"] iframe')).toHaveAttribute('src', 'https://open.spotify.com/embed/track/ABC');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playEvents.length)).toBe(before);
    expect(await page.evaluate(() => window.bad)).toBeUndefined();
    await page.getByRole('button', { name: '关闭歌曲详情', exact: true }).click();
    await expect(page.locator('[data-role="official-player"] iframe')).toHaveCount(0);
    await playSong(page, '原生音乐');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    await page.setViewportSize({ width: 375, height: 667 });
    await onlineMode(page, '分享链接'); await page.locator('#stm-share-text').fill('https://open.spotify.com/playlist/ABC');
    await page.locator('.stm-share-form button[type=submit]').click();
    await expect(page.locator('[data-online=status]')).toContainText('没有导入歌曲');
    await page.locator('[data-online-action=official-list]').click();
    await expect(page.locator('[data-online="official-list-player"] iframe')).toHaveAttribute('src', 'https://open.spotify.com/embed/playlist/ABC');
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playlists.length)).toBe(0);
    await page.locator('#stm-share-text').fill('https://music.163.com/song?id=123');
    await expect(page.locator('[data-online="official-list-player"] iframe')).toHaveCount(0);
});

test('expired platform audio is refreshed on manual retry and the real playback check requires advancing audio', async ({ page }) => {
    let details = 0;
    await page.route('https://api.openverse.org/v1/audio/**', route => {
        const detail = new URL(route.request().url()).pathname !== '/v1/audio/';
        if (detail) details++;
        const record = onlineFixture({ url: detail ? 'https://audio.example.test/fresh.wav' : 'https://audio.example.test/stale.mp3' });
        return route.fulfill({ json: detail ? record : { results: [record], next: null }, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.route('https://audio.example.test/stale.mp3', route => route.fulfill({ status: 403, body: 'expired' }));
    await page.route('https://audio.example.test/fresh.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav(30) }));
    await onlineMode(page, '在线搜索'); await page.locator('#stm-online-query').fill('piano'); await page.locator('.stm-search-form button[type=submit]').click();
    await page.getByRole('button', { name: '检查真实播放：公开许可测试音频', exact: true }).click();
    await expect(page.locator('[data-online=status]')).toContainText('未通过播放检查');
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playEvents.length)).toBe(0);
    await page.getByRole('button', { name: '检查真实播放：公开许可测试音频', exact: true }).click();
    await expect(page.locator('[data-online=status]')).toContainText('真实播放已通过');
    expect(details).toBe(1);
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(.5);
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.playEvents.length)).toBe(1);
});

test('a large playlist can be explicitly selected to fit capacity without silently discarding tracks or source artwork', async ({ page }) => {
    await page.route('**/platforms/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const PLATFORM_CONFIG={audius:{apiKey:"public-fixture",baseUrl:"https://api.audius.co/v1/"}};' }));
    await page.route('https://api.audius.co/v1/**', route => {
        const url = new URL(route.request().url()), headers = { 'access-control-allow-origin': '*' };
        if (url.pathname.endsWith('/resolve')) return route.fulfill({ json: { data: [{ id: 'select-list', playlist_name: '选择歌单', track_count: 205, user: { name: '原作者' }, artwork: { '480x480': 'https://example.test/list.jpg' } }] }, headers });
        const offset = Number(url.searchParams.get('offset'));
        return route.fulfill({ json: { data: Array.from({ length: Math.min(100, 205-offset) }, (_, n) => ({ id: `choice${offset+n}`, title: `选曲 ${offset+n}`, permalink: `/artist/choice${offset+n}`, user: { name: '作者' }, is_stream_gated: offset+n===3 })) }, headers });
    });
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await onlineMode(page, '分享链接'); await page.locator('#stm-share-text').fill('https://audius.co/user/playlist/test'); await page.locator('.stm-share-form button[type=submit]').click();
    await expect(page.locator('.stm-share-tracks li')).toHaveCount(205);
    await page.locator('[data-online-action=confirm]').click(); await expect(page.locator('[data-online=status]')).toContainText('超出上限');
    await page.locator('[data-online-action=select-fit]').click();
    await expect(page.locator('[data-online="selection-count"]')).toContainText('已选 200 / 205 首');
    await page.getByRole('checkbox', { name: '选择导入：选曲 3', exact: true }).uncheck();
    const saved = waitForPlayerSave(page, s => s.tracks.length===199 && s.playlists[0]?.source?.author==='原作者');
    await page.locator('[data-online-action=confirm]').click(); await expect(page.locator('[data-online=status]')).toContainText('199 / 205'); await saved;
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    const result = await page.evaluate(() => { const s=SillyTavern.getContext().extensionSettings.riserein_music_player; return { count:s.tracks.length, last:s.tracks.at(-1).title, source:s.playlists[0].source, members:s.playlists[0].trackIds.length }; });
    expect(result.count).toBe(199); expect(result.members).toBe(199); expect(result.last).toBe('选曲 199');
    expect(result.source.total).toBe(205); expect(result.source.cover).toBe('https://example.test/list.jpg'); expect(result.source.author).toBe('原作者');
});

test('a licensed permanent direct default plays through the real native player and viewing details does not copy it', async ({ page }) => {
    const track = { kind:'platform',platform:'direct',platformTrackId:'rain',title:'开发者直链测试',artist:'测试作者',sourceUrl:'https://example.test/license',url:'https://audio.example.test/default.wav',playback:'full',license:{code:'by',url:'https://creativecommons.org/licenses/by/4.0/',attribution:'测试录音 — 作者'} };
    await page.route('**/builtin-tracks.js', route => route.fulfill({ contentType:'text/javascript',body:`export const BUILTIN_CATALOG=${JSON.stringify({version:20,title:'测试默认',tracks:[track]})};` }));
    await page.route('https://audio.example.test/default.wav', route => route.fulfill({ contentType:'audio/wav',body:wav(30) }));
    await page.reload(); await page.waitForFunction(() => !document.getElementById('preloader')); await page.locator('#stm-launcher').click();
    await page.getByRole('tab', {name:'曲库',exact:true}).click(); await page.getByRole('button',{name:'打开默认曲库',exact:true}).click();
    await page.getByRole('button',{name:'歌曲详情：开发者直链测试',exact:true}).click();
    expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.tracks.length)).toBe(0);
    await page.getByRole('button',{name:'关闭歌曲详情',exact:true}).click();
    await page.getByRole('button',{name:'播放歌曲：开发者直链测试',exact:true}).click();
    await expect.poll(()=>page.locator('#stm-player audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.5);
    expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.playEvents.length)).toBe(1);
});

test('candidate official playback unloads on actual role exit without adding native history', async ({ page }) => {
    const cards=[];
    try {
        await page.route('**/platforms/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const PLATFORM_CONFIG={embeds:{spotify:true}};'}));
        await page.route('**/api/settings/get',async route=>{
            const response=await route.fetch(),body=await response.json(),s=JSON.parse(body.settings);
            s.extension_settings.riserein_music_player={tracks:[{id:'platform:spotify:ABC',kind:'platform',platform:'spotify',platformTrackId:'ABC',title:'角色官方曲目',sourceUrl:'https://open.spotify.com/track/ABC',playback:'embed'}]};
            body.settings=JSON.stringify(s);await route.fulfill({response,json:body});
        });
        await page.route('https://open.spotify.com/embed/**',route=>route.fulfill({contentType:'text/html',body:'<p>Official fixture only</p>'}));
        await page.reload();await page.waitForFunction(()=>!document.getElementById('preloader'));await page.locator('#stm-launcher').click();
        cards.push(await createTestCard(page,'EmbedExit'));await selectCard(page,cards[0]);
        await playerPage(page,'曲库');await page.getByRole('button',{name:'打开官方播放器：角色官方曲目',exact:true}).click();
        await expect(page.locator('[data-role="official-player"] iframe')).toHaveCount(1);
        await page.evaluate(async()=>{const {closeCurrentChat}=await import('/script.js');await closeCurrentChat();});
        await expect(page.locator('[data-role="official-player"] iframe')).toHaveCount(0);
        expect(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.riserein_music_player.playEvents.length)).toBe(0);
    } finally { if(cards.length)await removeTestCards(page,cards); }
});
