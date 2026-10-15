import { fallbackCoverUrl } from './media.js';

export const playSymbol = playing => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${playing ? 'M7 5h4v14H7zM14 5h4v14h-4z' : 'm8 5 11 7-11 7z'}"/></svg>`;

export function createMiniPlayer({ panel, audio, getTrack, getCount, loadCover, onOpen, onPlay, onQueue }) {
    const element = document.createElement('section');
    element.className = 'stm-mini-player'; element.setAttribute('aria-label', '当前播放'); element.hidden = true;
    element.innerHTML = `<button type="button" class="stm-mini-info" aria-label="返回播放界面"><span class="stm-mini-disc"><img alt="当前歌曲封面"></span><span class="stm-mini-title-clip"><span class="stm-mini-title"></span></span></button><button type="button" class="stm-mini-play" aria-label="底栏播放"></button><button type="button" class="stm-mini-queue" aria-label="打开当前播放列表" aria-controls="stm-queue" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h12M9 12h12M9 19h12M3 4l3 1-3 2zM3 11h2v2H3zM3 18h2v2H3z"/></svg></button>`;
    panel.querySelector('.stm-status').before(element);
    const title = element.querySelector('.stm-mini-title');
    const clip = element.querySelector('.stm-mini-title-clip');
    const image = element.querySelector('img');
    const play = element.querySelector('.stm-mini-play');
    let coverKey = null;
    const measure = () => {
        const travel = Math.max(0, title.scrollWidth - clip.clientWidth);
        title.style.setProperty('--stm-title-travel', `${travel}px`);
        title.style.setProperty('--stm-title-duration', `${Math.max(9, travel / 12)}s`);
        title.classList.toggle('stm-marquee', travel > 1 && clip.clientWidth > 0);
    };
    const observer = new ResizeObserver(measure); observer.observe(clip); observer.observe(title);
    element.querySelector('.stm-mini-info').addEventListener('click', onOpen);
    play.addEventListener('click', onPlay);
    element.querySelector('.stm-mini-queue').addEventListener('click', onQueue);
    element.addEventListener('click', event => { if (!event.target.closest('button')) onOpen(); });
    return {
        render(hidden) {
            element.hidden = hidden;
            const track = getTrack();
            const playing = Boolean(track && !audio.paused && !audio.ended);
            const text = track?.title || '还没有选择歌曲';
            if (title.textContent !== text) { title.textContent = text; title.title = text; }
            play.innerHTML = playSymbol(playing);
            play.disabled = !getCount();
            play.setAttribute('aria-label', playing ? '底栏暂停' : '底栏播放');
            element.classList.toggle('stm-mini-playing', playing);
            const key = `${track?.id || ''}:${track?.coverId || track?.fallbackCover || 0}`;
            if (key !== coverKey) {
                coverKey = key; image.src = fallbackCoverUrl(track?.fallbackCover ?? 0);
                if (track) void loadCover(track).then(url => { if (url && coverKey === key && image.isConnected) image.src = url; });
            }
            measure();
        },
        dispose() { observer.disconnect(); },
    };
}
