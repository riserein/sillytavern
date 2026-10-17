import {
    PLAYER_BUILD,
    analyzePayload,
    assertCapacity,
    payloadLiteral,
    verifyCardFile,
    readCardFile,
    transformCardFile,
    sameData,
} from './quality.js';
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
        content: `/* Riserein shared-UI card player. MIT. */\n(()=>{\n${runtime}\nconst reportStartupError=(error)=>{console.error('[Riserein card player]',error);const message='随卡播放器启动失败（${PLAYER_BUILD}）：'+(error?.message||String(error))+'。请保留此提示，联系角色卡制作端检查并重新导出。';try{const host=window.parent;if(host.toastr?.error)host.toastr.error(message,'角色音乐播放器',{timeOut:0,extendedTimeOut:0,closeButton:true,escapeHtml:true});else host.alert(message);}catch{console.error(message);}};\ntry{Promise.resolve(RisereinNativePlayer.startNativeCharacterPlayer(${payloadLiteral(payload)})).catch(reportStartupError);}catch(error){reportStartupError(error);}\n})();`,
        info: '由 Riserein 音乐播放器制作。原生 PNG/JSON 随卡播放器；共享完整版界面，无音乐导入功能。不依赖完整版插件，需要酒馆助手角色脚本权限；脚本会访问酒馆主页面，请仅启用可信来源的角色脚本。',
        button: { enabled: false, buttons: [] },
        data: {},
        export_with: { data: true, button: true },
    };
    if (new TextEncoder().encode(JSON.stringify(script)).length > 45 * 1024 * 1024)
        throw new Error('随卡播放器超过 45 MB，请减少内嵌资源或改用稳定公开音频直链。');
    assertCapacity(analyzePayload(payload, script));
    return script;
}

/** Author-only bridge. The normal ST server exports the resulting card in BOTH formats. */
export function createNativeCardExport({ settings, store, getContext, showStatus }) {
    const abort = new AbortController();
    // A native marker can come from an imported card. It is not proof of a local binding.
    const managedAvatars = new Set(settings.playlists.flatMap(item => item.characterAvatars || []));
    let queue = Promise.resolve(),
        runtimePromise,
        cachedFont;
    const fixedImages = new Map(),
        licenses = new Map(),
        encoded = new WeakMap(),
        signatures = new WeakMap();
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
    const read = (url, maxBytes) => fetchBlob(url, abort.signal, maxBytes ? { maxBytes } : undefined);
    const fallback = (index) =>
        memo(fixedImages, index, () => read(fallbackCoverUrl(index)).then(prepareCover));
    const sourceSnapshot = (playlist) => ({
        playlist: structuredClone(playlist),
        tracks: structuredClone(getQueue(settings, playlist.id)),
        ui: Object.fromEntries(UI_KEYS.map((key) => [key, structuredClone(settings[key])])),
        fontPreset: settings.fontPreset,
        backgroundId: settings.backgroundId,
        volume: settings.volume,
        mode: settings.mode,
        surface: settings.surface,
        maskOpacity: structuredClone(settings.maskOpacity),
    });
    const sourceSignature = (value) =>
        // Playback cursors and automatically assigned fallback art are view state;
        // role navigation can update them without an author editing the project.
        JSON.stringify(value, (key, entry) => (['lastTrackId', 'fallbackCover'].includes(key) ? undefined : entry));
    const checkSource = (payload) => {
        const previous = signatures.get(payload);
        const playlist = settings.playlists.find((item) => item.id === previous?.id);
        if (!previous || !playlist) throw new Error('检查期间歌单已改变，请重新导出；未替换旧随卡配置');
        const current = sourceSignature(sourceSnapshot(playlist));
        if (current !== previous.signature) {
            const before = JSON.parse(previous.signature), after = JSON.parse(current);
            const fields = Object.keys(before).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
            const labels = { playlist: '歌单', tracks: '歌曲信息', ui: '界面', fontPreset: '字体', backgroundId: '背景', volume: '音量', mode: '模式', surface: '质感', maskOpacity: '遮罩' };
            throw new Error(`检查期间${fields.map(key => labels[key] || key).join('、')}已改变，请重新导出；未替换旧随卡配置`);
        }
    };
    async function packagePlaylist(playlist) {
        const author = sourceSnapshot(playlist),
            signature = sourceSignature(author);
        playlist = author.playlist;
        const preset = FONT_PRESETS[author.fontPreset];
        let fontEncoding = '',
            fontOriginalBytes = 0;
        if (author.fontPreset === 'custom')
            throw new Error('当前自定义字体没有随卡授权记录。请先选择内置字体或设备字体，再导出');
        const { config, embeddedBytes } = await prepareCardPackage(
            {
                id: `native:${playlist.id}`,
                title: playlist.name,
                tracks: author.tracks,
                appearance: {
                    imageId: author.backgroundId,
                    fontFile: preset?.file,
                    fontName: preset?.name,
                    surface: author.surface,
                    opacity: author.maskOpacity[author.surface] ?? 0.94,
                },
                volume: author.volume,
                mode: author.mode,
                startCollapsed: false,
            },
            {
                getBlob: (id) => store.get(id),
                readFallback: fallback,
                readPublicImage: (url) => {
                    const safe = publicResource(url);
                    if (!safe) throw new Error('封面不是公开 HTTPS 图片，请换为本地封面');
                    return read(safe, 10 * 1024 * 1024).then(prepareCover);
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
        const ui = author.ui;
        const payload = {
            version: 1,
            runtimeVersion: PLAYER_BUILD,
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
        const analysis = assertCapacity(analyzePayload(payload));
        payload.embeddedBytes = analysis.embeddedBytes;
        showStatus(
            `资源 ${(analysis.embeddedBytes / 1048576).toFixed(2)} MB（含歌曲、封面、背景和字体），正在构建随卡播放器…`,
        );
        signatures.set(payload, { id: playlist.id, signature });
        checkSource(payload);
        return payload;
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
        if (!playlist && !managedAvatars.has(avatar)) return;
        if (!playlist && old?.mode !== 'native') { managedAvatars.delete(avatar); return; }
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
            checkSource(payload);
            // Preserve edits made to unrelated scripts while audio/font reads were in flight.
            card.data.extensions.tavern_helper = structuredClone(
                character.data.extensions?.tavern_helper || {},
            );
            if (current() && helper?.getScriptTrees)
                card.data.extensions.tavern_helper.scripts = helper.getScriptTrees({ type: 'character' });
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
                sameData(findScript(card.data.extensions.tavern_helper?.scripts), script)
            ) { managedAvatars.add(avatar); return; }
            next = attachPlayerToCard(card, script, payload.config.id);
            Object.assign(next.data.extensions.riserein_card_player, {
                mode: 'native',
                playlistId: playlist.id,
            });
        } else {
            next = card;
            next.data.extensions.tavern_helper ||= {};
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
        // Commit using ST's checked endpoint before publishing a new Helper tree.
        // A rejected server write cannot trigger Helper autosave of an uncommitted script.
        const response = await window.fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ avatar, data: { extensions } }),
            signal: abort.signal,
        });
        if (!response.ok) throw new Error(`酒馆保存角色音乐失败（${response.status}），原随卡配置未替换`);
        try {
            // Publish BOTH fields before Helper's whole-card autosave watcher runs.
            writeMemory(extensions);
            if (current() && helper?.replaceScriptTrees)
                helper.replaceScriptTrees(extensions.tavern_helper.scripts, {
                    type: 'character',
                });
        } catch (error) {
            writeMemory(previous);
            if (current() && helper?.replaceScriptTrees)
                helper.replaceScriptTrees(previous.tavern_helper?.scripts || [], {
                    type: 'character',
                });
            const rollback = await window.fetch('/api/characters/merge-attributes', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({
                    avatar,
                    data: {
                        extensions: Object.fromEntries(
                            Object.entries(previous).map(([key, value]) => [key, value ?? null]),
                        ),
                    },
                }),
            });
            if (!rollback.ok)
                throw new Error(
                    `播放器更新失败且服务器回退未确认（${rollback.status}），请保留原始角色卡备份并重试：${error.message}`,
                );
            throw error;
        }
        if (playlist) managedAvatars.add(avatar);
        else managedAvatars.delete(avatar);
    }
    let lastReport = null;
    const previousFetch = window.fetch;
    async function wrappedFetch(input, init) {
        if (abort.signal.aborted) return previousFetch.call(this, input, init);
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
        const local = Boolean(playlistForCharacter(settings, avatar)) || managedAvatars.has(avatar);
        if (local || marked) {
            try {
                showStatus('正在检查随卡音乐并保存播放器…');
                return await enqueue(async () => {
                    if (local) await syncAvatar(avatar);
                    showStatus(local ? '随卡播放器已准备好，正在导出角色卡。' : '本机未绑定此卡的源歌单，将保留原有随卡播放器导出。');
                    const liveSettings = () =>
                        getContext().characters.find((card) => card.avatar === avatar)?.data?.extensions
                            ?.tavern_helper;
                    const original = structuredClone(liveSettings());
                    const filtered = helperExportSettings(original);
                    const exportCurrent = async () => {
                        const response = await previousFetch.call(this, input, init);
                        if (!response.ok) throw new Error(`酒馆导出失败（${response.status}）`);
                        let publicResponse = response;
                        if (JSON.stringify(filtered) !== JSON.stringify(original)) {
                            const publicFile = await transformCardFile(
                                await response.blob(),
                                body.format,
                                (card) => {
                                    if (card.data.extensions?.tavern_helper)
                                        card.data.extensions.tavern_helper = helperExportSettings(
                                            card.data.extensions.tavern_helper,
                                        );
                                    return card;
                                },
                            );
                            const headers = new Headers(response.headers);
                            for (const key of ['Content-Encoding', 'ETag', 'Digest', 'Content-MD5'])
                                headers.delete(key);
                            headers.set('Content-Length', String(publicFile.size));
                            publicResponse = new Response(publicFile, {
                                status: response.status,
                                statusText: response.statusText,
                                headers,
                            });
                        }
                        const compact = await compactNativeResponse(publicResponse, body.format);
                        const character = getContext().characters.find((card) => card.avatar === avatar);
                        const expectedData = structuredClone(character.data);
                        expectedData.extensions.tavern_helper = filtered;
                        const marker = expectedData.extensions.riserein_card_player;
                        // Unbinding exports a normal card; no player integrity record applies.
                        if (marker?.mode === 'native') {
                            const flatten = (trees) =>
                                (trees || []).flatMap((tree) =>
                                    tree.type === 'folder' ? flatten(tree.scripts) : [tree],
                                );
                            const script = flatten(filtered.scripts).find(
                                (item) => item.id === marker.scriptId,
                            );
                            if (!script) throw new Error('随卡播放器脚本缺失，未删除或覆盖原卡，请检查角色脚本。');
                            const blob = await compact.clone().blob();
                            // ST normalizes its own envelope; compare authored character fields separately.
                            const characterData = Object.fromEntries(
                                [
                                    'name',
                                    'description',
                                    'personality',
                                    'scenario',
                                    'first_mes',
                                    'mes_example',
                                    'alternate_greetings',
                                    'character_book',
                                    'extensions',
                                    'creator_notes',
                                    'system_prompt',
                                    'post_history_instructions',
                                    'tags',
                                    'creator',
                                    'character_version',
                                    'group_only_greetings',
                                ]
                                    .filter((key) => key in expectedData)
                                    .map((key) => [key, expectedData[key]]),
                            );
                            if (script.content.includes('/*RSCP_PAYLOAD_V1:')) {
                                lastReport = await verifyCardFile(blob, body.format, { script, characterData });
                                showStatus(`导出静态核对通过：${lastReport.tracks} 首，文件 ${(blob.size / 1048576).toFixed(2)} MB。浏览器试听与接收端酒馆验收需分别完成。`);
                            } else {
                                const exported = await readCardFile(blob, body.format);
                                for (const [key, value] of Object.entries(characterData))
                                    if (!sameData(exported.data[key], value)) throw new Error(`角色字段「${key}」导出前后不一致。`);
                                lastReport = { static: 'not-verified', character: 'passed', browser: 'not-tested', tavern: 'not-tested', fileBytes: blob.size };
                                showStatus('已保留旧版随卡脚本导出，角色字段已核对；旧脚本的音乐资源未静态验证，不能视为播放验收通过。');
                            }
                        }
                        return compact;
                    };
                    return exportCurrent();
                });
            } catch (error) {
                const message = `角色卡未导出：${error.message}`;
                showStatus(message, true);
                window.toastr?.error(message, '随卡音乐需要处理', { escapeHtml: true });
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
        get lastReport() {
            return lastReport;
        },
        rebuild: (avatar) => enqueue(() => syncAvatar(avatar)),
        syncBindings: () =>
            enqueue(async () => {
                const prepared = new Map();
                for (const playlist of settings.playlists.filter((item) => item.characterAvatars.length))
                    prepared.set(playlist.id, await packagePlaylist(playlist));
                const avatars = new Set(settings.playlists.flatMap((item) => item.characterAvatars));
                for (const avatar of managedAvatars) avatars.add(avatar);
                for (const avatar of avatars) {
                    if (!playlistForCharacter(settings, avatar) && !getContext().characters.some(card => card.avatar === avatar)) { managedAvatars.delete(avatar); continue; }
                    await syncAvatar(avatar, prepared);
                }
            }),
        dispose() {
            abort.abort();
            fixedImages.clear();
            licenses.clear();
            cachedFont = null;
            managedAvatars.clear();
            if (window.fetch === wrappedFetch) window.fetch = previousFetch;
        },
    };
}
