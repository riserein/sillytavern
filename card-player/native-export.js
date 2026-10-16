import { getQueue, playlistForCharacter, createTrackId } from '../core.js';
import { FONT_PRESETS } from '../fonts.js';
import { fallbackCoverUrl, prepareCover } from '../media.js';
import { prepareCardPackage, attachPlayerToCard, blobData } from './export.js';
import { jsonForScript, publicResource } from './config.js';
import { fetchBlob, probeAudio } from './browser-resources.js';
import { packFont } from './font-transport.js';
import { MAX_PACKAGE_BYTES } from './config.js';
import { compactNativeResponse } from './png-size.js';

const LICENSES = {
    'PoxiaoPixel.woff2': ['OFL-PoxiaoPixel.txt'],
    'ChildFunSans.woff2': ['OFL-ChildFunSans.txt'],
};
const UI_KEYS = [
    'theme',
    'colorScheme',
    'surface',
    'customColors',
    'maskOpacity',
    'clickEffects',
    'fontPreset',
    'panelSize',
    'positions',
];
/** Same export_with semantics as the verified official Helper export hook. */
export function helperExportSettings(settings) {
    const copy = structuredClone(settings);
    const clear = (trees) => {
        for (const tree of trees || []) {
            if (tree.type === 'folder') clear(tree.scripts);
            else {
                if (tree.export_with?.data === false) tree.data = {};
                if (tree.export_with?.button === false && tree.button) tree.button.buttons = [];
            }
        }
    };
    clear(copy.scripts);
    return copy;
}
export function nativeCardScript(payload, runtime, scriptId) {
    if (!runtime.includes('startNativeCharacterPlayer'))
        throw new Error('随卡播放器文件不完整，请更新插件并刷新。');
    const script = {
        type: 'script',
        enabled: true,
        id: scriptId,
        name: `角色音乐 · ${payload.config.title}`,
        content: `/* Riserein shared-UI card player. MIT. */\n(()=>{\n${runtime}\nRisereinNativePlayer.startNativeCharacterPlayer(${jsonForScript(payload)});\n})();`,
        info: '由 Riserein 音乐播放器制作。原生 PNG/JSON 随卡播放器；共享完整版界面，无音乐导入功能。不依赖完整版插件，需要酒馆助手。',
        button: { enabled: false, buttons: [] },
        data: {},
        export_with: { data: true, button: true },
    };
    if (new TextEncoder().encode(JSON.stringify(script)).length > 45 * 1024 * 1024)
        throw new Error('随卡播放器超过 45 MB，请减少内嵌资源或改用稳定公开音频直链。');
    return script;
}

/** Author-only bridge. The normal ST server exports the resulting card in BOTH formats. */
export function createNativeCardExport({ settings, store, getContext, showStatus }) {
    const abort = new AbortController();
    let queue = Promise.resolve(),
        runtimePromise,
        cachedFont;
    const fixedImages = new Map(),
        licenses = new Map(),
        encoded = new WeakMap();
    const memo = (map, key, load) => {
        if (!map.has(key))
            map.set(
                key,
                Promise.resolve()
                    .then(load)
                    .catch((error) => {
                        map.delete(key);
                        throw error;
                    }),
            );
        return map.get(key);
    };
    const encodeBlob = (blob, mime = blob.type) => {
        if (!encoded.has(blob)) encoded.set(blob, new Map());
        return memo(encoded.get(blob), mime, () => blobData(blob, mime));
    };
    const enqueue = (action) => {
        const task = queue.catch(() => {}).then(action);
        queue = task;
        return task;
    };
    const asset = (path) => new URL(`../${path}`, import.meta.url);
    const read = (url) => fetchBlob(url, abort.signal);
    const fallback = (index) =>
        memo(fixedImages, index, () => read(fallbackCoverUrl(index)).then(prepareCover));
    async function packagePlaylist(playlist) {
        const preset = FONT_PRESETS[settings.fontPreset];
        let fontEncoding = '',
            fontOriginalBytes = 0;
        if (settings.fontPreset === 'custom')
            throw new Error('当前自定义字体没有随卡授权记录。请先选择内置字体或设备字体，再导出');
        const { config, embeddedBytes } = await prepareCardPackage(
            {
                id: `native:${playlist.id}`,
                title: playlist.name,
                tracks: getQueue(settings, playlist.id),
                appearance: {
                    imageId: settings.backgroundId,
                    fontFile: preset?.file,
                    fontName: preset?.name,
                    surface: settings.surface,
                    opacity: settings.maskOpacity[settings.surface] ?? 0.94,
                },
                volume: settings.volume,
                mode: settings.mode,
                startCollapsed: false,
            },
            {
                getBlob: (id) => store.get(id),
                readFallback: fallback,
                readPublicImage: (url) => {
                    const safe = publicResource(url);
                    if (!safe) throw new Error('封面不是公开 HTTPS 图片，请换为本地封面');
                    return read(safe).then(prepareCover);
                },
                readFont: async (file) => {
                    // Cache only the selected immutable bundled file. User blobs and
                    // audio URLs are still freshly read/validated on each export.
                    if (cachedFont?.file !== file)
                        cachedFont = {
                            file,
                            promise: read(asset(`assets/fonts/${file}`)).then((blob) =>
                                packFont(blob, abort.signal),
                            ),
                        };
                    let transport;
                    try {
                        transport = await cachedFont.promise;
                    } catch (error) {
                        cachedFont = null;
                        throw error;
                    }
                    fontEncoding = transport.encoding;
                    fontOriginalBytes = transport.originalBytes;
                    return transport.blob;
                },
                readFontLicense: async (file) => {
                    if (!LICENSES[file]) throw new Error('内置字体授权记录缺失');
                    return (
                        await Promise.all(
                            LICENSES[file].map((name) =>
                                memo(licenses, name, () =>
                                    read(asset(`assets/fonts/${name}`)).then((blob) => blob.text()),
                                ),
                            ),
                        )
                    ).join('\n\n');
                },
                probeAudio,
                maxFontBytes: MAX_PACKAGE_BYTES,
                encodeBlob,
                signal: abort.signal,
            },
        );
        const assets = {};
        for (const [index, name] of ['forest', 'moon', 'sunroom'].entries())
            assets[`assets/covers/${name}.png`] = await encodeBlob(await fallback(index));
        const cover = playlist.coverId ? await store.get(playlist.coverId) : null;
        if (playlist.coverId && !cover) throw new Error('歌单封面不在当前浏览器中，请重新选择封面');
        const playlistCover = cover ? await blobData(await prepareCover(cover)) : '';
        const ui = Object.fromEntries(UI_KEYS.map((key) => [key, structuredClone(settings[key])]));
        return {
            version: 1,
            config,
            ui,
            fontFile: preset?.file || '',
            fontEncoding,
            fontOriginalBytes,
            playlist: {
                id: playlist.id,
                name: playlist.name,
                description: playlist.description || '',
                cover: playlistCover,
            },
            assets,
            embeddedBytes,
        };
    }
    async function syncAvatar(avatar, prepared) {
        abort.signal.throwIfAborted();
        const context = getContext(),
            id = context.characters.findIndex((card) => card.avatar === avatar);
        if (id < 0) throw new Error('绑定的角色卡已不存在，请重新绑定');
        const character = context.characters[id];
        const card = {
            spec: 'chara_card_v2',
            data: structuredClone(character.data || { name: character.name, extensions: {} }),
        };
        card.data.name ||= character.name;
        card.data.extensions ||= {};
        const old = card.data.extensions.riserein_card_player;
        const playlist = playlistForCharacter(settings, avatar);
        if (!playlist && old?.mode !== 'native') return;
        const current = () => {
            const latest = getContext();
            return latest.characters[latest.characterId]?.avatar === avatar;
        };
        const helper = window.TavernHelper;
        if (current() && helper?.getScriptTrees) {
            card.data.extensions.tavern_helper ||= {};
            card.data.extensions.tavern_helper.scripts = helper.getScriptTrees({
                type: 'character',
            });
        }
        let next;
        if (playlist) {
            const payload = prepared?.get(playlist.id) || (await packagePlaylist(playlist));
            runtimePromise ||= read(new URL('./dist/native-runtime.js', import.meta.url))
                .then((blob) => blob.text())
                .catch((error) => {
                    runtimePromise = null;
                    throw error;
                });
            const script = nativeCardScript(payload, await runtimePromise, old?.scriptId || createTrackId());
            const findScript = (trees) => {
                for (const tree of trees || []) {
                    if (tree.type === 'folder') {
                        const found = findScript(tree.scripts);
                        if (found) return found;
                    } else if (tree.id === script.id) return tree;
                }
            };
            if (
                old?.mode === 'native' &&
                old.version === 1 &&
                old.projectId === payload.config.id &&
                old.playlistId === playlist.id &&
                JSON.stringify(findScript(card.data.extensions.tavern_helper?.scripts)) ===
                    JSON.stringify(script)
            )
                return;
            next = attachPlayerToCard(card, script, payload.config.id);
            Object.assign(next.data.extensions.riserein_card_player, {
                mode: 'native',
                playlistId: playlist.id,
            });
        } else {
            next = card;
            const remove = (trees) =>
                trees.flatMap((tree) =>
                    tree.type === 'folder'
                        ? [{ ...tree, scripts: remove(tree.scripts || []) }]
                        : tree.id === old.scriptId && tree.info?.startsWith('由 Riserein 音乐播放器制作。')
                          ? []
                          : [tree],
                );
            next.data.extensions.tavern_helper.scripts = remove(
                next.data.extensions.tavern_helper?.scripts || [],
            );
            // Keep an empty tombstone: ST's merge endpoint cannot remove an object with {}.
            next.data.extensions.riserein_card_player = null;
        }
        const extensions = {
            tavern_helper: next.data.extensions.tavern_helper,
            riserein_card_player: next.data.extensions.riserein_card_player,
        };
        character.data ||= {};
        character.data.extensions ||= {};
        const previous = Object.fromEntries(
            Object.keys(extensions).map((key) => [key, character.data.extensions[key]]),
        );
        const writeMemory = (values) => {
            const apply = (target) => {
                for (const [key, value] of Object.entries(values)) {
                    if (value === undefined) delete target[key];
                    else target[key] = value;
                }
            };
            apply(character.data.extensions);
            if (character.json_data) {
                const raw = JSON.parse(character.json_data);
                raw.data.extensions ||= {};
                apply(raw.data.extensions);
                character.json_data = JSON.stringify(raw);
                if (current()) {
                    const field = document.querySelector('#character_json_data');
                    if (field) field.value = character.json_data;
                }
            }
        };
        // The helper saves the ENTIRE card from memory when its script tree changes.
        // Publish both fields to memory first, so its watcher cannot write an old marker
        // over our checked save (especially when unbinding). The stored helper field
        // also matches its updated store, avoiding a redundant whole-card write.
        writeMemory(extensions);
        try {
            if (current() && helper?.replaceScriptTrees)
                helper.replaceScriptTrees(extensions.tavern_helper.scripts, { type: 'character' });
            const response = await window.fetch('/api/characters/merge-attributes', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({ avatar, data: { extensions } }),
                signal: abort.signal,
            });
            if (!response.ok) throw new Error(`酒馆保存角色音乐失败（${response.status}），未完成随卡更新`);
        } catch (error) {
            writeMemory(previous);
            if (current() && helper?.replaceScriptTrees)
                helper.replaceScriptTrees(previous.tavern_helper?.scripts || [], { type: 'character' });
            throw error;
        }
    }
    const previousFetch = window.fetch;
    async function wrappedFetch(input, init) {
        const url = typeof input === 'string' ? input : input?.url || String(input);
        if (new URL(url, location.href).pathname !== '/api/characters/export')
            return previousFetch.call(this, input, init);
        let body;
        try {
            body = JSON.parse(init?.body ?? (await input.clone().text()));
        } catch {
            return previousFetch.call(this, input, init);
        }
        const avatar = body.avatar_url;
        const context = getContext();
        const marked =
            context.characters.find((card) => card.avatar === avatar)?.data?.extensions?.riserein_card_player
                ?.mode === 'native';
        if (playlistForCharacter(settings, avatar) || marked) {
            try {
                showStatus('正在检查随卡音乐并保存播放器…');
                return await enqueue(async () => {
                    await syncAvatar(avatar);
                    showStatus('随卡播放器已准备好，正在导出角色卡。');
                    const liveSettings = () =>
                        getContext().characters.find((card) => card.avatar === avatar)?.data?.extensions
                            ?.tavern_helper;
                    const original = structuredClone(liveSettings());
                    const filtered = helperExportSettings(original);
                    const exportCurrent = async () =>
                        compactNativeResponse(await previousFetch.call(this, input, init), body.format);
                    if (JSON.stringify(filtered) === JSON.stringify(original)) return exportCurrent();
                    const write = async (value) => {
                        const saved = await previousFetch.call(window, '/api/characters/merge-attributes', {
                            method: 'POST',
                            headers: getContext().getRequestHeaders(),
                            body: JSON.stringify({ avatar, data: { extensions: { tavern_helper: value } } }),
                        });
                        if (!saved.ok) throw new Error(`酒馆保存角色脚本导出设置失败（${saved.status}）`);
                    };
                    // Refreshing our script must not undo the Helper's private-data
                    // export filtering. Keep author memory intact and restore the
                    // latest live settings after the native response is generated.
                    await write(filtered);
                    try {
                        return await exportCurrent();
                    } finally {
                        await write(liveSettings() || original);
                    }
                });
            } catch (error) {
                const message = `角色卡未导出：${error.message}`;
                showStatus(message, true);
                window.toastr?.error(message, '随卡音乐需要处理');
                // Fail closed: never silently hand the author a stale or empty music export.
                return new Response(message, {
                    status: 422,
                    statusText: 'Music export needs attention',
                });
            }
        }
        return previousFetch.call(this, input, init);
    }
    window.fetch = wrappedFetch;
    return {
        syncBindings: () =>
            enqueue(async () => {
                const prepared = new Map();
                for (const playlist of settings.playlists.filter((item) => item.characterAvatars.length))
                    prepared.set(playlist.id, await packagePlaylist(playlist));
                const avatars = new Set(settings.playlists.flatMap((item) => item.characterAvatars));
                for (const card of getContext().characters)
                    if (card.data?.extensions?.riserein_card_player?.mode === 'native')
                        avatars.add(card.avatar);
                for (const avatar of avatars) await syncAvatar(avatar, prepared);
            }),
        dispose() {
            abort.abort();
            fixedImages.clear();
            licenses.clear();
            cachedFont = null;
            if (window.fetch === wrappedFetch) window.fetch = previousFetch;
        },
    };
}
