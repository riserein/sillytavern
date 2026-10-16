import { createCharacterScope } from './entry.js';
import { watchRoleLifetime } from './lifecycle.js';
import { normalizeCardConfig } from './config.js';
import { createTrackId } from '../core.js';
import { sharedEnvironment } from './shared-environment.js';
import { mountSharedPlayer, SHARED_CSS } from './dist/shared-ui.js';
import { unpackFont } from './font-transport.js';
import { FONT_PRESETS } from '../fonts.js';

function dataBlob(value, win) {
    const comma = value.indexOf(','),
        bytes = win.atob(value.slice(comma + 1));
    return new win.Blob([Uint8Array.from(bytes, (char) => char.charCodeAt(0))], {
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
    if (payload.fontFile && config.appearance.font)
        assets[`assets/fonts/${payload.fontFile}`] = options.fontBlob
            ? own.environment.URL.createObjectURL(options.fontBlob)
            : config.appearance.font;
    const namespace = `riserein:card-native:v1:${encodeURIComponent(scope.roleId)}:${encodeURIComponent(config.id)}`;
    const store = {
        get: async (id) => blobs.get(id),
        put: async (id, blob) => blobs.set(id, blob),
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
        const saved = JSON.parse(win.localStorage.getItem(namespace) || '{}');
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
    let mounted,
        lifetime,
        disposed = false;
    const api = {
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
        mounted.setOpen(!config.startCollapsed);
        return api;
    } catch (error) {
        api.dispose();
        throw error;
    }
}
export async function startNativeCharacterPlayer(payload) {
    const scope = createCharacterScope();
    if (scope.hostWindow.__risereinFullMusicPlayer) return null;
    const existing = scope.hostDocument.querySelector('[data-riserein-card-player]')?.__risereinPlayer;
    if (existing?.roleId === scope.roleId && existing.scriptId === scope.scriptId) return existing;
    if (payload.fontEncoding !== 'gzip') return mountNativePlayer(payload, scope);
    const controller = new scope.hostWindow.AbortController();
    const pending = watchRoleLifetime(scope, () => controller.abort());
    try {
        const blob = await unpackFont(
            dataBlob(payload.config.appearance.font, scope.hostWindow),
            payload.fontOriginalBytes,
            controller.signal,
        );
        controller.signal.throwIfAborted();
        return mountNativePlayer(payload, scope, { fontBlob: blob });
    } catch (error) {
        if (controller.signal.aborted) return null;
        // Font support must not prevent listening to the card's music.
        const fallback = { ...payload, fontFile: '', ui: { ...payload.ui, fontPreset: 'inherit' } };
        const player = mountNativePlayer(fallback, scope);
        scope.hostWindow.toastr?.warning(`随卡字体未能加载，已使用设备字体；音乐仍可播放。${error.message}`);
        return player;
    } finally {
        pending.dispose();
    }
}
