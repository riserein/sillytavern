import { test, expect } from '@playwright/test';

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

async function importSongs(page, names = ['雨夜', '旅途']) {
    await page.locator('#stm-player input[type="file"]').setInputFiles(names.map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wav() })));
    await expect(page.locator('.stm-track')).toHaveCount(names.length);
    await expect(page.locator('.stm-status')).toContainText(`已导入 ${names.length} 首音乐`);
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
    await page.unroute('**/api/settings/get');
    await page.locator('#stm-launcher').click();
    await expect(page.getByRole('heading', { name: '酒馆音乐播放器' })).toBeVisible();
});

test('SillyTavern loads the extension and the empty player is usable', async ({ page }) => {
    await expect(page.locator('[data-action="play"]')).toBeDisabled();
    await expect(page.locator('.stm-empty')).toBeVisible();
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
    await page.getByRole('button', { name: '播放：雨夜', exact: true }).click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await expect(page.locator('[data-action="play"]')).toContainText('暂停');
    await page.locator('#stm-seek').fill('3');
    await page.locator('#stm-seek').dispatchEvent('input');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThanOrEqual(3);
    await page.locator('#stm-volume').fill('25');
    await page.locator('#stm-volume').dispatchEvent('input');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.volume)).toBe(0.25);
    await page.getByRole('button', { name: '静音', exact: true }).click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.muted)).toBe(true);
    await page.getByRole('button', { name: '取消静音', exact: true }).click();
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(false);
    await page.locator('#stm-launcher').click();
    await page.locator('[data-action="play"]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
});

test('manual switching and all four completion modes behave correctly', async ({ page }) => {
    await importSongs(page);
    await page.getByRole('button', { name: '下一首', exact: true }).click();
    await expect(page.locator('[data-role="title"]')).toHaveText('旅途');
    await page.getByRole('button', { name: '上一首', exact: true }).click();
    await expect(page.locator('[data-role="title"]')).toHaveText('雨夜');
    await page.locator('#stm-mode').selectOption('single');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('雨夜');
    await page.locator('#stm-mode').selectOption('shuffle');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('旅途');
    await page.locator('#stm-mode').selectOption('list');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('雨夜');
    await page.getByRole('button', { name: '播放：旅途', exact: true }).click();
    await page.locator('#stm-mode').selectOption('sequence');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2);
    // Move to the real end, rather than merely checking that a method was called.
    await page.locator('#stm-player audio').evaluate(audio => { audio.currentTime = audio.duration - 0.05; });
    await expect(page.locator('.stm-status')).toHaveText('播放列表已播放完毕。');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
});

test('settings and IndexedDB music survive a real page reload without autoplay', async ({ page }) => {
    await importSongs(page, ['记住这首歌']);
    await page.locator('#stm-mode').selectOption('single');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/settings/save') && response.ok());
    await page.locator('#stm-volume').fill('35');
    await page.locator('#stm-volume').dispatchEvent('input');
    await saved;
    await page.reload();
    await expect(page.locator('#stm-launcher')).toBeVisible();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await expect(page.locator('.stm-track')).toHaveCount(1);
    await expect(page.locator('#stm-mode')).toHaveValue('single');
    await expect(page.locator('#stm-volume')).toHaveValue('35');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
    await page.locator('[data-action="play"]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
});

test('audio URLs play and duplicate entries are rejected', async ({ page }) => {
    await page.route('https://music.example.test/theme.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav() }));
    await page.locator('#stm-url').fill('https://music.example.test/theme.wav');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await page.getByRole('button', { name: '播放：theme', exact: true }).click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await page.locator('#stm-url').fill('https://music.example.test/theme.wav');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.locator('.stm-status')).toContainText('已经在播放列表');
    await expect(page.locator('.stm-track')).toHaveCount(1);
});

test('invalid files, broken links and browser playback restrictions explain recovery', async ({ page }) => {
    await page.locator('#stm-player input[type="file"]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
    await expect(page.locator('.stm-status')).toContainText('请选择音频文件');
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await page.route('https://music.example.test/missing.mp3', route => route.fulfill({ status: 404, body: 'missing' }));
    await page.locator('#stm-url').fill('https://music.example.test/missing.mp3');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.locator('.stm-status')).toContainText('音乐加载失败');
    await page.getByRole('button', { name: '删除：missing', exact: true }).click();
    await importSongs(page, ['需要点击播放']);
    await page.locator('#stm-player audio').evaluate(audio => { audio.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError')); });
    await page.locator('[data-action="play"]').click();
    await expect(page.locator('.stm-status')).toContainText('浏览器阻止了自动播放');
});

test('deleting a selected local track clears playback and its stored audio', async ({ page }) => {
    await importSongs(page, ['要删除的音乐']);
    const id = await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.currentId);
    await page.locator('[data-action="play"]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '删除：要删除的音乐', exact: true }).click();
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
    await expect(page.locator('#stm-player img')).toHaveCount(0);
    const bounds = await page.locator('#stm-player').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    await page.locator('#stm-player').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
    await expect(page.locator('.stm-footer')).toBeInViewport();
});
