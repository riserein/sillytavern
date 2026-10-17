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
        blobs = new Map();
    let disposed = false;
    try {
        if (payload.fontFile && config.appearance.font)
            assets[`assets/fonts/${payload.fontFile}`] = options.fontBlob
                ? own.environment.URL.createObjectURL(options.fontBlob)
                : config.appearance.font;
        const namespace = `riserein:card-native:v2:${encodeURIComponent(scope.roleId)}:${encodeURIComponent(scope.scriptId)}:${encodeURIComponent(config.id)}`;
        const store = {
            get: async (id) => disposed ? undefined : blobs.get(id),
            put: async (id, blob) => { if (disposed) throw new DOMException('播放器已关闭', 'AbortError'); blobs.set(id, blob); },
            delete: async (id) => blobs.delete(id),
            deleteMany: async (ids) => {
                for (const id of ids) blobs.delete(id);
            },
        };
        const tracks = config.tracks.map((track) => {
            const coverId = `cover:${createTrackId(win.crypto)}`;
            blobs.set(coverId, dataBlob(track.cover, win));
            const result = {
                id: track.id,
                title: track.title,
                artist: track.artist,
                lyrics: track.lyrics,
                lyricsSource: track.lyricsSource,
                coverId,
            };
            if (track.src.startsWith('data:')) {
                blobs.set(track.id, dataBlob(track.src, win));
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
            blobs.set(playlist.coverId, dataBlob(playlist.cover, win));
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
            blobs.set(settings.backgroundId, dataBlob(config.appearance.image, win));
        }
        const allowedState = [
            'volume',
            'mode',
            'currentId',
            'recentPlays',
            'playEvents',
            'theme',
            'colorScheme',
            'surface',
            'customColors',
            'maskOpacity',
            'clickEffects',
            'positions',
            'panelSize',
        ];
        try {
            const legacyNamespace = `riserein:card-native:v1:${encodeURIComponent(scope.roleId)}:${encodeURIComponent(config.id)}`;
            const current = win.localStorage.getItem(namespace);
            const legacy = current ? null : win.localStorage.getItem(legacyNamespace);
            const saved = JSON.parse(current || legacy || '{}');
            if (!current && legacy) win.localStorage.setItem(namespace, JSON.stringify(saved));
            for (const key of allowedState) if (Object.hasOwn(saved, key)) settings[key] = saved[key];
        } catch {
            /* Browser may block local storage; the player still works. */
        }
        const context = {
            extensionSettings: { riserein_music_player: settings },
            characters: [{ avatar, name: config.title }],
            characterId: 0,
            saveSettingsDebounced() {
                const state = context.extensionSettings.riserein_music_player;
                try {
                    win.localStorage.setItem(
                        namespace,
                        JSON.stringify(Object.fromEntries(allowedState.map((key) => [key, state[key]]))),
                    );
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
                    blobs: blobs.size,
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
                    blobs.clear();
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
            });
            mounted.panel.dataset.portable = 'true';
            mounted.panel.dataset.runtimeVersion = api.runtimeVersion;
            const version = doc.createElement('p');
            version.className = 'stm-hint';
            version.textContent = `随卡播放器 v${api.runtimeVersion} · 更新请由制作端重建并重新导出角色卡`;
            mounted.panel.querySelector('[data-view=appearance]').append(version);
            const preset = FONT_PRESETS[settings.fontPreset] || FONT_PRESETS.inherit;
            const family = preset.family;
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
        blobs.clear();
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
    const onFullPlayer = () => controller.abort();
    win.addEventListener('riserein:full-player-start', onFullPlayer, {
        once: true,
    });
    const task = { abort: () => controller.abort() };
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
