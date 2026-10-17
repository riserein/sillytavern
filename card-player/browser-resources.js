/** Probe decoding without playing sound or counting a play in the user's library. */
export function probeAudio(src, signal, timeout = 15000) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const audio = document.createElement('audio');
        audio.preload = 'auto';
        audio.muted = true;
        let done = false;
        const finish = (error) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            audio.removeEventListener('loadeddata', loaded);
            audio.removeEventListener('error', failed);
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            error ? reject(error) : resolve();
        };
        const loaded = () =>
            Number.isFinite(audio.duration) && audio.duration > 0
                ? finish()
                : finish(new Error('音频时长无效，无法确认可播放。'));
        const failed = () => finish(new Error('浏览器不能解码或读取音频，请检查格式、访问权限或直链是否失效。'));
        const cancel = () => finish(signal.reason || new DOMException('已取消', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('音频检查超时，请重试或更换稳定的音源。')), timeout);
        signal?.addEventListener('abort', cancel, { once: true });
        audio.addEventListener('loadeddata', loaded);
        audio.addEventListener('error', failed);
        audio.src = src;
        audio.load();
    });
}
export async function fetchBlob(url, signal, { maxBytes = 64 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('资源读取大小限制无效。');
    const timeout = AbortSignal.timeout(20000);
    const response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error('资源文件读取失败，请重新导入或检查网络。');
    if (Number(response.headers.get('Content-Length')) > maxBytes) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`资源文件超过 ${(maxBytes / 1048576).toFixed(0)} MB，已停止读取。`);
    }
    if (!response.body) {
        const blob = await response.blob();
        if (blob.size > maxBytes) throw new Error('资源文件超过读取上限。');
        return blob;
    }
    const reader = response.body.getReader(), parts = [];
    let bytes = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) throw new Error(`资源文件超过 ${(maxBytes / 1048576).toFixed(0)} MB，已停止读取。`);
            parts.push(value);
        }
        return new Blob(parts, { type: response.headers.get('Content-Type') || '' });
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
