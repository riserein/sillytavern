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

async function playerPage(page, name) {
    await page.getByRole('tab', { name, exact: true }).click();
}

async function playSong(page, name) {
    await playerPage(page, '播放');
    await page.getByRole('button', { name: `播放队列歌曲：${name}`, exact: true }).click();
}

async function selectAlbum(page, id) {
    await playerPage(page, '曲库');
    await page.locator('#stm-library-playlist').selectOption(id);
}

async function importSongs(page, names = ['雨夜', '旅途']) {
    await playerPage(page, '曲库');
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
    await expect(page.locator('[data-action="play"]')).toContainText('暂停');
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
    await page.locator('#stm-mode').selectOption('single');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('雨夜');
    await playerPage(page, '播放');
    await page.locator('#stm-mode').selectOption('shuffle');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('旅途');
    await playerPage(page, '播放');
    await page.locator('#stm-mode').selectOption('list');
    await page.locator('#stm-player audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
    await expect(page.locator('[data-role="title"]')).toHaveText('雨夜');
    await playSong(page, '旅途');
    await playerPage(page, '播放');
    await page.locator('#stm-mode').selectOption('sequence');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2);
    // Move to the real end, rather than merely checking that a method was called.
    await page.locator('#stm-player audio').evaluate(audio => { audio.currentTime = audio.duration - 0.05; });
    await expect(page.locator('.stm-status')).toHaveText('播放列表已播放完毕。');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
});

test('settings and IndexedDB music survive a real page reload without autoplay', async ({ page }) => {
    await importSongs(page, ['记住这首歌']);
    await playerPage(page, '播放');
    await page.locator('#stm-mode').selectOption('single');
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
    await expect(page.locator('#stm-mode')).toHaveValue('single');
    await expect(page.locator('#stm-volume')).toHaveValue('35');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
    await playerPage(page, '播放');
    await page.locator('[data-action="play"]').click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
});

test('audio URLs play and duplicate entries are rejected', async ({ page }) => {
    await page.route('https://music.example.test/theme.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav() }));
    await playerPage(page, '曲库');
    await page.locator('#stm-url').fill('https://music.example.test/theme.wav');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await playSong(page, 'theme');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await playerPage(page, '曲库');
    await page.locator('#stm-url').fill('https://music.example.test/theme.wav');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.locator('.stm-status')).toContainText('已经在总曲库');
    await expect(page.locator('.stm-track')).toHaveCount(1);
});

test('invalid files, broken links and browser playback restrictions explain recovery', async ({ page }) => {
    await playerPage(page, '曲库');
    await page.locator('[data-role="files"]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
    await expect(page.locator('.stm-status')).toContainText('请选择音频文件');
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await page.route('https://music.example.test/missing.mp3', route => route.fulfill({ status: 404, body: 'missing' }));
    await playerPage(page, '曲库');
    await page.locator('#stm-url').fill('https://music.example.test/missing.mp3');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.locator('.stm-status')).toContainText('音乐加载失败');
    page.once('dialog', dialog => dialog.accept());
    await playerPage(page, '曲库');
    await page.getByRole('button', { name: '删除：missing', exact: true }).click();
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
    await page.getByRole('button', { name: '◐ 外观', exact: true }).click();
    await page.getByRole('button', { name: '重置悬浮球与窗口位置', exact: true }).click();
    launcher = await page.locator('#stm-launcher').boundingBox();
    expect(launcher.x).toBeCloseTo(317, 0);
    expect(launcher.y).toBeCloseTo(535, 0);
    await expect.poll(() => page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.positions)).toEqual({ launcher: null, panel: null });
});

test('all six palettes and both materials apply to both controls without interrupting music, and persist', async ({ page }) => {
    await importSongs(page, ['配色时继续播放']);
    await playSong(page, '配色时继续播放');
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '◐ 外观', exact: true }).click();
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
    await page.locator('#stm-new-playlist').fill(name);
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await expect(page.locator('[data-role="collection-title"]')).toHaveText(name);
    return page.locator('#stm-playlist').inputValue();
}

async function addExisting(page, song, playlistId) {
    await selectAlbum(page, '');
    await page.getByRole('button', { name: `加入歌单：${song}`, exact: true }).click();
    await page.locator('#stm-add-target').selectOption(playlistId);
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
    await playerPage(page, '曲库');
    await page.locator('#stm-import-playlist').selectOption(albumId);
    await importSongs(page, ['雨声', '炉火']);
    await expect(page.locator('#stm-playlist')).toHaveValue(albumId);
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.tracks.length)).toBe(2);
    await playerPage(page, '曲库');
    await page.locator('#stm-import-playlist').selectOption('');
    await playerPage(page, '曲库');
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
    await page.getByRole('button', { name: '从歌单移除：共有曲', exact: true }).click();
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await selectAlbum(page, second);
    await expect(page.locator('.stm-track')).toHaveCount(1);
    page.once('dialog', dialog => dialog.dismiss());
    await playerPage(page, '曲库');
    await page.getByRole('button', { name: '删除：共有曲', exact: true }).click();
    await expect(page.locator('.stm-track')).toHaveCount(1);
    page.once('dialog', dialog => dialog.accept());
    await playerPage(page, '曲库');
    await page.getByRole('button', { name: '删除：共有曲', exact: true }).click();
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
        await playerPage(page, '曲库');
        await page.locator('#stm-import-playlist').selectOption(first);
        await importSongs(page, ['共同背景']);
        await bindCards(page, cards.slice(0, 2));
        const second = await createAlbum(page, '另一位角色的歌单');
        await playerPage(page, '曲库');
        await page.locator('#stm-import-playlist').selectOption(second);
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
        await playerPage(page, '曲库');
        await page.locator('#stm-import-playlist').selectOption(album);
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
    for (const name of ['最近播放', '播放排行', '外观', '曲库', '播放']) {
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
    await playerPage(page, '曲库');
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
    await page.getByRole('button', { name: '删除：甲曲', exact: true }).click();
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
    expect(pixel.height).toBe(1152);
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
    await expect(page.locator('.stm-footer')).toBeInViewport();
});

test('mask transparency is independent per material, preserves clear mode, and persists across reloads', async ({ page }) => {
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
    expect(await page.locator('#stm-player').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(37, 33, 30, 0.5)');
});

test('custom accent, background and text colors update both controls, preserve music and image, and restore presets', async ({ page }) => {
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
    await page.getByRole('checkbox', { name: '点击涟漪动效', exact: true }).uncheck();
    await saved;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#stm-launcher').click();
    await playerPage(page, '外观');
    await expect(page.locator('[data-color="accent"]')).toHaveValue('#88e1c1');
    await expect(page.locator('[data-color="background"]')).toHaveValue('#172c38');
    await expect(page.locator('[data-color="text"]')).toHaveValue('#fff0dc');
    await expect(page.locator('#stm-custom-colors')).toBeChecked();
    await expect(page.getByRole('checkbox', { name: '点击涟漪动效', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: '配色：烟粉', exact: true }).click();
    await expect(page.locator('#stm-custom-colors')).not.toBeChecked();
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
    await expect(page.locator('#stm-launcher .stm-click-wave')).toHaveCount(0);
    await page.locator('#stm-launcher').click();
    await expect(page.locator('#stm-player')).toBeVisible();
});
