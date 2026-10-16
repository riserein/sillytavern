const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const word = (bytes) => String.fromCharCode(...bytes);
function v2TextChunk(card) {
    card.spec = 'chara_card_v2';
    card.spec_version = '2.0';
    const raw = new TextEncoder().encode(JSON.stringify(card));
    let binary = '';
    for (let i = 0; i < raw.length; i += 32768) binary += word(raw.subarray(i, i + 32768));
    const data = new TextEncoder().encode('chara\0' + btoa(binary));
    const result = new Uint8Array(data.length + 12),
        view = new DataView(result.buffer);
    view.setUint32(0, data.length);
    result.set([116, 69, 88, 116], 4);
    result.set(data, 8);
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
        table[i] = value;
    }
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
    view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
    return result;
}
function metadata(bytes) {
    const binary = atob(new TextDecoder().decode(bytes));
    const decoded = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) decoded[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
}
/** Keep a standard V2 PNG only when its V3 chunk is an exact envelope duplicate.
 * Unknown/different metadata and all original image/CRC bytes remain untouched.
 */
export async function compactNativePng(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!SIGNATURE.every((value, index) => bytes[index] === value)) return blob;
    const view = new DataView(bytes.buffer);
    const chunks = [];
    let offset = 8,
        ended = false;
    while (offset + 12 <= bytes.length) {
        const size = view.getUint32(offset),
            end = offset + size + 12;
        if (end > bytes.length) return blob;
        const type = word(bytes.subarray(offset + 4, offset + 8));
        const chunk = { offset, end, type };
        if (type === 'tEXt' && size >= 6) {
            // Bound the keyword lookup; never spread a multi-megabyte payload.
            const prefix = bytes.subarray(offset + 8, offset + 14);
            const zero = prefix.indexOf(0);
            if (zero > 0) {
                chunk.key = word(prefix.subarray(0, zero)).toLowerCase();
                chunk.data = bytes.subarray(offset + 9 + zero, end - 4);
            }
        }
        chunks.push(chunk);
        offset = end;
        if (type === 'IEND') {
            ended = true;
            break;
        }
    }
    if (!ended || offset !== bytes.length) return blob;
    const v2 = chunks.filter((chunk) => chunk.key === 'chara');
    const v3 = chunks.filter((chunk) => chunk.key === 'ccv3');
    if (v2.length !== 1 || v3.length !== 1) return blob;
    let replacement;
    try {
        const a = metadata(v2[0].data),
            b = metadata(v3[0].data);
        const standardV2 = a.spec === 'chara_card_v2' && a.spec_version === '2.0';
        if (
            !(standardV2 || (a.spec === 'chara_card_v3' && a.spec_version === '3.0')) ||
            b.spec !== 'chara_card_v3' ||
            b.spec_version !== '3.0' ||
            a.data?.extensions?.riserein_card_player?.mode !== 'native'
        )
            return blob;
        a.spec = b.spec = 'chara_card_v2';
        a.spec_version = b.spec_version = '2.0';
        if (JSON.stringify(a) !== JSON.stringify(b)) return blob;
        // ST may also write a V3 envelope inside its legacy 'chara' chunk.
        // Normalize only that envelope, retaining every other field, and rebuild CRC.
        if (!standardV2) replacement = v2TextChunk(a);
    } catch {
        return blob;
    }
    return new Blob(
        [
            bytes.subarray(0, 8),
            ...chunks
                .filter((chunk) => chunk !== v3[0])
                .map((chunk) =>
                    chunk === v2[0] && replacement ? replacement : bytes.subarray(chunk.offset, chunk.end),
                ),
        ],
        { type: 'image/png' },
    );
}

export async function compactNativeResponse(response, format) {
    if (!response.ok || format !== 'png') return response;
    const blob = await response.blob();
    const compact = await compactNativePng(blob);
    const headers = new Headers(response.headers);
    for (const key of ['Content-Encoding','ETag','Digest','Content-MD5']) headers.delete(key);
    headers.set('Content-Length', String(compact.size));
    return new Response(compact, { status: response.status, statusText: response.statusText, headers });
}
