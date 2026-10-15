import { parseShareLink } from './links.js';

/** Construct only official players; never inject HTML returned by oEmbed. */
export function officialEmbed(value) {
    let link;
    try {
        link = parseShareLink(typeof value === 'string' ? value : value?.sourceUrl);
    } catch {
        return null;
    }
    if (link.platform === 'spotify' && /^[a-zA-Z0-9]+$/.test(link.id)) {
        return {
            url: `https://open.spotify.com/embed/${link.type === 'playlist' ? 'playlist' : 'track'}/${link.id}`,
            height: 352,
            platform: link.platform,
        };
    }
    if (link.platform === 'soundcloud') {
        const url = new URL('https://w.soundcloud.com/player/');
        url.search = new URLSearchParams({ url: link.url, auto_play: 'false', show_artwork: 'true' });
        return { url: url.href, height: link.type === 'playlist' ? 400 : 166, platform: link.platform };
    }
    return null;
}

export function createOfficialPlayer(container, { beforeOpen }) {
    let timer;
    function close() {
        clearTimeout(timer);
        container.replaceChildren();
        container.hidden = true;
    }
    return {
        close,
        open(value) {
            const resource = officialEmbed(value);
            if (!resource) return false;
            close();
            beforeOpen();
            container.hidden = false;
            const notice = document.createElement('p');
            notice.className = 'stm-hint';
            notice.textContent =
                '请使用下方官方播放器操作。能否完整收听由平台和账号决定，可能只有试听；本插件的进度、音量、队列和播放统计不控制此播放器。关闭详情或离开角色聊天会停止。';
            const status = document.createElement('p');
            status.className = 'stm-hint';
            status.setAttribute('role', 'status');
            status.textContent = '正在加载官方播放器…';
            const frame = document.createElement('iframe');
            frame.title = '官方音乐播放器';
            frame.src = resource.url;
            frame.height = String(resource.height);
            frame.width = '100%';
            frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
            frame.referrerPolicy = 'strict-origin-when-cross-origin';
            // iframe load is not proof that music is playing or even available.
            frame.addEventListener('load', () => {
                clearTimeout(timer);
                status.textContent = '请在官方播放器中点播放；若空白或提示受限，请检查网络或使用官方来源。';
            });
            frame.addEventListener('error', () => {
                status.textContent = '官方播放器加载失败，请检查网络或使用官方来源。';
            });
            timer = setTimeout(() => {
                status.textContent = '官方播放器加载较慢，可能受到网络、浏览器或平台限制。';
            }, 15000);
            container.append(notice, status, frame);
            return true;
        },
    };
}
