import { PLAYER_BUILD, PAYLOAD_FORMAT, analyzePayload, assertCapacity, payloadLiteral } from './quality.js';
import { sceneSelection, sceneAssetReferences } from '../music-scenes.js';
import {
    normalizeCardConfig,
    jsonForScript,
    portableAudio,
    publicResource,
    MAX_AUDIO_BYTES,
    MAX_PACKAGE_BYTES,
} from './config.js';

export function audioMime(blob, title = '') {
    const mime = String(blob.type || '')
        .split(';')[0]
        .toLowerCase();
    const alias = {
        'audio/x-m4a': 'audio/mp4',
        'video/mp4': 'audio/mp4',
        'application/ogg': 'audio/ogg',
        'audio/x-aac': 'audio/aac',
        'audio/aacp': 'audio/aac',
        'audio/x-mp3': 'audio/mpeg',
        'audio/x-mpeg': 'audio/mpeg',
    }[mime];
    if (alias) return alias;
    if (/^audio\/(?:mpeg|mp3|wav|x-wav|wave|ogg|mp4|aac|flac|x-flac|webm|opus)$/.test(mime)) return mime;
    const extension = title.split('.').at(-1)?.toLowerCase();
    return (
        {
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            ogg: 'audio/ogg',
            oga: 'audio/ogg',
            m4a: 'audio/mp4',
            aac: 'audio/aac',
            flac: 'audio/flac',
            opus: 'audio/ogg',
            webm: 'audio/webm',
        }[extension] || null
    );
}
export async function blobData(blob, mime = blob.type) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return `data:${mime};base64,${btoa(binary)}`;
}
function checkedImage(blob) {
    if (!blob?.size || blob.size > 2 * 1024 * 1024 || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(blob.type))
        throw new Error(
            `图片为 ${((blob?.size || 0) / 1048576).toFixed(2)} MB（${blob?.type || '未知格式'}），封面或背景需要是 2 MB 以内的 PNG、JPEG、WebP、GIF 或 AVIF 图片。`,
        );
    return blob;
}
/** Reads copies only. No writes to the library, playlist or IndexedDB. */
export async function prepareCardPackage(
    { id, title, tracks, appearance, volume, mode, transitionDuration, reading, lyricOffsets, recipientDisplay, startCollapsed, sceneSet:sourceScenes },
    {
        getBlob,
        readFallback,
        readPublicImage,
        readFont,
        readFontLicense,
        probeAudio,
        signal,
        onProgress = () => {},
        onResource = () => {},
        maxFontBytes = 20 * 1024 * 1024,
        encodeBlob = blobData,
    },
) {
    const selected=sceneSelection(sourceScenes,tracks||[]);tracks=selected.tracks;
    if (!tracks?.length) throw new Error('歌单没有歌曲，请先导入音乐。');
    if (tracks.length > 200) throw new Error('一次最多导出 200 首，请拆分歌单。');
    let total = 0;
    const ready = [],
        errors = [];
    const add = (blob, kind, name) => {
        onResource({ kind, name, bytes: blob.size });
        total += blob.size;
        if (total > MAX_PACKAGE_BYTES)
            throw new Error(
                `内嵌资源累计 ${(total / 1048576).toFixed(2)} MB，合计不能超过 30 MB，请减少歌曲或改用稳定公开直链。`,
            );
        return blob;
    };
    for (const [index, track] of tracks.entries()) {
        signal?.throwIfAborted();
        onProgress({ index, total: tracks.length, title: track.title });
        try {
            let src;
            if (track.exportUrl) {
                src = publicResource(track.exportUrl);
                if (!src)
                    throw new Error('导出直链必须是公开 HTTPS 地址，不能使用本机、临时签名或含令牌的地址。');
            } else if (track.kind === 'local') {
                const blob = track.exportBlob || (await getBlob(track.id));
                if (!blob?.size) throw new Error('本地音频不在当前浏览器中，请重新导入。');
                if (blob.size > MAX_AUDIO_BYTES) {
                    onResource({ kind: 'audio', name: track.title, bytes: blob.size });
                    throw new Error(
                        `单首内嵌音频 ${(blob.size / 1048576).toFixed(2)} MB，不能超过 20 MB，请压缩音频或使用公开直链。`,
                    );
                }
                const mime = audioMime(blob, track.fileName || blob.name || track.title);
                if (!mime) throw new Error('无法确认音频格式，请重新导入 MP3、WAV、OGG 等音频文件。');
                src = await encodeBlob(add(blob, 'audio', track.title), mime);
            } else if (
                track.kind === 'url' ||
                (track.kind === 'platform' && track.platform === 'direct' && track.playback === 'full')
            ) {
                src = publicResource(track.url);
                if (!src) throw new Error('音源不是可分发的稳定公开 HTTPS 直链，请修改导出直链。');
            } else throw new Error('该来源不能独立分发播放。请替换为有权分发的本地音频或稳定公开直链。');
            if (!portableAudio(src)) throw new Error('音频资源格式不支持。');
            await probeAudio(src, signal);
            let image;
            if (track.exportCover) image = track.exportCover;
            else if (track.coverId) image = await getBlob(track.coverId);
            else if (track.cover) image = await readPublicImage(track.cover, signal);
            else image = await readFallback(track.fallbackCover || 0, signal);
            if (!image) throw new Error('封面文件丢失，请重新导入封面或恢复内置封面。');
            const cover = await encodeBlob(add(checkedImage(image), 'cover', track.title));
            ready.push({
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album,
                src,
                cover,
                lyrics: track.lyrics,
                lyricOffsetMs: lyricOffsets?.[track.id] ?? track.lyricOffsetMs,
                lyricsSource: track.lyricsSource,
                sourceUrl: track.sourceUrl || '',
                attribution: track.license?.attribution || '',
            });
        } catch (error) {
            signal?.throwIfAborted();
            errors.push(`「${track.title}」：${error.message}`);
        }
    }
    signal?.throwIfAborted();
    if (errors.length) throw new Error(`未导出，${errors.length} 首歌曲需要处理：\n${errors.join('\n')}`);
    const sceneAssets={};
    for(const assetId of [...sceneAssetReferences(selected.sceneSet?[selected.sceneSet]:[])].filter(id=>!id.endsWith(':original'))){
        signal?.throwIfAborted();const image=await getBlob(assetId);if(!image)throw new Error('场景封面或背景缺失，请重新选择；没有导出不完整场景。');
        const kind=assetId.startsWith('background:')?'background':'cover';sceneAssets[assetId]=await encodeBlob(add(checkedImage(image),kind,'场景'+(kind==='background'?'背景':'封面')));
    }
    const theme = { ...appearance };
    if (theme.imageBlob || theme.imageId) {
        const image = theme.imageBlob || (await getBlob(theme.imageId));
        if (!image) throw new Error('背景图片不在当前浏览器中，请重新导入或取消携带背景。');
        theme.image = await encodeBlob(add(checkedImage(image), 'background', '背景'));
    }
    if (theme.fontBlob || theme.fontId || theme.fontFile) {
        const font =
            theme.fontBlob ||
            (theme.fontId ? await getBlob(theme.fontId) : await readFont(theme.fontFile, signal));
        if (!font?.size) throw new Error('字体文件没有读到，请更新插件并刷新后重试。');
        if (font.size > maxFontBytes)
            throw new Error(
                `携带的字体资源为 ${(font.size / 1024 / 1024).toFixed(1)} MB，超过本次导出的 ${Math.round(maxFontBytes / 1024 / 1024)} MB 上限。`,
            );
        theme.font = await encodeBlob(
            add(font, 'font', theme.fontName || '字体'),
            'application/octet-stream',
        );
        if (theme.fontFile) theme.fontLicense = await readFontLicense(theme.fontFile, signal);
        if (!theme.fontLicense?.trim()) throw new Error('请填写自定义字体的授权及署名说明，或取消携带字体。');
    }
    signal?.throwIfAborted();
    const config = normalizeCardConfig({
        id,
        title,
        tracks: ready,
        appearance: theme,
        volume,
        mode,
        transitionDuration, reading, recipientDisplay,
        startCollapsed,
        ...(selected.sceneSet?{sceneSet:selected.sceneSet,sceneAssets}:{}),
    });
    return {
        config,
        embeddedBytes: total,
        analysis: assertCapacity(analyzePayload(config)),
        linkedTracks: ready.filter((track) => track.src.startsWith('https:')).length,
    };
}
export function buildCardExports(config, runtime, scriptId) {
    config = normalizeCardConfig(config);
    if(config.sceneSet)throw new Error('音乐场景需要使用共享界面导出，不能套入旧经典播放器。');
    if (!runtime.includes('startCharacterPlayer') || runtime.includes('//# sourceMappingURL'))
        throw new Error('独立播放器文件不完整，请更新插件后刷新。');
    config.runtimeVersion = PLAYER_BUILD;
    const encoded = payloadLiteral(config);
    const javascript = `/* Riserein standalone character player. MIT runtime. */\n(()=>{\n${runtime}\nRisereinCardPlayer.startCharacterPlayer(${encoded});\n})();\n`;
    const script = {
        type: 'script',
        enabled: true,
        name: `角色音乐 · ${config.title}`,
        id: scriptId,
        content: javascript,
        info: '由 Riserein 音乐播放器制作。角色脚本；音频已内嵌或使用公开直链，不依赖完整版插件。需要酒馆助手角色脚本权限，会访问酒馆主页面；请仅启用可信来源的脚本。',
        button: { enabled: true, buttons: [{ name: '显示/隐藏角色音乐', visible: true }] },
        data: {},
        export_with: { data: true, button: true },
    };
    const preview = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>角色播放器预览</title><style>html,body{margin:0;background:#222b28;min-height:100%;font-family:system-ui}h1{color:#c8d4cb;font-size:13px;padding:16px;font-weight:400}</style><h1>角色播放器预览 · 点击播放试听</h1><script>(()=>{\n${runtime}\nRisereinCardPlayer.startPreview(${encoded});\n})();</script></html>`;
    const songs = {
        runtimeVersion: PLAYER_BUILD,
        title: config.title,
        projectId: config.id,
        font: {
            name: config.appearance.fontName,
            license: config.appearance.fontLicense,
        },
        tracks: config.tracks.map(({ src, cover, ...track }) => ({
            ...track,
            resource: src.startsWith('data:') ? 'embedded audio bytes' : src,
            cover: cover ? 'embedded image bytes' : '',
        })),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(script)).length;
    if (bytes > 45 * 1024 * 1024) throw new Error('导出脚本超过 45 MB，请减少内嵌歌曲、图片或字体。');
    return {
        javascript,
        script,
        preview,
        songs,
        bytes,
        analysis: assertCapacity(analyzePayload(config, script)),
    };
}
/** Preserve unknown card fields and other authors' scripts. Replace only our marked export. */
export function attachPlayerToCard(input, script, projectId) {
    const card = structuredClone(input);
    if (
        !card ||
        !['chara_card_v2', 'chara_card_v3'].includes(card.spec) ||
        typeof card.data?.name !== 'string'
    )
        throw new Error('请选择酒馆导出的 V2/V3 角色卡 JSON；聊天文件或脚本 JSON 不能作为角色卡。');
    card.data.extensions ||= {};
    const ext = card.data.extensions;
    if (
        ext.tavern_helper !== undefined &&
        (ext.tavern_helper === null ||
            typeof ext.tavern_helper !== 'object' ||
            Array.isArray(ext.tavern_helper))
    )
        throw new Error('角色卡的酒馆助手数据格式异常，未修改原卡。');
    ext.tavern_helper ||= {};
    const helper = ext.tavern_helper;
    if (helper.scripts !== undefined && !Array.isArray(helper.scripts))
        throw new Error('角色脚本库格式异常，未修改原卡。');
    helper.scripts ||= [];
    const old = ext.riserein_card_player;
    const remove = (trees) =>
        trees.flatMap((tree) =>
            tree.type === 'folder'
                ? [{ ...tree, scripts: remove(tree.scripts || []) }]
                : old?.version === 1 &&
                    old?.scriptId === tree.id &&
                    tree.info?.startsWith('由 Riserein 音乐播放器制作。')
                  ? []
                  : [tree],
        );
    helper.scripts = [...remove(helper.scripts), structuredClone(script)];
    helper.variables ||= {};
    ext.riserein_card_player = {
        version: 1,
        projectId,
        scriptId: script.id,
        runtimeVersion: PLAYER_BUILD,
        payloadFormat: PAYLOAD_FORMAT,
    };
    return card;
}
