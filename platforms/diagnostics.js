/** Observe the real media element. A metadata response or a play() promise is insufficient. */
export function verifyPlayback(audio, start, { timeout = 20000, signal } = {}) {
    return new Promise((resolve, reject) => {
        let firstTime = null,
            started = false;
        const clean = () => {
            clearTimeout(timer);
            for (const name of ['playing', 'timeupdate', 'error']) audio.removeEventListener(name, observe);
            signal?.removeEventListener('abort', abort);
        };
        const finish = (error, result) => {
            clean();
            error ? reject(error) : resolve(result);
        };
        const abort = () => finish(new DOMException('已取消播放检查。', 'AbortError'));
        const observe = (event) => {
            if (event.type === 'error' || audio.error) {
                finish(new Error(`音频实际加载失败（浏览器错误 ${audio.error?.code || '未知'}），未通过播放检查。`));
                return;
            }
            if (event.type === 'playing') {
                started = true;
                firstTime = audio.currentTime;
            }
            if (started && !audio.paused && audio.readyState >= 2 && audio.currentTime - firstTime >= 0.5)
                finish(null, {
                    status: 'played',
                    elapsed: audio.currentTime,
                    duration: Number.isFinite(audio.duration) ? audio.duration : null,
                });
        };
        const timer = setTimeout(
            () =>
                finish(
                    new Error(
                        '20 秒内未观察到音频实际播放。请检查来源提示、网络、浏览器权限或音频格式；未判定为成功。',
                    ),
                ),
            timeout,
        );
        for (const name of ['playing', 'timeupdate', 'error']) audio.addEventListener(name, observe);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
            abort();
            return;
        }
        Promise.resolve()
            .then(start)
            .catch((error) => finish(error));
    });
}
