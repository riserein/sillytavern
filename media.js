export const COVER_COUNT = 3;
export const MAX_LYRICS = 50000;
export const fallbackCoverUrl = index => new URL(`./assets/covers/${['forest', 'moon', 'sunroom'][index % COVER_COUNT]}.png`, import.meta.url).href;
export const randomCover = (random = Math.random) => Math.min(COVER_COUNT - 1, Math.max(0, Math.floor(random() * COVER_COUNT)));

export async function prepareCover(blob) {
    let source, url;
    try {
        if (globalThis.createImageBitmap) source = await createImageBitmap(blob);
        else { url = URL.createObjectURL(blob); source = new Image(); source.src = url; await source.decode(); }
        if (!source.width || !source.height || source.width * source.height > 40_000_000) throw new Error('封面图片尺寸过大或无法读取。');
        const side = Math.min(source.width, source.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = Math.min(512, side);
        canvas.getContext('2d').drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('封面处理失败。')), 'image/webp', .88));
    } finally { source?.close?.(); if (url) URL.revokeObjectURL(url); }
}

export function parseLyrics(text) {
    text = String(text || '').slice(0, MAX_LYRICS).replace(/^\uFEFF/, '');
    const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
    const lines = [];
    for (const line of text.split(/\r?\n/)) {
        const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
        const words = line.replace(/\[[^\]]*\]/g, '').trim();
        if (stamps.length) for (const stamp of stamps) {
            const time = Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || 0}`) - offset;
            if (Number(stamp[2]) < 60) lines.push({ time: Math.max(0, time), text: words || '♪' });
        }
    }
    if (lines.length) return { synced: true, lines: lines.sort((a, b) => a.time - b.time) };
    return { synced: false, lines: text.split(/\r?\n/).filter(line => !/^\[(?:ar|ti|al|by|offset|length):/i.test(line)).map(line => ({ time: null, text: line.trim() || ' ' })) };
}

export function currentLyricIndex(lines, time) {
    let low = 0, high = lines.length - 1, found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lines[mid].time <= time) { found = mid; low = mid + 1; } else high = mid - 1;
    }
    return found;
}

const syncSize = bytes => bytes.reduce((value, byte) => (value << 7) | (byte & 127), 0);
const normalSize = bytes => bytes.reduce((value, byte) => value * 256 + byte, 0);
function unSync(bytes) { return bytes.filter((byte, i) => !(byte === 0 && bytes[i - 1] === 255)); }
function decode(bytes, encoding) {
    const labels = ['windows-1252', 'utf-16', 'utf-16be', 'utf-8'];
    return new TextDecoder(labels[encoding] || 'utf-8').decode(bytes).replace(/\0/g, '').trim();
}
function afterDescription(bytes, start, encoding) {
    const step = encoding === 1 || encoding === 2 ? 2 : 1;
    for (let i = start; i + step <= bytes.length; i += step) {
        if (bytes[i] === 0 && (step === 1 || bytes[i + 1] === 0)) return i + step;
    }
    return bytes.length;
}

/** Read bounded ID3v2 metadata without downloading audio or relying on a music service. */
export async function readEmbeddedMetadata(file) {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (header.length < 10 || String.fromCharCode(...header.slice(0, 3)) !== 'ID3' || ![2, 3, 4].includes(header[3])) return {};
    const version = header[3], tagSize = syncSize(header.slice(6, 10));
    if (!tagSize || tagSize > 8 * 1024 * 1024 || tagSize + 10 > file.size || (version === 2 && header[5] & 64)) return {};
    let bytes = new Uint8Array(await file.slice(10, 10 + tagSize).arrayBuffer());
    if (version < 4 && header[5] & 128) bytes = unSync(bytes);
    let offset = 0;
    if (version >= 3 && header[5] & 64) offset = version === 3 ? normalSize(bytes.slice(0, 4)) + 4 : syncSize(bytes.slice(0, 4));
    const result = {};
    let frontCover = false;
    while (offset + (version === 2 ? 6 : 10) <= bytes.length) {
        const idLength = version === 2 ? 3 : 4, frameHeader = version === 2 ? 6 : 10;
        const id = String.fromCharCode(...bytes.slice(offset, offset + idLength));
        if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
        const sizeBytes = bytes.slice(offset + idLength, offset + idLength + (version === 2 ? 3 : 4));
        const size = version === 4 ? syncSize(sizeBytes) : normalSize(sizeBytes);
        if (!size || offset + frameHeader + size > bytes.length) break;
        const flags = version === 2 ? 0 : bytes[offset + 9];
        let data = bytes.slice(offset + frameHeader, offset + frameHeader + size);
        offset += frameHeader + size;
        if ((version === 3 && flags & 224) || (version === 4 && flags & 77)) continue;
        if (version === 4 && (flags & 2 || header[5] & 128)) data = unSync(data);
        if (id === 'TIT2' || id === 'TT2') result.title = decode(data.slice(1), data[0]).slice(0, 160);
        if (id === 'TPE1' || id === 'TP1') result.artist = decode(data.slice(1), data[0]).slice(0, 120);
        if (id === 'USLT' || id === 'ULT') {
            result.lyrics = decode(data.slice(afterDescription(data, 4, data[0])), data[0]).slice(0, MAX_LYRICS);
        }
        if ((id === 'APIC' || id === 'PIC') && !frontCover) {
            let mime, cursor;
            if (id === 'PIC') {
                const format = String.fromCharCode(...data.slice(1, 4)).toLowerCase();
                mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
                cursor = 4;
            } else {
                const end = data.indexOf(0, 1);
                if (end < 0) continue;
                mime = decode(data.slice(1, end), 0).toLowerCase();
                cursor = end + 1;
            }
            const type = data[cursor++];
            const image = data.slice(afterDescription(data, cursor, data[0]));
            if (/^image\/(jpeg|png|webp|gif)$/.test(mime) && image.length && image.length < 8 * 1024 * 1024) {
                result.cover = new Blob([image], { type: mime });
                frontCover = type === 3;
            }
        }
    }
    return result;
}
