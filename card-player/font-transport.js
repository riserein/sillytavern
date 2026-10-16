// Lossless transport container only. The original font file is restored byte for
// byte; no font conversion, subsetting, renaming or glyph modification is made.
export const MAX_FONT_SOURCE_BYTES = 64 * 1024 * 1024;
export const PLAIN_FONT_BYTES = 20 * 1024 * 1024;

export async function packFont(blob, signal) {
    signal?.throwIfAborted();
    if (!blob?.size) throw new Error('字体文件没有读到，请更新插件并刷新后重试。');
    if (blob.size > MAX_FONT_SOURCE_BYTES) throw new Error('字体原文件超过 64 MB，暂时不能随卡携带。');
    if (blob.size <= PLAIN_FONT_BYTES) return { blob, encoding: '', originalBytes: blob.size };
    if (typeof CompressionStream !== 'function')
        throw new Error('当前浏览器不支持字体无损打包，请更新浏览器后重试。');
    const compressed = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    signal?.throwIfAborted();
    return { blob: compressed, encoding: 'gzip', originalBytes: blob.size };
}

export async function unpackFont(blob, originalBytes, signal) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(originalBytes) || originalBytes < 1 || originalBytes > MAX_FONT_SOURCE_BYTES)
        throw new Error('随卡字体的原文件大小无效。');
    if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持还原随卡字体。');
    const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = [];
    let total = 0,
        complete = false;
    const cancel = () => {
        void reader.cancel(signal.reason).catch(() => {});
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            const { value, done } = await reader.read();
            signal?.throwIfAborted();
            if (done) break;
            total += value.byteLength;
            if (total > originalBytes) throw new Error('随卡字体大小与记录不符。');
            chunks.push(value);
        }
        if (total !== originalBytes) throw new Error('随卡字体文件不完整。');
        complete = true;
        return new Blob(chunks, { type: 'application/octet-stream' });
    } finally {
        signal?.removeEventListener('abort', cancel);
        if (!complete) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
