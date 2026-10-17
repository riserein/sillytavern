import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const prefix = '/scripts/extensions/third-party/sillytavern/';
const tone = await readFile(new URL('../card-player/demo-assets/test-tone-a.mp3', import.meta.url));
const results = [];
test.beforeEach(async ({ page }) => {
    await page.route('**/quality-fixture', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><head><meta charset="utf-8"></head><body><section id="author"></section></body></html>',
        }),
    );
    await page.goto('/quality-fixture');
});
async function maker(page) {
    await page.evaluate(async (prefix) => {
        const { createCardMaker } = await import(prefix + 'card-maker.js');
        const { normalizeSettings } = await import(prefix + 'core.js');
        window.fixtureStore = new Map();
        window.fixtureSettings = normalizeSettings({
            tracks: [],
            fontPreset: 'inherit',
        });
        window.maker = createCardMaker({
            panel: document.querySelector('#author'),
            settings: fixtureSettings,
            store: { get: async (id) => fixtureStore.get(id) },
            context: {},
            getCollectionId: () => null,
            pausePlayback() {},
        });
        maker.open();
    }, prefix);
    await expect(page.locator('[data-maker=draft-status]')).toContainText(/草稿已保存|已恢复草稿/);
}
test('drafts survive close/reopen/reload, copy and switch, retaining actual imported audio and edits', async ({
    page,
}) => {
    await maker(page);
    await page.locator('[data-maker-file=audio]').setInputFiles({
        name: 'own-tone.mp3',
        mimeType: 'audio/mpeg',
        buffer: tone,
    });
    await page.locator('#stm-maker-title').fill('项目 A');
    await page.getByLabel('第1首歌名', { exact: true }).fill('草稿歌曲');
    await page.getByLabel('第1首歌词', { exact: true }).evaluate((node) => {
        node.value = '[00:01]保存歌词';
        node.dispatchEvent(new Event('input'));
    });
    await page.locator('[data-maker-color=accent]').evaluate((node) => {
        node.value = '#123456';
        node.dispatchEvent(new Event('input'));
    });
    await page.evaluate(async () => {
        await maker.flush();
        maker.close();
        maker.open();
    });
    await expect(page.locator('#stm-maker-title')).toHaveValue('项目 A');
    await expect(page.getByLabel('第1首歌名', { exact: true })).toHaveValue('草稿歌曲');
    await page.locator('[data-maker=project-copy]').click();
    await expect(page.locator('#stm-maker-title')).toHaveValue('项目 A · 副本');
    await page.locator('#stm-maker-title').fill('项目 B');
    await page.evaluate(() => maker.flush());
    await page.locator('#stm-maker-project').evaluate((node) => {
        node.value = [...node.options].find((option) => option.textContent === '项目 A').value;
        node.dispatchEvent(new Event('change'));
    });
    await expect(page.locator('#stm-maker-title')).toHaveValue('项目 A');
    await expect(page.getByLabel('第1首歌词', { exact: true })).toHaveValue('[00:01]保存歌词');
    await expect(page.locator('[data-maker-color=accent]')).toHaveValue('#123456');
    await page.locator('[data-maker-color=background]').evaluate(node=>{node.value='#234567';node.dispatchEvent(new Event('input'));});
    await page.evaluate(() => maker.flush());
    await page.reload();
    await maker(page);
    await expect(page.locator('#stm-maker-title')).toHaveValue('项目 A');
    await expect(page.locator('[data-maker-color=background]')).toHaveValue('#234567');
    const saved = await page.evaluate(async (prefix) => {
        const { CardProjectStore } = await import(prefix + 'card-player/project-store.js');
        const db = new CardProjectStore();
        const rows = await db.list();
        const row = rows.find((row) => row.title === '项目 A');
        const bytes = row.tracks[0].exportBlob.size;
        await db.dispose();
        return { count: rows.length, bytes };
    }, prefix);
    expect(saved).toEqual({ count: 2, bytes: tone.length });
    await page.locator('[data-maker=analyze]').click();
    await expect(page.locator('.stm-maker-status')).toContainText('容量分析完成');
    await expect(page.locator('[data-maker=analysis]')).toContainText('草稿歌曲');
    await expect(page.locator('[data-maker=analysis]')).toContainText('浏览器音频解码：未验证');
});
test('draft database transactions roll back on clone failure and ordered delete cannot resurrect a project', async ({
    page,
}) => {
    expect(
        await page.evaluate(async (prefix) => {
            const { CardProjectStore } = await import(prefix + 'card-player/project-store.js');
            const store = new CardProjectStore();
            await store.save({
                id: 'safe',
                title: 'old',
                tracks: [new Blob(['audio'])],
            });
            try {
                await store.save({ id: 'safe', title: 'bad', invalid: () => {} });
            } catch {
                /* expected clone failure */
            }
            const old = await store.get('safe');
            const saving = store.save({ id: 'safe', title: 'new' }),
                deleting = store.delete('safe');
            await Promise.all([saving, deleting]);
            const gone = await store.get('safe');
            const original = await store.save({ id: 'atomic', title: 'previous' }, 0);
            try {
                await store.run('readwrite', (rows) => {
                    const request = rows.put({ id: 'atomic', title: 'bad' });
                    rows.transaction.abort();
                    return request;
                });
            } catch {
                /* expected transaction rollback */
            }
            const rollback = await store.get('atomic');
            let conflict = false;
            try {
                await store.save({ id: 'atomic', title: 'stale-tab' }, 0);
            } catch {
                conflict = true;
            }
            await store.dispose();
            return {
                old: old.title,
                bytes: old.tracks[0].size,
                deleted: gone === undefined,
                rollback: rollback.title,
                conflict,
                revision: original.revision,
            };
        }, prefix),
    ).toEqual({
        old: 'old',
        bytes: 5,
        deleted: true,
        rollback: 'previous',
        conflict: true,
        revision: 1,
    });
});
async function runtime(page) {
    await page.evaluate(async (prefix) => {
        const { mountNativePlayer } = await import(prefix + 'card-player/native-entry.js');
        const { blobData } = await import(prefix + 'card-player/export.js');
        const audio = await fetch(prefix + 'card-player/demo-assets/test-tone-a.mp3').then((r) => r.blob());
        const image = await fetch(prefix + 'assets/covers/moon.png').then((r) => r.blob());
        const src = await blobData(audio),
            cover = await blobData(image);
        window.payload = {
            version: 1,
            runtimeVersion: '1.13.0',
            config: {
                id: 'quality',
                title: 'Quality',
                tracks: [{ id: 'one', title: 'test', src, cover, lyrics: '[00:01]test' }],
                appearance: {},
                volume: 0.1,
            },
            ui: {},
            playlist: { id: 'list', name: 'list' },
            assets: {
                'assets/covers/forest.png': cover,
                'assets/covers/moon.png': cover,
                'assets/covers/sunroom.png': cover,
            },
        };
        window.role = 'A';
        window.hooks = new EventTarget();
        window.players = [];
        window.mount = (script = 'script-A') => {
            const subscribe = (name) => (callback) => {
                hooks.addEventListener(name, callback);
                return () => hooks.removeEventListener(name, callback);
            };
            const scope = {
                hostDocument: document,
                hostWindow: window,
                roleId: role,
                scriptId: script,
                currentRole: () => role,
                onRoleChange: subscribe('role'),
                onScriptExit: subscribe('exit'),
                onHostExit: subscribe('host'),
                onFrameRemoved: subscribe('frame'),
                ...window.extraScope,
            };
            const api = mountNativePlayer(payload, scope);
            players.push(api);
            return api;
        };
        window.mount();
    }, prefix);
}
test('leaving during embedded audio decode cancels pending work without late URLs, audio or duplicate roots',async({page})=>{
 await runtime(page);
 const result=await page.evaluate(async()=>{
  for(const p of players)p.dispose();const bytes=new Uint8Array(4*1024*1024);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));payload.config.tracks[0].src='data:audio/wav;base64,'+btoa(binary);
  const api=mount('pending-audio'),pending=api.resourceCounts.pendingDecodes;role='B';hooks.dispatchEvent(new Event('role'));await new Promise(r=>setTimeout(r,50));
  return {pending,disposed:api.disposed,counts:api.resourceCounts,roots:document.querySelectorAll('[data-riserein-card-player]').length,paused:api.audio.paused,src:api.audio.getAttribute('src')};
 });
 expect(result.pending).toBe(1);expect(result.disposed).toBe(true);expect(result.roots).toBe(0);expect(result.paused).toBe(true);expect(result.src).toBeNull();expect(Object.values(result.counts).every(n=>n===0)).toBe(true);
});
test('controlled Helper scope shares account protection across font/mount leases and blocks cross-realm URL saves after account changes',async({page})=>{
 await page.route('**/api/settings/save',r=>r.fulfill({status:418,body:'controlled fixture; never write host settings'}));
 await page.route('**/api/users/me',r=>r.fulfill({json:{handle:'scope-'+(r.request().headers()['x-test-account']||'a'),created:123}}));
 const result=await page.evaluate(async prefix=>{
  window.testAccount='a';window.testContext={characterId:0,accountStorage:{getItem:()=>null,setItem(){}},getRequestHeaders:()=>({'X-Test-Account':testAccount})};
  const frame=document.createElement('iframe');document.body.append(frame);const w=frame.contentWindow;
  Object.assign(w,{SillyTavern:{getContext:()=>testContext},getScriptId:()=> 'scope-script',getCurrentCharacterId:()=> 'scope.png',getScriptTrees:()=>[{id:'scope-script',type:'script',enabled:true}],eventOn(){},eventRemoveListener(){},tavern_events:{CHAT_CHANGED:'chat'}});
  const {createCharacterScope}=await w.eval(`import('${prefix}card-player/entry.js')`),scope=createCharacterScope();let exits=0,stopMain;
  const stopPending=scope.onHostExit(()=>{});stopMain=scope.onHostExit(()=>{exits++;stopMain();});const ready=await scope.preferences.setItem('lease-fixture','one');stopPending();testAccount='b';
  const response=await fetch(new URL('/api/settings/save',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});frame.remove();return {status:response.status,exits,ready};
 },prefix);
 expect(result).toEqual({status:409,exits:1,ready:true});
});
test('explicit legacy preference adoption waits for authorized storage before rebuilding the current player',async({page})=>{
 await runtime(page);page.on('dialog',d=>d.accept());
 await page.evaluate(async prefix=>{
  players[0].dispose();const {accountPreferences}=await import(prefix+'card-player/preferences.js'),state=new Map();window.allowPreferenceWrite=null;const gate=new Promise(resolve=>{allowPreferenceWrite=resolve;});
  window.extraScope={preferences:accountPreferences({accountStorage:{getItem:key=>state.get(key)||null,setItem:(key,value)=>state.set(key,value)}},()=>gate)};
  localStorage.setItem('riserein:card-native:v2:A:script-A:quality',JSON.stringify({volume:.27}));mount();
 },prefix);
 await page.getByRole('tab',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'确认归属并复制此角色的旧播放器偏好'}).click();
 expect(await page.locator('audio').evaluate(a=>a.volume)).toBe(.1);await page.evaluate(()=>allowPreferenceWrite());await expect.poll(()=>page.locator('audio').evaluate(a=>a.volume)).toBe(.27);await expect(page.locator('[data-riserein-card-player]')).toHaveCount(1);
 await page.evaluate(()=>document.querySelector('[data-riserein-card-player]').__risereinPlayer.dispose());
});
test('a queued focus scroll keeps the menu aligned while a later user wheel closes it',async({page})=>{
 const result=await page.evaluate(async prefix=>{
  const {createSelectMenus}=await import(prefix+'select-menu.js');const panel=document.createElement('section');panel.style.cssText='position:fixed;left:10px;top:10px;width:400px;height:300px';panel.innerHTML='<div id="scrollport" style="height:200px;overflow:auto"><div style="height:600px;padding-top:80px"><select id="scroll-select"><option value="a">A</option><option value="b">B</option></select></div></div>';document.body.append(panel);const menus=createSelectMenus(panel),scroller=panel.querySelector('#scrollport');scroller.scrollTop=30;panel.querySelector('#scroll-select-trigger').click();scroller.dispatchEvent(new Event('scroll'));const preserved=!panel.querySelector('#scroll-select-menu').hidden;scroller.scrollTop=60;scroller.dispatchEvent(new Event('scroll'));const realigned=!panel.querySelector('#scroll-select-menu').hidden;scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:20,bubbles:true}));const closed=panel.querySelector('#scroll-select-menu').hidden;menus.dispose();panel.remove();return {preserved,realigned,closed};
 },prefix);expect(result).toEqual({preserved:true,realigned:true,closed:true});
});
test('rapid roles, duplicate starts, same-role events, script exit and full-plugin handoff release resources and audio', async ({
    page,
}) => {
    await runtime(page);
    await page.locator('[data-action=play]').click();
    await expect
        .poll(() => page.locator('audio').evaluate((audio) => audio.currentTime))
        .toBeGreaterThan(0.1);
    const result = await page.evaluate(async (prefix) => {
        const first = players[0],
            audio = first.audio;
        const duplicate = mount();
        for (let i = 0; i < 10; i++) hooks.dispatchEvent(new Event('role'));
        const stable = first === duplicate && first.audio === audio && !audio.paused;
        role = 'B';
        hooks.dispatchEvent(new Event('role'));
        const stopped = audio.paused && !audio.getAttribute('src');
        const clean = () => Object.values(players.at(-1).resourceCounts).every((value) => value === 0);
        let cleaned = clean();
        for (let i = 0; i < 12; i++) {
            role = i % 2 ? 'A' : 'B';
            mount();
            hooks.dispatchEvent(new Event('exit'));
            cleaned &&= clean();
        }
        role = 'A';
        mount('another-script');
        hooks.dispatchEvent(new Event('exit'));
        cleaned &&= clean();
        mount();
        const { initialize } = await import(prefix + 'index.js');
        // Module initialization fails closed without ST context; its exported initialize is tested below with a supplied context.
        const full = initialize({
            context: {
                extensionSettings: {},
                characters: [],
                saveSettingsDebounced() {},
            },
            store: { get: async () => null },
        });
        const coexist = !document.querySelector('[data-riserein-card-player]') && players.at(-1).disposed;
        full.dispose();
        full.panel.remove();
        full.launcher.remove();
        return { stable, stopped, cleaned, coexist };
    }, prefix);
    expect(result).toEqual({
        stable: true,
        stopped: true,
        cleaned: true,
        coexist: true,
    });
});
test('malformed resources unwind early DOM and object URLs; a late FontFace load cannot reattach after exit', async ({
    page,
}) => {
    await runtime(page);
    const result = await page.evaluate(async () => {
        hooks.dispatchEvent(new Event('exit'));
        payload.config.tracks[0].cover = 'data:image/png;base64,A';
        let failed = false;
        try {
            mount();
        } catch {
            failed = true;
        }
        const noRoot = !document.querySelector('[data-riserein-card-player]');
        payload.config.tracks[0].cover = payload.assets['assets/covers/moon.png'];
        let resolveFont;
        const Original = window.FontFace;
        window.FontFace = class {
            load() {
                return new Promise((resolve) => {
                    resolveFont = resolve;
                });
            }
        };
        payload.fontFile = 'ChildFunSans.woff2';
        payload.config.appearance.font = 'data:application/octet-stream;base64,AAAA';
        payload.ui.fontPreset = 'child';
        const player = mount();
        hooks.dispatchEvent(new Event('exit'));
        // Real FontFaceSet rejects a fake face if a disposed callback incorrectly tries to add it.
        resolveFont({ family: 'unexpected-stale-face' });
        await new Promise((resolve) => setTimeout(resolve, 20));
        window.FontFace = Original;
        return {
            failed,
            noRoot,
            clean: Object.values(player.resourceCounts).every((value) => value === 0),
            fonts: document.fonts.size,
        };
    });
    expect(result).toEqual({ failed: true, noRoot: true, clean: true, fonts: 0 });
});
test('disposing a scoped request after headers aborts its unfinished response body and observer reuse is cleaned', async ({
    page,
}) => {
    expect(
        await page.evaluate(async (prefix) => {
            const { sharedEnvironment } = await import(prefix + 'card-player/shared-environment.js');
            const root = document.createElement('div');
            document.body.append(root);
            const originalFetch = window.fetch;
            let aborted = false;
            window.fetch = async (_, options) =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            options.signal.addEventListener('abort', () => {
                                aborted = true;
                                controller.error(new DOMException('aborted', 'AbortError'));
                            });
                            controller.enqueue(new Uint8Array([1]));
                        },
                    }),
                );
            const own = sharedEnvironment(root, {}, window);
            const observer = new own.environment.MutationObserver(() => {});
            observer.observe(root, { childList: true });
            observer.disconnect();
            observer.observe(root, { childList: true });
            const response = await own.environment.fetch('/slow-body');
            const reading = response.arrayBuffer().then(
                () => false,
                (error) => ({ name: error.name, message: error.message }),
            );
            own.environment.globalThis.setInterval(() => {}, 1000);
            own.dispose();
            const error = await reading;
            window.fetch = originalFetch;
            console.log(JSON.stringify(error));
            const rejected = !!error;
            return {
                aborted,
                rejected,
                clean: Object.values(own.resourceCounts).every((value) => value === 0),
            };
        }, prefix),
    ).toEqual({ aborted: true, rejected: true, clean: true });
});
test('concurrent font decoding starts share one pending task, exit cancels it and scripts isolate persisted preferences', async ({
    page,
}) => {
    await runtime(page);
    const result = await page.evaluate(async (prefix) => {
        hooks.dispatchEvent(new Event('exit'));
        const { startNativeInScope } = await import(prefix + 'card-player/native-entry.js');
        const { blobData } = await import(prefix + 'card-player/export.js');
        const bytes = new Uint8Array(5 * 1024 * 1024);
        const archive = await new Response(
            new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
        ).blob();
        const packed = {
            ...payload,
            fontFile: 'ChildFunSans.woff2',
            fontEncoding: 'gzip',
            fontOriginalBytes: bytes.length,
            config: {
                ...payload.config,
                appearance: {
                    font: await blobData(archive, 'application/octet-stream'),
                },
            },
        };
        let role = 'A';
        const subscribe = (type) => (callback) => {
            hooks.addEventListener(type, callback);
            return () => hooks.removeEventListener(type, callback);
        };
        const scope = (scriptId) => ({
            hostDocument: document,
            hostWindow: window,
            roleId: 'A',
            scriptId,
            currentRole: () => role,
            onRoleChange: subscribe('role'),
            onScriptExit: subscribe('exit'),
            onFrameRemoved: subscribe('frame'),
            onHostExit: subscribe('host'),
        });
        const first = startNativeInScope(packed, scope('gzip'));
        const second = startNativeInScope(packed, scope('gzip'));
        role = 'B';
        hooks.dispatchEvent(new Event('role'));
        const aborted =
            (await first) === null &&
            (await second) === null &&
            !document.querySelector('[data-riserein-card-player]') &&
            __risereinCardPending.size === 0;
        window.role = 'A';
        const a = mount('one-script');
        a.audio.volume = 0.17;
        const slider = document.querySelector('#stm-volume');
        slider.value = '17';
        slider.dispatchEvent(new Event('input'));
        hooks.dispatchEvent(new Event('exit'));
        const b = mount('other-script');
        const otherVolume = b.audio.volume;
        hooks.dispatchEvent(new Event('exit'));
        const restored = mount('one-script');
        const savedVolume = restored.audio.volume;
        hooks.dispatchEvent(new Event('exit'));
        return { aborted, otherVolume, savedVolume };
    }, prefix);
    expect(result).toEqual({
        aborted: true,
        otherVolume: 0.1,
        savedVolume: 0.17,
    });
});
test('maker reads embedded MP3 lyrics and confirmed search results travel into exported script without recipient lookup', async ({
    page,
}) => {
    await maker(page);
    const frame = (id, text) => {
        const data = Buffer.from(text);
        const header = Buffer.alloc(10);
        header.write(id);
        header.writeUInt32BE(data.length, 4);
        return Buffer.concat([header, data]);
    };
    const frames = Buffer.concat([
        frame('TIT2', '\x03Metadata Song'),
        frame('TPE1', '\x03Fixture Artist'),
        frame('USLT', '\x03eng\0[00:01]Embedded fixture lyric'),
    ]);
    const header = Buffer.from([
        73,
        68,
        51,
        3,
        0,
        0,
        (frames.length >> 21) & 127,
        (frames.length >> 14) & 127,
        (frames.length >> 7) & 127,
        frames.length & 127,
    ]);
    await page.locator('[data-maker-file=audio]').setInputFiles({
        name: 'opaque-file.mp3',
        mimeType: 'audio/mpeg',
        buffer: Buffer.concat([header, frames, tone]),
    });
    await expect(page.getByLabel('第1首歌名', { exact: true })).toHaveValue('Metadata Song');
    await expect(page.getByLabel('第1首歌手', { exact: true })).toHaveValue('Fixture Artist');
    await expect(page.getByLabel('第1首歌词', { exact: true })).toHaveValue('[00:01]Embedded fixture lyric');
    await page.route('https://lrclib.net/api/search?**', (route) =>
        route.fulfill({
            json: [
                {
                    id: 42,
                    trackName: 'Metadata Song',
                    artistName: 'Fixture Artist',
                    syncedLyrics: '[00:01]Confirmed fixture lyric',
                },
            ],
            headers: { 'Access-Control-Allow-Origin': '*' },
        }),
    );
    await page.locator('.stm-maker-tracks summary').click();
    await page.locator('.stm-maker-tracks').getByRole('button', { name: '查找歌词', exact: true }).click();
    await page
        .locator('[data-maker=lyrics-lookup]')
        .getByRole('button', { name: '搜索歌词', exact: true })
        .click();
    await expect(page.locator('[data-lyrics=status]')).toContainText('找到 1 份');
    await expect(page.getByLabel('第1首歌词', { exact: true })).toHaveValue('[00:01]Embedded fixture lyric');
    await page.locator('[data-lyrics=results] button').click();
    await page.getByRole('button', { name: '确认使用这份歌词', exact: true }).click();
    await expect(page.getByLabel('第1首歌词', { exact: true })).toHaveValue('[00:01]Confirmed fixture lyric');
    await page.locator('[data-maker=prepare]').click();
    await expect(page.locator('.stm-maker-downloads')).toBeVisible({
        timeout: 30000,
    });
    const download = page.waitForEvent('download');
    await page.locator('[data-maker=script-json]').click();
    const file = JSON.parse((await readFile(await (await download).path())).toString());
    expect(file.content).toContain('Confirmed fixture lyric');
    expect(file.content).toContain('https://lrclib.net/api/get/42');
});
test('simulated storage failure retains the old draft and restores unsaved edits within the current page', async ({
    page,
}) => {
    await maker(page);
    await page.locator('#stm-maker-title').fill('Saved previous');
    await page.evaluate(() => maker.flush());
    await page.evaluate(async (prefix) => {
        const { CardProjectStore } = await import(prefix + 'card-player/project-store.js');
        window.originalDraftSave = CardProjectStore.prototype.save;
        CardProjectStore.prototype.save = function (...args) {
            if (window.failDraftSave)
                return Promise.reject(new DOMException('Fixture quota exhausted', 'QuotaExceededError'));
            return originalDraftSave.apply(this, args);
        };
        window.failDraftSave = true;
    }, prefix);
    await page.locator('#stm-maker-title').fill('Unsaved recovery');
    await page.evaluate(async () => {
        await maker.flush().catch(() => {});
        maker.close();
        maker.open();
    });
    await expect(page.locator('[data-maker=draft-status]')).toContainText('上次草稿未保存');
    await expect(page.locator('#stm-maker-title')).toHaveValue('Unsaved recovery');
    const old = await page.evaluate(async (prefix) => {
        const { CardProjectStore } = await import(prefix + 'card-player/project-store.js');
        const store = new CardProjectStore();
        const rows = await store.list();
        await store.dispose();
        return rows[0].title;
    }, prefix);
    expect(old).toBe('Saved previous');
    await page.evaluate(async () => {
        failDraftSave = false;
        await maker.flush();
    });
    await expect(page.locator('[data-maker=draft-status]')).toContainText('草稿已保存');
});
test('draft audio, cover and background remain usable after their original library files are removed', async ({
    page,
}) => {
    await maker(page);
    await page.evaluate(async (prefix) => {
        const audio = await fetch(prefix + 'card-player/demo-assets/test-tone-a.mp3').then((response) =>
            response.blob(),
        );
        const { prepareCover } = await import(prefix + 'media.js');
        const image = await prepareCover(
            await fetch(prefix + 'assets/covers/moon.png').then((response) => response.blob()),
        );
        const id = 'library-audio',
            coverId = 'cover:00000000-0000-4000-8000-000000000001';
        fixtureStore.set(id, audio);
        fixtureStore.set(coverId, image);
        fixtureStore.set('background:fixture', image);
        fixtureSettings.tracks.push({ id, kind: 'local', title: 'Independent bytes', coverId });
        fixtureSettings.backgroundId = 'background:fixture';
    }, prefix);
    await page.locator('[data-maker=project-new]').click();
    await expect(page.getByLabel('第1首歌名', { exact: true })).toHaveValue('Independent bytes');
    await page.locator('[data-maker=background]').check();
    await page.evaluate(() => maker.flush());
    await page.evaluate(async () => {
        fixtureStore.clear();
        maker.close();
        maker.open();
    });
    await expect(page.locator('[data-maker=draft-status]')).toContainText('已恢复草稿');
    await page.locator('[data-maker=analyze]').click();
    await expect(page.locator('.stm-maker-status')).toContainText('容量分析完成');
    await expect(page.locator('[data-maker=analysis]')).toContainText('背景');
});
test('leaving during image decoding closes the late bitmap and never restores the cropper or its resources', async ({
    page,
}) => {
    await runtime(page);
    await page.evaluate(() => {
        window.__originalBitmap = window.createImageBitmap;
        window.__closedBitmaps = 0;
        window.createImageBitmap = () =>
            new Promise((resolve) => {
                window.__lateBitmap = () =>
                    resolve({
                        width: 100,
                        height: 100,
                        close() {
                            __closedBitmaps++;
                        },
                    });
            });
    });
    await page
        .locator('[data-role=background-file]')
        .setInputFiles({
            name: 'background.png',
            mimeType: 'image/png',
            buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        });
    await page.waitForFunction(() => typeof __lateBitmap === 'function');
    const result = await page.evaluate(async () => {
        const api = players.at(-1);
        hooks.dispatchEvent(new Event('exit'));
        __lateBitmap();
        await new Promise((resolve) => setTimeout(resolve, 20));
        window.createImageBitmap = __originalBitmap;
        return {
            closed: __closedBitmaps,
            detached: !document.querySelector('[data-riserein-card-player]'),
            clean: Object.values(api.resourceCounts).every((value) => value === 0),
        };
    });
    expect(result).toEqual({ closed: 1, detached: true, clean: true });
});
test('independent maker runtime isolates scripts, replaces old audio and defers to the full plugin', async ({
    page,
}) => {
    await runtime(page);
    const result = await page.evaluate(async (prefix) => {
        hooks.dispatchEvent(new Event('exit'));
        const { mountCardPlayer } = await import(prefix + 'card-player/runtime.js');
        const subscribe = (type) => (callback) => {
            hooks.addEventListener(type, callback);
            return () => hooks.removeEventListener(type, callback);
        };
        const start = (scriptId) =>
            mountCardPlayer(payload.config, {
                hostDocument: document,
                hostWindow: window,
                roleId: 'A',
                scriptId,
                currentRole: () => 'A',
                onRoleChange: subscribe('role'),
                onScriptExit: subscribe('exit'),
                onHostExit: subscribe('host'),
                onFrameRemoved: subscribe('frame'),
            });
        const a = start('maker-one');
        const reused = start('maker-one') === a;
        const slider = a.root.shadowRoot.querySelector('.volume input');
        slider.value = '17';
        slider.dispatchEvent(new Event('input'));
        const b = start('maker-two');
        const isolated =
            b !== a && a.disposed && a.audio.paused && !a.audio.getAttribute('src') && b.audio.volume === 0.1;
        const restored = start('maker-one');
        const retained = restored.audio.volume === 0.17;
        restored.dispose();
        window.__risereinFullMusicPlayer = true;
        const suppressed =
            start('maker-three') === null &&
            document.querySelectorAll('[data-riserein-card-player]').length === 0;
        delete window.__risereinFullMusicPlayer;
        return { reused, isolated, retained, suppressed };
    }, prefix);
    expect(result).toEqual({ reused: true, isolated: true, retained: true, suppressed: true });
});
test.afterEach(async ({}, info) => {
    results.push({
        name: info.title,
        status: info.status,
        milliseconds: info.duration,
    });
    await writeFile(
        process.env.ST_QUALITY_REPORT || 'docs/card-player/quality-browser-validation.json',
        JSON.stringify(
            {
                environment:
                    'Chromium controlled browser fixture, NOT Tavern Helper or physical phone acceptance',
                results,
            },
            null,
            2,
        ) + '\n',
    );
});
