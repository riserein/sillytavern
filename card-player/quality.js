import { MAX_PACKAGE_BYTES, MAX_AUDIO_BYTES, jsonForScript, normalizeCardConfig } from './config.js';
import { base64Bytes } from '../base64.js';

export const PLAYER_BUILD = '2.0.0-alpha.1';
export const PAYLOAD_FORMAT = 1;
export const byteSize = (value) =>
    new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
export const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
export function dataBytes(value = '') {
    if (!value.startsWith('data:')) return 0;
    const text = value.slice(value.indexOf(',') + 1);
    if (text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
        throw new Error('内嵌资源的 Base64 不完整。');
    return (text.length / 4) * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);
}
/** Counts every occurrence, matching the actual serialized package (no imaginary deduplication). */
export function analyzePayload(payload, script) {
    const config = payload.config || payload;
    const rows = [];
    const add = (kind, name, value) => {
        if (!value) return;
        rows.push({
            kind,
            name,
            bytes: dataBytes(value),
            encodedBytes: byteSize(value),
            external: !value.startsWith('data:'),
        });
    };
    for (const track of config.tracks) {
        add('audio', track.title, track.src);
        add('cover', `${track.title} · 封面`, track.cover);
        if (track.lyrics)
            rows.push({
                kind: 'lyrics',
                name: `${track.title} · 歌词`,
                bytes: byteSize(track.lyrics),
                encodedBytes: byteSize(track.lyrics),
                external: false,
            });
    }
    add('background', '背景', config.appearance?.image);
    add('font', config.appearance?.fontName || '字体', config.appearance?.font);
    add('playlist-cover', '歌单封面', payload.playlist?.cover);
    for (const [name, value] of Object.entries(payload.assets || {})) add('fallback', name, value);
    const embeddedBytes = rows
        .filter((row) => row.kind !== 'lyrics')
        .reduce((sum, row) => sum + row.bytes, 0);
    const problems = [];
    for (const row of rows) {
        if (row.kind === 'audio' && row.bytes > MAX_AUDIO_BYTES)
            problems.push(`「${row.name}」超过单曲 20 MB；请降低音频码率或换成稳定公开直链。`);
        if (
            ['cover', 'background', 'playlist-cover', 'fallback'].includes(row.kind) &&
            row.bytes > 2 * 1024 * 1024
        )
            problems.push(`「${row.name}」图片超过 2 MB；请裁剪或压缩图片。`);
    }
    if (embeddedBytes > MAX_PACKAGE_BYTES)
        problems.push(
            `内嵌资源 ${formatBytes(embeddedBytes)} 超过 30 MB（含全部封面、背景和字体）；请压缩音频/图片、换小字体或使用稳定公开直链。`,
        );
    const scriptBytes = script ? byteSize(script) : null;
    if (scriptBytes > 45 * 1024 * 1024) problems.push('脚本超过 45 MB；请减少内嵌资源。');
    return {
        rows,
        embeddedBytes,
        payloadBytes: byteSize(payload),
        scriptBytes,
        problems,
        // PNG tEXt stores card JSON as base64; avatar/other card fields must be added separately.
        jsonPlayerBytes: scriptBytes,
        pngPlayerBytes: scriptBytes === null ? null : 4 * Math.ceil(scriptBytes / 3),
        pngUncompactedPlayerBytes: scriptBytes === null ? null : 8 * Math.ceil(scriptBytes / 3),
        note: 'JSON/PNG 估算仅为播放器部分，另加角色数据与头像。PNG 优化仅在双份元数据完全相同时生效。',
        static: problems.length ? 'failed' : 'passed',
        browser: 'not-tested',
        tavern: 'not-tested',
    };
}
export function assertCapacity(report) {
    if (report.problems.length) throw new Error(report.problems.join('\n'));
    return report;
}
/** A length-delimited JSON record can be read without executing untrusted card JavaScript. */
export function payloadLiteral(payload) {
    const json = jsonForScript(payload);
    return `/*RSCP_PAYLOAD_V1:${json.length}*/${json}`;
}
export function readScriptPayload(content) {
    const match = /\/\*RSCP_PAYLOAD_V1:(\d+)\*\//.exec(content);
    if (!match) throw new Error('这是旧版或不支持静态核对的播放器脚本，请由制作端重建后重新导出。');
    const start = match.index + match[0].length,
        length = Number(match[1]);
    if (
        !Number.isSafeInteger(length) ||
        length < 2 ||
        length > 60 * 1024 * 1024 ||
        start + length > content.length
    )
        throw new Error('播放器配置长度不完整。');
    const payload = JSON.parse(content.slice(start, start + length));
    const config = payload.config || payload;
    const normalized = normalizeCardConfig(config);
    // Do not let normalizers silently remove damaged resource references during validation.
    for (const [index, track] of config.tracks.entries()) {
        if (track.cover !== normalized.tracks[index].cover) throw new Error(`第 ${index + 1} 首封面损坏。`);
    }
    if (
        (config.appearance?.image || '') !== normalized.appearance.image ||
        (config.appearance?.font || '') !== (normalized.appearance.font || '')
    )
        throw new Error('背景或字体资源损坏。');
    assertCapacity(analyzePayload(payload));
    return payload;
}
const sorted = (value) =>
    Array.isArray(value)
        ? value.map(sorted)
        : value && typeof value === 'object'
          ? Object.fromEntries(
                Object.keys(value)
                    .sort()
                    .map((key) => [key, sorted(value[key])]),
            )
          : value;
export const sameData = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
export function verifyCardObject(card, { script, characterData } = {}) {
    if (!['chara_card_v2', 'chara_card_v3'].includes(card?.spec) || typeof card.data?.name !== 'string')
        throw new Error('不是 V2/V3 角色卡。');
    const marker = card.data.extensions?.riserein_card_player;
    if (!marker?.scriptId)
        throw new Error('此文件没有随卡播放器记录。请在制作端重新保存歌单绑定，确认“音乐已随卡保存”，再从酒馆重新导出 PNG / JSON；发送原文件或只保存本机绑定不会更新已导出的卡。');
    const flat = (trees, parentEnabled = true) =>
        (trees || []).flatMap((tree) =>
            tree.type === 'folder'
                ? flat(tree.scripts, parentEnabled && tree.enabled === true)
                : [{ script: tree, enabled: parentEnabled && tree.enabled === true }],
        );
    const matches = flat(card.data.extensions?.tavern_helper?.scripts).filter(
        (item) => item.script.id === marker.scriptId,
    );
    if (matches.length !== 1) throw new Error('随卡播放器脚本缺失或重复。');
    if (!matches[0].enabled)
        throw new Error('随卡播放器脚本或所在脚本文件夹已停用，请在制作端启用后重新导出；接收端仍须单独允许该角色的脚本运行。');
    const actual = matches[0].script;
    if (script && !sameData(actual, script)) throw new Error('导出前后的播放器脚本不一致，已阻止下载。');
    const payload = readScriptPayload(actual.content);
    if ((payload.config || payload).id !== marker.projectId)
        throw new Error('播放器与角色卡项目标记不一致。');
    if (characterData)
        for (const [key, value] of Object.entries(characterData)) {
            if (!sameData(card.data[key], value))
                throw new Error(`角色字段「${key}」导出前后不一致，已阻止下载。`);
        }
    return {
        ...assertCapacity(analyzePayload(payload, actual)),
        runtimeVersion: payload.runtimeVersion || 'legacy',
        tracks: (payload.config || payload).tracks.length,
        character: 'passed',
        static: 'passed',
        browser: 'not-tested',
        tavern: 'not-tested',
    };
}
const table = Uint32Array.from({ length: 256 }, (_, i) => {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
});
export function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
}
/** Reads native PNG text chunks; rejects truncation/CRC damage and conflicting card data. */
export async function readCardFile(blob, format) {
    if (blob.size > 160 * 1024 * 1024) throw new Error('角色卡超过 160 MB 安全读取上限，请减少资源。');
    if (format === 'json') return JSON.parse(await blob.text());
    const bytes = new Uint8Array(await blob.arrayBuffer()),
        view = new DataView(bytes.buffer);
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
        throw new Error('PNG 文件头损坏。');
    let offset = 8,
        ended = false;
    const cards = [];
    while (offset + 12 <= bytes.length) {
        const size = view.getUint32(offset),
            end = offset + size + 12;
        if (end > bytes.length) throw new Error('PNG 数据被截断。');
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4))
            throw new Error(`PNG ${type} 校验失败。`);
        if (type === 'tEXt') {
            const data = bytes.subarray(offset + 8, end - 4),
                zero = data.indexOf(0);
            const key = new TextDecoder().decode(data.subarray(0, zero));
            if (['chara', 'ccv3'].includes(key)) {
                const decoded = base64Bytes(new TextDecoder().decode(data.subarray(zero + 1)));
                cards.push(
                    JSON.parse(
                        new TextDecoder('utf-8', { fatal: true }).decode(
                            decoded,
                        ),
                    ),
                );
            }
        }
        offset = end;
        if (type === 'IEND') {
            ended = true;
            break;
        }
    }
    if (!ended || offset !== bytes.length || !cards.length) throw new Error('PNG 缺少完整角色数据。');
    if (cards.some((card) => !sameData(card.data, cards[0].data)))
        throw new Error('PNG 内的两份角色数据不一致，未自动选择其中一份。');
    return cards[0];
}
export async function verifyCardFile(blob, format, expected) {
    const card = await readCardFile(blob, format);
    return { ...verifyCardObject(card, expected), fileBytes: blob.size, format };
}

function cardTextChunk(key, card) {
    const raw = new TextEncoder().encode(JSON.stringify(card));
    let binary = '';
    for (let i = 0; i < raw.length; i += 32768) binary += String.fromCharCode(...raw.subarray(i, i + 32768));
    const data = new TextEncoder().encode(`${key}\0${btoa(binary)}`);
    const chunk = new Uint8Array(data.length + 12),
        view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set([116, 69, 88, 116], 4);
    chunk.set(data, 8);
    view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, -4)));
    return chunk;
}
/** Apply export privacy only to the download, without temporary writes to the author's card. */
export async function transformCardFile(blob, format, transform) {
    const card = await readCardFile(blob, format); // Validate bounds/CRC before changing anything.
    if (format === 'json')
        return new Blob([JSON.stringify(transform(card))], {
            type: 'application/json',
        });
    const bytes = new Uint8Array(await blob.arrayBuffer()),
        view = new DataView(bytes.buffer),
        chunks = [bytes.subarray(0, 8)];
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const end = offset + view.getUint32(offset) + 12;
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        let replacement;
        if (type === 'tEXt') {
            const data = bytes.subarray(offset + 8, end - 4),
                zero = data.indexOf(0);
            const key = new TextDecoder().decode(data.subarray(0, zero));
            if (['chara', 'ccv3'].includes(key)) {
                const decoded = base64Bytes(new TextDecoder().decode(data.subarray(zero + 1)));
                const value = JSON.parse(
                    new TextDecoder('utf-8', { fatal: true }).decode(
                        decoded,
                    ),
                );
                replacement = cardTextChunk(key, transform(value));
            }
        }
        chunks.push(replacement || bytes.subarray(offset, end));
        offset = end;
    }
    return new Blob(chunks, { type: 'image/png' });
}
