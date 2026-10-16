import { MAX_LYRICS } from './media.js';

const ENDPOINT = 'https://lrclib.net/api/search';
const LIMIT = 2 * 1024 * 1024;
const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const key = (value) => clean(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ');
/** Official read-only API. No audio extraction, auth, private mirrors or automatic metadata uploads. */
export async function searchLyrics(
    { title, artist = '', duration },
    { fetcher = globalThis.fetch, signal, timeout = 12000 } = {},
) {
    title = clean(title).slice(0, 160);
    artist = clean(artist).slice(0, 120);
    if (!title) throw new Error('请填写歌曲名称；文件编号不能用于准确匹配歌词。');
    const controller = new AbortController(),
        timer = setTimeout(
            () => controller.abort(new Error('歌词搜索超时，请稍后重试或导入 LRC。')),
            timeout,
        );
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
        const url = new URL(ENDPOINT);
        url.searchParams.set('track_name', title);
        if (artist) url.searchParams.set('artist_name', artist);
        const response = await fetcher(url.href, {
            signal: combined,
            credentials: 'omit',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok)
            throw new Error(
                response.status === 429
                    ? '歌词服务暂时繁忙，请稍后重试。'
                    : `歌词服务返回 ${response.status}，可改用本地 LRC。`,
            );
        let bytes = 0,
            parts = [];
        if (response.body) {
            const reader = response.body.getReader();
            try {
                for (;;) {
                    combined.throwIfAborted();
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.byteLength;
                    if (bytes > LIMIT) throw new Error('歌词搜索结果过大，已停止读取。');
                    parts.push(value);
                }
            } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
        } else {
            const data = await response.arrayBuffer();
            if (data.byteLength > LIMIT) throw new Error('歌词搜索结果过大。');
            parts = [data];
        }
        combined.throwIfAborted();
        const rows = JSON.parse(await new Blob(parts).text());
        if (!Array.isArray(rows)) throw new Error('歌词服务返回格式异常。');
        const seen = new Set();
        return rows
            .flatMap((row) => {
                if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) return [];
                seen.add(row.id);
                const synced = clean(row.syncedLyrics),
                    plain = clean(row.plainLyrics);
                const lyrics =
                    synced && synced.length <= MAX_LYRICS
                        ? synced
                        : plain && plain.length <= MAX_LYRICS
                          ? plain
                          : '';
                if (!lyrics) return [];
                const trackName = clean(row.trackName || row.name).slice(0, 160),
                    artistName = clean(row.artistName).slice(0, 120);
                const seconds = Number.isFinite(row.duration) && row.duration > 0 ? row.duration : null;
                const score =
                    (key(trackName) === key(title) ? 4 : 0) +
                    (artist && key(artistName) === key(artist) ? 3 : 0) +
                    (duration > 0 && seconds && Math.abs(duration - seconds) <= 2 ? 2 : 0);
                return [
                    {
                        id: row.id,
                        title: trackName,
                        artist: artistName,
                        album: clean(row.albumName).slice(0, 160),
                        duration: seconds,
                        lyrics,
                        synced: lyrics === synced,
                        source: `https://lrclib.net/api/get/${row.id}`,
                        score,
                    },
                ];
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);
    } catch (error) {
        if (signal?.aborted) throw new DOMException('歌词搜索已取消。', 'AbortError');
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error instanceof TypeError)
            throw new Error('无法连接歌词服务，请检查网络；也可导入本地 LRC / TXT。');
        if (error instanceof SyntaxError) throw new Error('歌词服务返回的内容不是有效数据。');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/** Small editor inside existing details, with explicit preview/confirmation before replacing lyrics. */
export function createLyricsLookup(element, { onApply }) {
    element.innerHTML = `<form class="stm-lyrics-search-form"><label>歌曲名称<input name="title" maxlength="160" required></label><label>歌手（选填，填写更准确）<input name="artist" maxlength="120"></label><button type="submit" class="stm-secondary">搜索歌词</button><button type="button" class="stm-secondary" data-lyrics="close">收起</button></form><p class="stm-hint" data-lyrics="status" role="status">按歌名、歌手向 LRCLIB 查询；预览后确认保存，不会自动覆盖已有歌词。</p><div data-lyrics="results"></div><pre data-lyrics="preview" style="white-space:pre-wrap;max-height:180px;overflow:auto" hidden></pre><button type="button" class="stm-secondary" data-lyrics="apply" disabled>确认使用这份歌词</button>`;
    const q = (selector) => element.querySelector(selector),
        form = q('form');
    let controller,
        track,
        candidate,
        generation = 0,
        disposed = false;
    const close = () => {
        generation++;
        controller?.abort();
        element.hidden = true;
        candidate = null;
    };
    const open = (value) => {
        close();
        track = value;
        element.hidden = false;
        form.elements.title.value = value.title || '';
        form.elements.artist.value = value.artist || '';
        q('[data-lyrics=results]').replaceChildren();
        q('[data-lyrics=preview]').hidden = true;
        q('[data-lyrics=apply]').disabled = true;
        q('[data-lyrics=status]').textContent =
            '按歌名、歌手向 LRCLIB 查询；预览后确认保存，不会自动覆盖已有歌词。';
    };
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        controller?.abort();
        controller = new AbortController();
        const stamp = ++generation;
        candidate = null;
        q('[data-lyrics=apply]').disabled = true;
        q('[data-lyrics=preview]').hidden = true;
        q('[data-lyrics=results]').replaceChildren();
        q('[data-lyrics=status]').textContent = '正在查找歌词…';
        try {
            const rows = await searchLyrics(
                {
                    title: form.elements.title.value,
                    artist: form.elements.artist.value,
                    duration: track.duration,
                },
                { signal: controller.signal },
            );
            if (disposed || stamp !== generation) return;
            q('[data-lyrics=status]').textContent = rows.length
                ? `找到 ${rows.length} 份；请选择并预览，注意同名歌曲、现场版与翻唱。`
                : '没有找到歌词。可修改歌名/歌手，或导入 LRC / TXT；纯音乐也可能没有歌词。';
            for (const row of rows) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'stm-secondary';
                button.textContent = `${row.title} · ${row.artist || '未知歌手'}${row.album ? ` · ${row.album}` : ''} · ${row.synced ? '同步歌词' : '纯文本'}`;
                button.addEventListener('click', () => {
                    candidate = row;
                    q('[data-lyrics=preview]').textContent = row.lyrics;
                    q('[data-lyrics=preview]').hidden = false;
                    q('[data-lyrics=apply]').disabled = false;
                });
                q('[data-lyrics=results]').append(button);
            }
        } catch (error) {
            if (!disposed && stamp === generation && error.name !== 'AbortError')
                q('[data-lyrics=status]').textContent = error.message;
        }
    });
    q('[data-lyrics=close]').addEventListener('click', close);
    q('[data-lyrics=apply]').addEventListener('click', () => {
        if (candidate) onApply(track, candidate);
        close();
    });
    return {
        open,
        close,
        dispose() {
            close();
            disposed = true;
            element.replaceChildren();
        },
    };
}
