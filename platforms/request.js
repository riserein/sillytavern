import { boundedBytes } from '../bounded-response.js';
export class MusicRequestError extends Error {
    constructor(message, code = 'NETWORK', retryAt = 0) {
        super(message);
        this.code = code;
        this.retryAt = retryAt;
    }
}
export function createMusicRequest({ fetcher = globalThis.fetch, timeout = 12000, maxBytes = 4 * 1024 * 1024, now = Date.now } = {}) {
    const cache = new Map(),
        cooldown = new Map();
    return async function request(value, { signal, cacheMs = 120000 } = {}) {
        const url = new URL(value);
        const key = url.href;
        const time = now();
        if (signal?.aborted) throw new DOMException('请求已取消。', 'AbortError');
        if (cooldown.get(url.host) > time)
            throw new MusicRequestError('这个来源正在限流，请稍后再试。', 'RATE_LIMIT', cooldown.get(url.host));
        if (cacheMs > 0 && cache.has(key) && cache.get(key).until > time) return structuredClone(cache.get(key).data);
        if (cacheMs <= 0) cache.delete(key);
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
        try {
            const response = await fetcher(key, {
                signal: controller.signal,
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                headers: { Accept: 'application/json' },
            });
            if (response.status === 429) {
                const raw = response.headers.get('Retry-After');
                const seconds = Number(raw);
                const until =
                    raw && Number.isFinite(seconds)
                        ? time + Math.max(1, seconds) * 1000
                        : Math.max(time + 60000, Date.parse(raw) || 0);
                cooldown.set(url.host, until);
                throw new MusicRequestError('这个来源请求次数已达上限，请稍后再试。', 'RATE_LIMIT', until);
            }
            if (response.headers.get('cf-mitigated') === 'challenge')
                throw new MusicRequestError('来源网站要求网页安全验证，播放器暂时无法读取；请稍后再试或换一个来源。', 'CHALLENGE');
            if ([401, 403].includes(response.status))
                throw new MusicRequestError('此来源需要开发者接入或账号权限，当前无法使用。', 'AUTH');
            if (response.status === 404 || response.status === 410)
                throw new MusicRequestError('歌曲或歌单不存在、已下架，或接口已变更。', 'NOT_FOUND');
            if (!response.ok)
                throw new MusicRequestError(`音乐服务暂不可用（HTTP ${response.status}）。`, 'UNAVAILABLE');
            let data;
            try {
                data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(response, maxBytes, controller.signal)));
            } catch (error) {
                if (controller.signal.aborted) throw error;
                throw new MusicRequestError(error.message?.includes('过大') ? error.message : '音乐服务返回了无法识别的数据。', 'RESPONSE');
            }
            if (signal?.aborted) throw new DOMException('请求已取消。', 'AbortError');
            if (cacheMs > 0) {
                cache.set(key, { data: structuredClone(data), until: now() + cacheMs });
                if (cache.size > 100) cache.delete(cache.keys().next().value);
            }
            return data;
        } catch (error) {
            if (signal?.aborted) throw new DOMException('请求已取消。', 'AbortError');
            if (error instanceof MusicRequestError) throw error;
            if (controller.signal.aborted) throw new MusicRequestError('请求超时，请检查网络后重试。', 'TIMEOUT');
            throw new MusicRequestError('无法连接音乐来源，请检查网络；该来源也可能不允许跨域访问。', 'NETWORK');
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    };
}
