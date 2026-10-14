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
    const saved = waitForPlayerSave(page, player => player.volume === 0.35);
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
    await expect(page.locator('.stm-status')).toContainText('已经在总曲库');
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
    page.once('dialog', dialog => dialog.accept());
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
    page.once('dialog', dialog => dialog.accept());
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
    await page.getByRole('button', { name: '◐ 配色', exact: true }).click();
    await page.getByRole('button', { name: '重置位置', exact: true }).click();
    launcher = await page.locator('#stm-launcher').boundingBox();
    expect(launcher.x).toBeCloseTo(317, 0);
    expect(launcher.y).toBeCloseTo(535, 0);
    await expect.poll(() => page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.positions)).toEqual({ launcher: null, panel: null });
});

test('all six palettes and both materials apply to both controls without interrupting music, and persist', async ({ page }) => {
    await importSongs(page, ['配色时继续播放']);
    await page.getByRole('button', { name: '播放：配色时继续播放', exact: true }).click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '◐ 配色', exact: true }).click();
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
});

async function createAlbum(page, name) {
    if (await page.locator('#stm-playlist-manager').isHidden()) await page.getByRole('button', { name: '歌单管理', exact: true }).click();
    await page.locator('#stm-new-playlist').fill(name);
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await expect(page.locator('[data-role="collection-title"]')).toHaveText(name);
    return page.locator('#stm-playlist').inputValue();
}

async function addExisting(page, song, playlistId) {
    await page.locator('#stm-playlist').selectOption('');
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
    await page.locator('#stm-import-playlist').selectOption(albumId);
    await importSongs(page, ['雨声', '炉火']);
    await expect(page.locator('#stm-playlist')).toHaveValue(albumId);
    expect(await page.evaluate(() => SillyTavern.getContext().extensionSettings.riserein_music_player.tracks.length)).toBe(2);
    await page.locator('#stm-import-playlist').selectOption('');
    await page.locator('#stm-player input[type="file"]').setInputFiles({ name: '独立音乐.wav', mimeType: 'audio/wav', buffer: wav() });
    await expect(page.locator('#stm-playlist')).toHaveValue('');
    await expect(page.locator('.stm-track')).toHaveCount(3);
    await page.locator('#stm-playlist').selectOption(albumId);
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
    await page.getByRole('button', { name: '播放：雨声', exact: true }).click();
    await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
});

test('shared songs, album-only removal and confirmed global deletion have distinct effects', async ({ page }) => {
    await importSongs(page, ['共有曲', '其他曲']);
    const first = await createAlbum(page, '第一张');
    const second = await createAlbum(page, '第二张');
    await addExisting(page, '共有曲', first);
    await addExisting(page, '共有曲', second);
    await expect(page.locator('.stm-track')).toHaveCount(2);
    await page.locator('#stm-playlist').selectOption(first);
    await expect(page.locator('.stm-track')).toHaveCount(1);
    await page.getByRole('button', { name: '播放：共有曲', exact: true }).click();
    await page.getByRole('button', { name: '下一首', exact: true }).click();
    await expect(page.locator('[data-role="title"]')).toHaveText('共有曲');
    await page.getByRole('button', { name: '从歌单移除：共有曲', exact: true }).click();
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await page.locator('#stm-playlist').selectOption(second);
    await expect(page.locator('.stm-track')).toHaveCount(1);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '删除：共有曲', exact: true }).click();
    await expect(page.locator('.stm-track')).toHaveCount(1);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '删除：共有曲', exact: true }).click();
    await expect(page.locator('.stm-track')).toHaveCount(0);
    await page.locator('#stm-playlist').selectOption('');
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
        await page.locator('#stm-import-playlist').selectOption(first);
        await importSongs(page, ['共同背景']);
        await bindCards(page, cards.slice(0, 2));
        const second = await createAlbum(page, '另一位角色的歌单');
        await page.locator('#stm-import-playlist').selectOption(second);
        await importSongs(page, ['另一个背景']);
        await bindCards(page, cards.slice(2));
        const saved = waitForPlayerSave(page, player => player.volume === 0.45 && player.playlists?.some(playlist => playlist.characterAvatars.length === 2));
        await page.locator('#stm-volume').fill('45');
        await page.locator('#stm-volume').dispatchEvent('input');
        await saved;
        await page.reload();
        await page.waitForFunction(() => !document.getElementById('preloader'));
        await selectCard(page, cards[0]);
        await expect(page.locator('#stm-player')).toBeVisible();
        await expect(page.locator('#stm-playlist')).toHaveValue(first);
        await expect.poll(() => page.locator('#stm-player audio').evaluate(audio => audio.paused)).toBe(true);
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
        await page.locator('#stm-import-playlist').selectOption(album);
        await importSongs(page, ['等待加载的音乐']);
        await bindCards(page, cards);
        await page.locator('#stm-playlist').selectOption('');
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
