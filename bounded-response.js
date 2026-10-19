/** Read decompressed response bytes with an actual stream bound, not only a header. */
// A retained host operation may finish after its Helper iframe is removed.
const ByteArray = Uint8Array, ResponseLimitError = Error, NumericValue = Number;
export async function boundedBytes(response, maxBytes, signal) {
    if (NumericValue(response.headers.get('Content-Length')) > maxBytes) {
        await response.body?.cancel().catch(() => {});
        throw new ResponseLimitError('响应内容过大，已停止读取。');
    }
    signal?.throwIfAborted();
    if (!response.body) {
        const data = new ByteArray(await response.arrayBuffer());
        signal?.throwIfAborted();
        if (data.length > maxBytes) throw new ResponseLimitError('响应内容过大，已停止读取。');
        return data;
    }
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    const stop = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', stop, { once: true });
    try {
        for (;;) {
            signal?.throwIfAborted();
            const { value, done } = await reader.read();
            signal?.throwIfAborted();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw new ResponseLimitError('响应内容过大，已停止读取。');
            parts.push(value);
        }
        const result = new ByteArray(size);
        let offset = 0;
        for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
        return result;
    } finally {
        signal?.removeEventListener('abort', stop);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
