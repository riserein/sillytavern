import { formatTime, nextTrackId } from '../core.js';
import { playSymbol } from '../player-components.js';
import { parseLyrics, currentLyricIndex } from '../media.js';
import { watchRoleLifetime } from './lifecycle.js';
import { clampPosition } from '../floating.js';
import { normalizeCardConfig, normalizeAppearance } from './config.js';

/** Host-owned audio survives message/chat changes; the role owns every resource. */
export function mountCardPlayer(input, scope) {
    const { hostDocument: doc, hostWindow: win, roleId } = scope;
    if (!roleId || scope.currentRole() !== roleId) throw new Error('角色作用域已改变，取消创建播放器。');
    if (roleId !== 'preview' && win.__risereinFullMusicPlayer) return null;
    const config = normalizeCardConfig(input);
    const existing = [...doc.querySelectorAll('[data-riserein-card-player]')].find(
        (node) => node.dataset.risereinCardPlayer === config.id && node.dataset.roleId === roleId,
    );
    if (existing?.__risereinPlayer?.scriptId === scope.scriptId && !existing.__risereinPlayer.disposed) return existing.__risereinPlayer;
    if (existing && !existing.__risereinPlayer) throw new Error('发现未知的同名播放器节点，请刷新后重试。');
    for (const node of doc.querySelectorAll('[data-riserein-card-player]')) node.__risereinPlayer?.dispose();
    const root = doc.createElement('section');
    root.dataset.risereinCardPlayer = config.id;
    root.dataset.roleId = roleId;
    root.dataset.scriptId = scope.scriptId;
    const shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
        :host{position:fixed;display:block;width:max-content;right:18px;bottom:88px;z-index:3100;--accent:#b2c3b1;--bg:#182220;--text:#e8eee6;color:var(--text);font:14px/1.5 system-ui,sans-serif;max-width:calc(100vw - 24px)}
        *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;border:0;color:inherit;background:transparent}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}[hidden]{display:none!important}
        .ball{position:relative;width:48px;height:48px;border:1px solid var(--accent);border-radius:50%;display:grid;place-items:center;padding:0;touch-action:none}.ball::before{content:"";position:absolute;inset:0;border-radius:50%;background:repeating-radial-gradient(circle,#151817 0 2px,#343b36 2px 3px);animation:spin 18s linear infinite;animation-play-state:paused;pointer-events:none}.ball span{position:relative;display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:var(--accent);color:var(--bg);font-size:15px;overflow:hidden;pointer-events:none}.ball img{width:100%;height:100%;object-fit:cover}
        :host([data-playing=true]) .ball::before{animation-play-state:running}.panel{position:relative;width:340px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 100px);overflow:auto;padding:16px 18px;border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);border-radius:16px;background:linear-gradient(var(--mask),var(--mask)),var(--image) center/cover,var(--bg);box-shadow:0 8px 24px #0003;backdrop-filter:blur(var(--blur,0px))}.head{display:flex;align-items:center;justify-content:space-between;gap:8px;touch-action:none;cursor:move}.head strong{font-size:13px;font-weight:500}.head button{width:36px;height:36px;font-size:22px}p{margin:10px 0;font-size:12px;opacity:.8}.cover{display:block;width:156px;height:156px;border-radius:12px;overflow:hidden;padding:0;margin:12px auto;background:linear-gradient(145deg,var(--accent),var(--bg))}.cover img{width:100%;height:100%;object-fit:cover}.cover img:not([src]),.ball img:not([src]){display:none}.title{display:block;text-align:center;font-size:19px;overflow-wrap:anywhere;margin:10px 0 0}.artist{text-align:center;margin:2px 0 10px;font-size:12px;opacity:.7}input{accent-color:var(--accent)}.seek{width:100%}.time{display:flex;justify-content:space-between;font-size:11px;opacity:.7}.transport{display:flex;align-items:center;justify-content:center;gap:22px}.transport>button{min-width:40px;min-height:44px;font-size:22px}.play{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--accent);color:var(--bg);margin:10px 0}.play svg{width:23px;height:23px;fill:currentColor}.options{display:flex;align-items:center;gap:10px}.mode{min-width:42px;min-height:40px;font-size:18px}.volume{display:flex;align-items:center;gap:8px;font-size:12px;flex:1;min-width:0;white-space:nowrap}.volume input{min-width:0;width:0;flex:1}ol{list-style:none;margin:12px 0 0;padding:0;max-height:180px;overflow:auto}li button{width:100%;text-align:left;min-height:44px;padding:10px 6px;border-top:1px solid color-mix(in srgb,var(--accent) 20%,transparent);overflow-wrap:anywhere}li button[aria-current=true]{color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,transparent)}.status{min-height:16px;font-size:11px}.hint{font-size:11px;opacity:.65}.lyrics{position:absolute;inset:56px 14px 18px;z-index:2;overflow:auto;text-align:center;cursor:pointer;backdrop-filter:blur(14px);border-radius:10px;padding:20px;background:color-mix(in srgb,var(--bg) 35%,transparent)}.lyrics p{font-size:16px;line-height:2;opacity:.6;margin:18px 0}.lyrics .active{opacity:1;color:var(--accent);font-weight:600}small{display:block;font-size:10px;opacity:.7;overflow-wrap:anywhere}a{color:var(--accent)}*{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--accent) 35%,transparent) transparent}
        @keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ball::before{animation:none}}@media(max-height:600px){.cover{width:110px;height:110px}.panel{max-height:calc(100dvh - 24px)}}
    </style><style class="font-style"></style><button class="ball" aria-label="展开角色音乐播放器" aria-expanded="true"><span><img alt=""><i>♪</i></span></button><section class="panel" role="region" aria-label="角色专属音乐播放器"><header class="head" tabindex="0" aria-label="拖动角色播放器"><strong></strong><button aria-label="收起角色播放器">×</button></header><p class="demo-hint" hidden>三首原创合成测试音，不是正式曲库。</p><button class="cover" aria-label="显示角色音乐歌词"><img alt="歌曲封面"></button><strong class="title"></strong><p class="artist"></p><label class="hint" for="rscp-seek">播放进度</label><input id="rscp-seek" class="seek" type="range" min="0" max="0" step="0.1" value="0" disabled><div class="time"><span data-time="elapsed">0:00</span><span data-time="duration">0:00</span></div><div class="transport"><button class="previous" aria-label="角色音乐上一首">‹</button><button class="play" aria-label="播放角色音乐"></button><button class="next" aria-label="角色音乐下一首">›</button></div><div class="options"><button class="mode"></button><label class="volume">音量<input type="range" min="0" max="100" value="20" aria-label="角色音乐音量"></label></div><ol aria-label="角色歌单"></ol><small class="credit"></small><details class="licenses" hidden><summary>字体许可</summary><pre style="white-space:pre-wrap;font:10px/1.5 system-ui;overflow-wrap:anywhere"></pre></details><p class="status" role="status"></p><div class="lyrics" role="button" tabindex="0" aria-label="返回角色音乐封面" hidden></div></section>`;
    const audio = doc.createElement('audio');
    audio.preload = 'metadata';
    shadow.append(audio);
    const query = (selector) => shadow.querySelector(selector);
    const abort = new win.AbortController();
    const legacyNamespace = `riserein:card-player:v1:${encodeURIComponent(config.id)}:${encodeURIComponent(roleId)}`;
    const namespace = `riserein:card-player:v2:${encodeURIComponent(config.id)}:${encodeURIComponent(roleId)}:${encodeURIComponent(scope.scriptId)}`;
    let selected = 0,
        disposed = false,
        live = false,
        listeners = 0,
        lifetime,
        expanded = true,
        mode = config.mode,
        lyricData,
        lyricIndex = -1;
    const positions = {};
    let fontFace = null,
        fontSource = '',
        fontRequest = 0;
    const fontName = `rscp-${scope.scriptId}-${roleId}`.replace(/[^a-z0-9-]/gi, '');
    let drag = null,
        suppressClick = false;
    try {
        const current = win.localStorage.getItem(namespace);
        const legacy = current ? null : win.localStorage.getItem(legacyNamespace);
        const saved = JSON.parse(current || legacy || '{}');
        if (!current && legacy) win.localStorage.setItem(namespace, JSON.stringify(saved));
        audio.volume = Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : config.volume;
    } catch {
        audio.volume = config.volume;
    }
    query('.volume input').value = String(Math.round(audio.volume * 100));
    const listen = (target, name, handler, extra = {}) => {
        target.addEventListener(name, handler, { ...extra, signal: abort.signal });
        listeners++;
    };
    function updateAppearance(raw) {
        const theme = normalizeAppearance(raw);
        for (const key of ['accent', 'background', 'text'])
            root.style.setProperty(key === 'background' ? '--bg' : `--${key}`, theme[key]);
        const color = theme.background;
        const opacity = theme.image ? (theme.surface === 'clear' ? 0 : theme.opacity) : 1;
        root.style.setProperty(
            '--mask',
            `rgba(${[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(',')},${opacity})`,
        );
        root.style.setProperty('--image', theme.image ? `url("${theme.image}")` : 'none');
        root.style.setProperty('--blur', theme.surface === 'glass' ? '18px' : '0px');
        root.style.fontFamily = theme.font ? `"${fontName}", serif` : theme.fontFamily;
        if ((theme.font || '') !== fontSource) {
            fontSource = theme.font || '';
            const request = ++fontRequest;
            if (fontFace) doc.fonts.delete(fontFace);
            fontFace = null;
            if (theme.font) {
                const face = new win.FontFace(fontName, `url("${theme.font}")`);
                void face.load().then(
                    () => {
                        if (!disposed && request === fontRequest) {
                            doc.fonts.add(face);
                            fontFace = face;
                        }
                    },
                    () => {
                        if (!disposed) query('.status').textContent = '内嵌字体加载失败，已回退设备字体。';
                    },
                );
            }
        }
    }
    updateAppearance(config.appearance);
    query('.licenses').hidden = !config.appearance.fontLicense;
    query('.licenses pre').textContent = config.appearance.fontLicense;
    query('.head strong').textContent = config.title;
    query('.demo-hint').hidden = !config.demo;
    query('.cover').hidden = config.demo;
    const modes = ['list', 'single', 'shuffle', 'sequence'],
        names = { list: '列表循环', single: '单曲循环', shuffle: '随机播放', sequence: '顺序播放' },
        symbols = { list: '↻', single: '↻₁', shuffle: '⤨', sequence: '→' };
    function render() {
        if (disposed) return;
        const playing = !audio.paused && !audio.ended;
        query('.play').innerHTML = playSymbol(playing);
        query('.play').setAttribute('aria-label', playing ? '暂停角色音乐' : '播放角色音乐');
        root.dataset.playing = String(live && playing);
        for (const [i, button] of [...query('ol').querySelectorAll('button')].entries())
            button.setAttribute('aria-current', String(i === selected));
        query('.mode').textContent = symbols[mode];
        query('.mode').setAttribute('aria-label', `角色播放模式：${names[mode]}`);
        query('.mode').title = `${names[mode]} · 点击切换`;
    }
    async function play() {
        try {
            if (disposed || scope.currentRole() !== roleId) {
                lifetime?.dispose();
                return;
            }
            await audio.play();
            if (!disposed) query('.status').textContent = '';
        } catch (error) {
            if (!disposed && error.name !== 'AbortError')
                query('.status').textContent =
                    error.name === 'NotAllowedError'
                        ? '请亲自点击播放，浏览器没有允许自动播放。'
                        : '音频无法播放：请检查资源是否有效，以及浏览器是否支持这个格式。';
        }
    }
    function select(index, shouldPlay = false) {
        if (disposed) return;
        selected = index;
        live = false;
        audio.pause();
        audio.src = config.tracks[index].src;
        audio.load();
        const track = config.tracks[index];
        query('.title').textContent = track.title;
        query('.artist').textContent = track.artist;
        query('.artist').hidden = !track.artist;
        for (const image of [query('.cover img'), query('.ball img')]) {
            if (track.cover) image.src = track.cover;
            else image.removeAttribute('src');
        }
        query('.ball i').hidden = Boolean(track.cover);
        query('.status').textContent = '';
        query('.credit').textContent = track.attribution;
        if (track.sourceUrl) {
            const link = doc.createElement('a');
            link.href = track.sourceUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = ' 原始来源';
            query('.credit').append(link);
        }
        lyricData = parseLyrics(track.lyrics);
        lyricIndex = -1;
        query('.lyrics').hidden = true;
        query('.lyrics').replaceChildren();
        for (const line of lyricData.lines) {
            const p = doc.createElement('p');
            p.textContent = line.text;
            query('.lyrics').append(p);
        }
        if (!track.lyrics.trim()) {
            const p = doc.createElement('p');
            p.textContent = '暂无歌词 · 轻点返回封面';
            query('.lyrics').append(p);
        }
        render();
        if (shouldPlay) void play();
    }
    function advance(direction, ended = false) {
        const next = nextTrackId(config.tracks, config.tracks[selected].id, mode, { direction, ended });
        if (next !== null)
            select(
                config.tracks.findIndex((track) => track.id === next),
                ended || !audio.paused,
            );
    }
    config.tracks.forEach((track, index) => {
        const row = doc.createElement('li'),
            button = doc.createElement('button');
        button.type = 'button';
        button.textContent = track.title;
        button.setAttribute('aria-label', `${config.demo ? '选择测试曲' : '选择角色歌曲'}：${track.title}`);
        listen(button, 'click', () => {
            if (index === selected) {
                if (audio.paused) void play();
                else audio.pause();
            } else select(index, true);
        });
        row.append(button);
        query('ol').append(row);
    });
    listen(query('.play'), 'click', () => {
        if (audio.paused) void play();
        else audio.pause();
    });
    listen(query('.previous'), 'click', () => advance(-1));
    listen(query('.next'), 'click', () => advance(1));
    listen(query('.mode'), 'click', () => {
        mode = modes[(modes.indexOf(mode) + 1) % modes.length];
        render();
    });
    const progress = () => {
        if (disposed) return;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        query('.seek').max = String(duration);
        query('.seek').disabled = duration <= 0;
        query('.seek').value = String(audio.currentTime || 0);
        query('[data-time=elapsed]').textContent = formatTime(audio.currentTime);
        query('[data-time=duration]').textContent = formatTime(duration);
        if (lyricData?.synced) {
            const next = currentLyricIndex(lyricData.lines, audio.currentTime);
            const lines = query('.lyrics').children;
            if (next !== lyricIndex) {
                if (lines[lyricIndex]) lines[lyricIndex].classList.remove('active');
                if (lines[next]) {
                    lines[next].classList.add('active');
                    if (!query('.lyrics').hidden)
                        query('.lyrics').scrollTop = lines[next].offsetTop - query('.lyrics').clientHeight / 2;
                }
                lyricIndex = next;
            }
        }
    };
    for (const name of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) listen(audio, name, progress);
    for (const name of ['play', 'playing', 'pause', 'waiting', 'ended', 'error'])
        listen(audio, name, () => {
            if (name === 'playing') live = true;
            else if (['pause', 'waiting', 'ended', 'error'].includes(name)) live = false;
            render();
        });
    listen(audio, 'ended', () => advance(1, true));
    listen(audio, 'error', () => {
        if (!disposed) query('.status').textContent = '音频加载失败：嵌入文件可能不受支持，或公开直链已失效。';
    });
    listen(query('.seek'), 'input', (event) => {
        if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value);
    });
    listen(query('.volume input'), 'input', (event) => {
        audio.volume = Number(event.target.value) / 100;
        try {
            win.localStorage.setItem(namespace, JSON.stringify({ volume: audio.volume }));
        } catch {
            /* Optional preference. */
        }
    });
    listen(query('.cover'), 'click', () => {
        query('.lyrics').hidden = false;
        progress();
    });
    listen(query('.lyrics'), 'click', () => {
        query('.lyrics').hidden = true;
    });
    listen(query('.lyrics'), 'keydown', (event) => {
        if (['Escape', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            query('.lyrics').hidden = true;
        }
    });
    function place() {
        if (disposed) return;
        const size = root.getBoundingClientRect(),
            key = expanded ? 'panel' : 'ball';
        const position = clampPosition(
            positions[key] || { x: win.innerWidth - size.width - 18, y: win.innerHeight - size.height - 88 },
            size,
            { width: win.innerWidth, height: win.innerHeight },
        );
        Object.assign(root.style, { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' });
    }
    function setExpanded(value) {
        expanded = value;
        query('.panel').hidden = !value;
        query('.ball').hidden = value;
        query('.ball').setAttribute('aria-expanded', String(value));
        place();
    }
    listen(win, 'resize', place);
    for (const handle of [query('.head'), query('.ball')]) {
        listen(handle, 'pointerdown', (event) => {
            if (
                !event.isPrimary ||
                event.button !== 0 ||
                (event.target.closest('button,input') && event.target.closest('button,input') !== handle)
            )
                return;
            suppressClick = false;
            const bounds = root.getBoundingClientRect();
            drag = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                left: bounds.x,
                top: bounds.y,
                moved: false,
            };
            handle.setPointerCapture(event.pointerId);
        });
        listen(handle, 'pointermove', (event) => {
            if (!drag || drag.id !== event.pointerId) return;
            const dx = event.clientX - drag.x,
                dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 6) return;
            drag.moved = true;
            suppressClick = true;
            positions[expanded ? 'panel' : 'ball'] = { x: drag.left + dx, y: drag.top + dy };
            place();
            event.preventDefault();
        });
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
            listen(handle, name, (event) => {
                if (drag?.id === event.pointerId) {
                    drag = null;
                    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
                }
            });
        listen(
            handle,
            'click',
            (event) => {
                if (suppressClick) {
                    suppressClick = false;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            },
            { capture: true },
        );
        listen(handle, 'keydown', (event) => {
            const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[
                event.key
            ];
            if (event.target !== handle || !delta) return;
            const bounds = root.getBoundingClientRect();
            positions[expanded ? 'panel' : 'ball'] = { x: bounds.x + delta[0], y: bounds.y + delta[1] };
            place();
            event.preventDefault();
            event.stopPropagation();
        });
    }
    listen(query('.head button'), 'click', () => setExpanded(false));
    listen(query('.ball'), 'click', () => setExpanded(true));
    const api = {
        audio,
        roleId,
        scriptId: scope.scriptId,
        root,
        updateAppearance,
        get disposed() {
            return disposed;
        },
        get resourceCounts() {
            return {
                listeners,
                subscriptions: lifetime?.subscriptions || 0,
                timers: 0,
                observers: lifetime?.disposed ? 0 : (scope.observerCount ?? 1),
            };
        },
        dispose() {
            lifetime?.dispose();
        },
    };
    root.__risereinPlayer = api;
    doc.body.append(root);
    setExpanded(!config.startCollapsed);
    select(0);
    lifetime = watchRoleLifetime(scope, () => {
        if (disposed) return;
        disposed = true;
        abort.abort();
        listeners = 0;
        live = false;
        drag = null;
        fontRequest++;
        if (fontFace) doc.fonts.delete(fontFace);
        fontFace = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio.remove();
        root.remove();
        delete root.__risereinPlayer;
    });
    return api;
}
