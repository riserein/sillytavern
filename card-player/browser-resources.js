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
export async function fetchBlob(url, signal) {
    const timeout = AbortSignal.timeout(20000);
    const response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        credentials: 'omit',
    });
    if (!response.ok) throw new Error('资源文件读取失败，请重新导入或检查网络。');
    return response.blob();
}
