import { PLAYER_BUILD } from './quality.js';
import { createCharacterScope } from './entry.js';
import { watchRoleLifetime } from './lifecycle.js';
import { normalizeCardConfig } from './config.js';
import { createTrackId } from '../core.js';
import { sharedEnvironment } from './shared-environment.js';
import { mountSharedPlayer, SHARED_CSS } from './dist/shared-ui.js';
import { unpackFont } from './font-transport.js';
import { FONT_PRESETS } from '../fonts.js';
import { base64Bytes } from '../base64.js';
import { rolePreferences } from './preferences.js';
import { createEmbeddedStore } from './embedded-store.js';
import { normalizeDesign } from '../ui/config.js';

function dataBlob(value, win) {
    const comma = value.indexOf(',');
    return new win.Blob([base64Bytes(value.slice(comma + 1))], {
        type: value.slice(5, value.indexOf(';')),
    });
}
export function mountNativePlayer(payload, scope, options = {}) {
    const config = normalizeCardConfig(payload.config),
        win = scope.hostWindow,
        doc = scope.hostDocument;
    // Authors keep their already running full plugin; their card carries the recipient runtime.
    if (win.__risereinFullMusicPlayer || doc.querySelector('#stm-player:not([data-portable])')) return null;
    const existing = doc.querySelector('[data-riserein-card-player]');
    if (
        existing?.__risereinPlayer?.roleId === scope.roleId &&
        existing.__risereinPlayer.scriptId === scope.scriptId
    )
        return existing.__risereinPlayer;
    existing?.__risereinPlayer?.dispose();
    const root = doc.createElement('div');
    root.dataset.risereinCardPlayer = config.id;
    const style = doc.createElement('style');
    style.textContent = SHARED_CSS;
    root.append(style);
    doc.body.append(root);
    const assets = { ...payload.assets };
    const own = sharedEnvironment(root, assets, win),
        embedded = createEmbeddedStore(win);
    let disposed = false;
    try {
        if (payload.fontFile && config.appearance.font)
            assets[`assets/fonts/${payload.fontFile}`] = options.fontBlob
                ? own.environment.URL.createObjectURL(options.fontBlob)
                : config.appearance.font;
        const namespace = `riserein:card-native:v2:${encodeURIComponent(scope.roleId)}:${encodeURIComponent(scope.scriptId)}:${encodeURIComponent(config.id)}`;
        const store = embedded.store;
        const tracks = config.tracks.map((track) => {
            const coverId = `cover:${createTrackId(win.crypto)}`;
            embedded.setBlob(coverId, dataBlob(track.cover, win));
            const result = {
                id: track.id,
                title: track.title,
                artist: track.artist,
                lyrics: track.lyrics,
                lyricsSource: track.lyricsSource,
                coverId,
            };
            if (track.src.startsWith('data:')) {
                embedded.setData(track.id,track.src);
                return { ...result, kind: 'local' };
            }
            return { ...result, kind: 'url', url: track.src };
        });
        const avatar = scope.roleId,
            playlist = {
                ...payload.playlist,
                trackIds: tracks.map((track) => track.id),
                characterAvatars: [avatar],
            };
        if (playlist.cover) {
            playlist.coverId = `cover:${createTrackId(win.crypto)}`;
            embedded.setBlob(playlist.coverId, dataBlob(playlist.cover, win));
            delete playlist.cover;
        }
        const settings = {
            ...payload.ui,
            tracks,
            playlists: [playlist],
            activePlaylistId: playlist.id,
            currentId: tracks[0].id,
            mode: config.mode,
            volume: config.volume,
            builtinHidden: true,
        };
        if (config.appearance.image) {
            settings.backgroundId = `background:${createTrackId(win.crypto)}`;
            embedded.setBlob(settings.backgroundId, dataBlob(config.appearance.image, win));
        }
        if(config.appearance.launcherIcon){const id='cover:'+createTrackId(win.crypto);embedded.setBlob(id,dataBlob(config.appearance.launcherIcon,win));settings.uiDesign=normalizeDesign(settings.uiDesign);settings.uiDesign.customization.iconId=id;}
        const allowedState = [
            'volume',
            'mode',
            'currentId',
            'recentPlays',
            'playEvents',
            'favorites',
            'transitionDuration',
            'visualMotion',
            'accessibleControls',
            'personalDesign',
            'theme',
            'colorScheme',
            'surface',
            'customColors',
            'maskOpacity',
            'clickEffects',
            'positions',
            'panelSize',
        ];
        const preferences=rolePreferences(scope,namespace,`riserein:card-native:v1:${encodeURIComponent(scope.roleId)}:${encodeURIComponent(config.id)}`);
        try {
            const saved = preferences.read();
            for (const key of allowedState) if (Object.hasOwn(saved, key)) settings[key] = saved[key];
            if(settings.personalDesign){settings.personalDesign=normalizeDesign(settings.personalDesign);settings.personalDesign.customization.iconId=settings.uiDesign?.customization?.iconId||null;if(settings.personalDesign.launcher==='custom'&&!settings.personalDesign.customization.iconId)settings.personalDesign.launcher=settings.uiDesign?.launcher||'vinyl';}
        } catch {
            /* Browser may block local storage; the player still works. */
        }
        let warnedPreferences = false;
        const context = {
            extensionSettings: { riserein_music_player: settings },
            characters: [{ avatar, name: config.title }],
            characterId: 0,
            saveSettingsDebounced() {
                const state = context.extensionSettings.riserein_music_player;
                try {
                    void preferences.write(Object.fromEntries(allowedState.map((key) => [key, state[key]]))).then(saved => {
                        if (!disposed && (!saved || preferences.sessionOnly) && !warnedPreferences) {
                            warnedPreferences = true;
                            win.toastr?.warning('当前环境无法持久保存个人偏好，收藏等设置仅在本次会话有效。');
                        }
                    });
                } catch {
                    /* Optional preferences. */
                }
            },
        };
        let mounted, lifetime;
        const api = {
            runtimeVersion: payload.runtimeVersion || PLAYER_BUILD,
            roleId: scope.roleId,
            scriptId: scope.scriptId,
            root,
            get audio() {
                return mounted?.audio;
            },
            get disposed() {
                return disposed;
            },
            get resourceCounts() {
                return {
                    ...own.resourceCounts,
                    subscriptions: lifetime?.subscriptions || 0,
                    ...embedded.resourceCounts,
                };
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                lifetime?.dispose();
                try {
                    mounted?.dispose();
                } finally {
                    for (const audio of root.querySelectorAll('audio')) {
                        audio.pause();
                        audio.removeAttribute('src');
                        audio.load();
                    }
                    own.dispose();
                    embedded.dispose();
                    root.remove();
                }
            },
        };
        root.__risereinPlayer = api;
        try {
            mounted = mountSharedPlayer(own.environment, {
                context,
                store,
                availableFonts: payload.fontFile ? [payload.fontFile] : [],
                getInputElement:()=>doc.querySelector('#send_form'),
            });
            mounted.panel.dataset.portable = 'true';
            mounted.panel.dataset.runtimeVersion = api.runtimeVersion;
            const version = doc.createElement('p');
            version.className = 'stm-hint';
            version.textContent = `随卡播放器 v${api.runtimeVersion} · 更新请由制作端重建并重新导出角色卡`;
            mounted.panel.querySelector('[data-view=appearance]').append(version);
            if(preferences.legacy){
                const adopt=doc.createElement('button');adopt.className='stm-secondary';adopt.textContent='确认归属并复制此角色的旧播放器偏好';
                adopt.addEventListener('click',async()=>{
                    if(disposed||!win.confirm('确认这份旧设备偏好属于当前账号？只复制音量、外观等设置，原记录保留。'))return;
                    try{const saved=JSON.parse(preferences.legacy),written=await preferences.write(Object.fromEntries(allowedState.filter(key=>Object.hasOwn(saved,key)).map(key=>[key,saved[key]])));if(disposed)return;if(!written){win.toastr?.warning('账号尚未确认，旧偏好已保留，请稍后再试。');return;}api.dispose();if(scope.currentRole()===scope.roleId)mountNativePlayer(payload,scope,options);}
                    catch{win.toastr?.warning('旧偏好无法读取，原记录已保留。');}
                });mounted.panel.querySelector('[data-view=appearance]').append(adopt);
            }
            const preset = FONT_PRESETS[settings.fontPreset] || FONT_PRESETS.inherit;
            const family = payload.fontFile && config.appearance.font ? `"stm-${settings.fontPreset}", ${config.appearance.fontFamily || 'serif'}` : preset.family;
            for (const element of [mounted.panel, mounted.launcher])
                element.style.setProperty('--stm-font-family', family);
            if (payload.fontFile && config.appearance.font) {
                const face = new win.FontFace(
                    `stm-${settings.fontPreset}`,
                    `url("${assets[`assets/fonts/${payload.fontFile}`]}")`,
                    { display: 'swap' },
                );
                void face
                    .load()
                    .then(() => {
                        if (!disposed) own.environment.document.fonts.add(face);
                    })
                    .catch(() => {
                        if (!disposed) win.toastr?.warning('随卡字体未能加载，暂用设备字体；音乐仍可播放。');
                    });
            }
            if (config.appearance.fontLicense) {
                const license = doc.createElement('details'),
                    title = doc.createElement('summary'),
                    text = doc.createElement('pre');
                title.textContent = '随卡字体许可';
                text.textContent = config.appearance.fontLicense;
                text.style.cssText = 'white-space:pre-wrap;font:10px/1.5 system-ui';
                license.append(title, text);
                mounted.panel.querySelector('[data-view="appearance"]').append(license);
            }
            lifetime = watchRoleLifetime(scope, () => api.dispose());
            if (!disposed) mounted.setOpen(!config.startCollapsed);
            return api;
        } catch (error) {
            api.dispose();
            throw error;
        }
    } catch (error) {
        // Resource decoding and font URL creation may fail before the shared UI exists.
        own.dispose();
        embedded.dispose();
        root.remove();
        throw error;
    }
}
export function startNativeCharacterPlayer(payload) {
    return startNativeInScope(payload, createCharacterScope());
}
export async function startNativeInScope(payload, scope) {
    if (scope.hostWindow.__risereinFullMusicPlayer) return null;
    const existing = scope.hostDocument.querySelector('[data-riserein-card-player]')?.__risereinPlayer;
    if (existing?.roleId === scope.roleId && existing.scriptId === scope.scriptId) return existing;
    if (payload.fontEncoding !== 'gzip') return mountNativePlayer(payload, scope);
    const win = scope.hostWindow;
    const registry = (win.__risereinCardPending ||= new Map());
    const key = `${scope.roleId}\0${scope.scriptId}`;
    if (registry.has(key)) return registry.get(key).promise;
    for (const [other, task] of registry)
        if (other !== key) {
            task.abort();
            registry.delete(other);
        }
    const controller = new win.AbortController();
    const pending = watchRoleLifetime(scope, () => controller.abort());
    const onFullPlayer = () => {controller.abort();pending.dispose();};
    win.addEventListener('riserein:full-player-start', onFullPlayer, {
        once: true,
    });
    const task = { abort: () => {controller.abort();pending.dispose();} };
    task.promise = (async () => {
        let fontBlob;
        try {
            fontBlob = await unpackFont(
                dataBlob(payload.config.appearance.font, win),
                payload.fontOriginalBytes,
                controller.signal,
            );
        } catch (error) {
            if (controller.signal.aborted) return null;
            payload = {
                ...payload,
                fontFile: '',
                ui: { ...payload.ui, fontPreset: 'inherit' },
            };
            win.toastr?.warning(`随卡字体未能加载，已使用设备字体；音乐仍可播放。${error.message}`);
        }
        if (controller.signal.aborted || win.__risereinFullMusicPlayer) return null;
        return mountNativePlayer(payload, scope, { fontBlob });
    })().finally(() => {
        pending.dispose();
        win.removeEventListener('riserein:full-player-start', onFullPlayer);
        if (registry.get(key) === task) registry.delete(key);
    });
    registry.set(key, task);
    return task.promise;
}

/** Independent HTML preview only; does not claim Tavern Helper lifecycle success. */
export function startNativePreview(payload){
 const noop=()=>()=>{};const api=mountNativePlayer(payload,{hostDocument:document,hostWindow:window,roleId:'preview',scriptId:payload.config.id,currentRole:()=> 'preview',onRoleChange:noop,onScriptExit:noop,onFrameRemoved:noop,onHostExit(handler){window.addEventListener('pagehide',handler);return()=>window.removeEventListener('pagehide',handler);}});
 return api;
}
