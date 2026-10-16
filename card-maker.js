import { getQueue, createTrackId, validateAudioFile } from './core.js';
import { fallbackCoverUrl, prepareCover } from './media.js';
import { BUILTIN_ID } from './platforms/library.js';
import { FONT_PRESETS } from './fonts.js';
import { themePalette, resolveScheme } from './scheme.js';
import { createSelectMenus } from './select-menu.js';
import { CARD_THEMES, publicResource } from './card-player/config.js';
import { prepareCardPackage, buildCardExports, attachPlayerToCard } from './card-player/export.js';
import { fetchBlob, probeAudio } from './card-player/browser-resources.js';

/** Authoring uses export-only copies. It never rewrites the music library or role bindings. */
export function createCardMaker({ panel, settings, store, context, getCollectionId, pausePlayback }) {
    const element = document.createElement('section');
    element.className = 'stm-card-maker';
    element.hidden = true;
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-label', '角色卡播放器制作');
    element.innerHTML = `<header class="stm-maker-header"><div><h3>角色卡播放器制作</h3><p class="stm-hint">把歌单、封面和外观装进角色卡，朋友只需酒馆助手。</p></div><button type="button" class="stm-icon" data-maker="close" aria-label="关闭角色卡播放器制作">×</button></header>
    <label for="stm-maker-collection">1 · 选择要携带的歌单</label><select id="stm-maker-collection"><option value="">总曲库</option></select>
    <label for="stm-maker-title">播放器名称</label><input id="stm-maker-title" maxlength="80" value="我的音乐">
    <p class="stm-hint">下方修改只影响导出副本。可编辑歌名、歌手、歌词与顺序，或替换音频、封面。</p>
    <button type="button" class="stm-secondary" data-maker="add">＋ 批量添加音频</button><input type="file" data-maker-file="audio" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.opus,.webm" multiple hidden>
    <ol class="stm-maker-tracks" aria-label="导出歌曲"></ol>
    <h4>2 · 设计播放器</h4><label for="stm-maker-theme">主题</label><select id="stm-maker-theme"><option value="current">使用当前配色</option>${Object.entries(
        CARD_THEMES,
    )
        .map(([id, theme]) => `<option value="${id}">${theme.name}</option>`)
        .join('')}</select>
    <div class="stm-maker-colors"><label>点缀<input type="color" data-maker-color="accent"></label><label>背景<input type="color" data-maker-color="background"></label><label>文字<input type="color" data-maker-color="text"></label></div>
    <label for="stm-maker-surface">背景质感</label><select id="stm-maker-surface"><option value="matte">雾面</option><option value="glass">毛玻璃</option><option value="clear">清透（需背景图片）</option></select>
    <label>遮罩不透明度<input type="range" data-maker="opacity" min="0" max="100" value="65" aria-label="导出遮罩不透明度"></label>
    <label class="stm-check-label"><input type="checkbox" data-maker="background">携带当前裁剪后的背景</label>
    <label class="stm-check-label"><input type="checkbox" data-maker="font">携带当前字体文件（如有）</label><label data-maker="font-credit-label" hidden>自定义字体的授权及署名说明<textarea data-maker="font-credit" rows="3" maxlength="30000" placeholder="内置字体自动附带许可；自定义字体请填写有权分发的授权说明，或取消携带字体。"></textarea></label>
    <label class="stm-check-label"><input type="checkbox" data-maker="collapsed">进入角色时先显示黑胶悬浮球</label>
    <p class="stm-hint">沿用当前音量与播放模式。进入角色自动显示，点击播放后开始；离开角色立即停止。</p>
    <h4>3 · 检查资源并导出</h4><p class="stm-hint">本地音频会随脚本内嵌，单首最多 20 MB，内嵌资源合计最多 30 MB。公开直链需要长期可访问。请仅分发你有权使用的资源。</p>
    <button type="button" class="stm-primary" data-maker="prepare">检查资源并生成预览</button><p class="stm-maker-status stm-hint" role="status" aria-live="polite"></p>
    <iframe class="stm-maker-preview" title="角色播放器独立预览" sandbox="allow-scripts" hidden></iframe>
    <div class="stm-maker-downloads" hidden><p class="stm-hint">资源已装入导出副本。继续修改歌曲后需重新检查；配色可实时预览。</p><button type="button" class="stm-primary" data-maker="export-current">导出当前角色卡 JSON（含播放器）</button><button type="button" class="stm-secondary" data-maker="export-file">选择角色卡 JSON 并装入播放器</button><input type="file" data-maker-file="card" accept=".json,application/json" hidden><button type="button" class="stm-secondary" data-maker="script-json">下载酒馆助手脚本 JSON</button><button type="button" class="stm-secondary" data-maker="javascript">下载独立 JavaScript</button><button type="button" class="stm-secondary" data-maker="preview">下载独立预览 HTML</button><button type="button" class="stm-secondary" data-maker="songs">下载歌曲清单</button><p class="stm-hint">导出生成新文件，不修改原角色卡。请把这里导出的角色卡 JSON 发给朋友；普通“绑定角色”不会打包歌曲。JSON 不携带角色头像图片。</p></div>`;
    const scroll = document.createElement('div');
    scroll.className = 'stm-maker-scroll';
    while (element.firstChild) scroll.append(element.firstChild);
    element.append(scroll);
    panel.append(element);
    const q = (selector) => element.querySelector(selector),
        status = q('.stm-maker-status');
    const menus = createSelectMenus(element);
    let tracks = [],
        projectId,
        prepared = null,
        controller = null,
        revision = 0,
        returnFocus,
        inert = [],
        busy = false,
        busyControls = [];
    const edits = () => {
        revision++;
        prepared = null;
        q('.stm-maker-downloads').hidden = true;
        status.textContent = '内容已修改，请重新检查资源。';
    };
    const message = (text) => {
        status.textContent = text;
    };
    const download = (name, text, type = 'application/json') => {
        const blob = new Blob([text], { type }),
            url = URL.createObjectURL(blob),
            a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const baseName = () => (q('#stm-maker-title').value.trim() || '角色播放器').replace(/[\\/:*?"<>|]/g, '_');
    const palette = () =>
        settings.customColors.enabled
            ? settings.customColors
            : (() => {
                  const colors = themePalette(
                      settings.theme,
                      resolveScheme(settings.colorScheme, matchMedia('(prefers-color-scheme: dark)').matches),
                  );
                  return {
                      accent: colors['--stm-accent'],
                      background: colors['--stm-solid'],
                      text: colors['--stm-body'],
                  };
              })();
    function chooseColors(colors) {
        for (const key of ['accent', 'background', 'text']) q(`[data-maker-color=${key}]`).value = colors[key];
    }
    function appearance() {
        const colors = Object.fromEntries(
            ['accent', 'background', 'text'].map((key) => [key, q(`[data-maker-color=${key}]`).value]),
        );
        const font = FONT_PRESETS[settings.fontPreset];
        return {
            ...colors,
            surface: q('#stm-maker-surface').value,
            opacity: Number(q('[data-maker=opacity]').value) / 100,
            ...(q('[data-maker=background]').checked ? { imageId: settings.backgroundId } : {}),
            ...(q('[data-maker=font]').checked
                ? settings.fontPreset === 'custom'
                    ? { fontId: settings.fontId }
                    : font?.file
                      ? { fontFile: font.file }
                      : {}
                : {}),
            fontLicense: q('[data-maker=font-credit]').value,
            fontName: settings.fontPreset === 'custom' ? settings.fontName : font?.name || '',
            fontFamily:
                settings.fontPreset === 'kai'
                    ? 'KaiTi, serif'
                    : ['song', 'fang'].includes(settings.fontPreset)
                      ? 'serif'
                      : 'system-ui, sans-serif',
        };
    }
    function applyColors() {
        if (!prepared) return;
        const { accent, background, text, surface, opacity } = appearance();
        prepared.config.appearance = { ...prepared.config.appearance, accent, background, text, surface, opacity };
        q('.stm-maker-preview').contentWindow?.postMessage(
            { type: 'rscp-appearance', appearance: prepared.config.appearance },
            '*',
        );
    }
    function renderTracks() {
        q('.stm-maker-tracks').replaceChildren();
        tracks.forEach((track, index) => {
            const row = document.createElement('li');
            row.dataset.trackId = track.id;
            const fields = document.createElement('div');
            fields.className = 'stm-maker-fields';
            for (const [key, label] of [
                ['title', '歌名'],
                ['artist', '歌手'],
            ]) {
                const wrapper = document.createElement('label');
                wrapper.textContent = label;
                const input = document.createElement('input');
                input.value = track[key] || '';
                input.maxLength = key === 'title' ? 160 : 120;
                input.setAttribute('aria-label', `第${index + 1}首${label}`);
                input.addEventListener('input', () => {
                    track[key] = input.value;
                    edits();
                });
                wrapper.append(input);
                fields.append(wrapper);
            }
            const kind = document.createElement('small');
            kind.textContent =
                track.kind === 'local'
                    ? '本地音频 · 将内嵌文件本身'
                    : track.kind === 'url' || track.platform === 'direct'
                      ? '公开直链 · 需保持长期可用'
                      : '该平台来源不能直接打包，请替换音频或填写导出直链';
            const urlLabel = document.createElement('label');
            urlLabel.textContent = '导出直链（可选，填写后替代本地/平台音源）';
            const url = document.createElement('input');
            url.type = 'url';
            url.placeholder = 'https://…/music.mp3';
            url.value = track.exportUrl || '';
            url.setAttribute('aria-label', `第${index + 1}首导出直链`);
            url.addEventListener('input', () => {
                track.exportUrl = url.value.trim();
                edits();
            });
            urlLabel.append(url);
            const detail = document.createElement('details'),
                summary = document.createElement('summary');
            summary.textContent = '歌词、封面与歌曲顺序';
            detail.append(summary);
            const lyrics = document.createElement('textarea');
            lyrics.rows = 3;
            lyrics.maxLength = 50000;
            lyrics.placeholder = '粘贴 LRC 或纯文本歌词';
            lyrics.value = track.lyrics || '';
            lyrics.setAttribute('aria-label', `第${index + 1}首歌词`);
            lyrics.addEventListener('input', () => {
                track.lyrics = lyrics.value;
                edits();
            });
            detail.append(lyrics);
            const action = (label, handler) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'stm-secondary';
                button.textContent = label;
                button.addEventListener('click', handler);
                detail.append(button);
                return button;
            };
            action('上移', () => {
                [tracks[index - 1], tracks[index]] = [tracks[index], tracks[index - 1]];
                edits();
                renderTracks();
            }).disabled = index === 0;
            action('下移', () => {
                [tracks[index + 1], tracks[index]] = [tracks[index], tracks[index + 1]];
                edits();
                renderTracks();
            }).disabled = index === tracks.length - 1;
            const cover = document.createElement('input');
            cover.type = 'file';
            cover.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
            cover.hidden = true;
            action('替换封面', () => cover.click());
            cover.addEventListener('change', async () => {
                try {
                    const file = cover.files[0];
                    if (!file) return;
                    track.exportCover = await prepareCover(file);
                    edits();
                    message('已更换这首歌的导出封面。');
                } catch (error) {
                    message(error.message);
                }
            });
            action('使用内置封面', () => {
                delete track.coverId;
                delete track.cover;
                delete track.exportCover;
                edits();
                message('已使用内置封面。');
            });
            const audio = document.createElement('input');
            audio.type = 'file';
            audio.accept = 'audio/*';
            audio.hidden = true;
            action('替换音频', () => audio.click());
            audio.addEventListener('change', () => {
                try {
                    const file = audio.files[0];
                    if (!file) return;
                    validateAudioFile(file);
                    track.exportBlob = file;
                    track.fileName = file.name;
                    track.kind = 'local';
                    delete track.exportUrl;
                    edits();
                    renderTracks();
                } catch (error) {
                    message(error.message);
                }
            });
            action('从导出移除', () => {
                tracks.splice(index, 1);
                edits();
                renderTracks();
            });
            detail.append(cover, audio);
            row.append(fields, kind, urlLabel, detail);
            q('.stm-maker-tracks').append(row);
        });
    }
    function chooseCollection() {
        const id = q('#stm-maker-collection').value || null;
        tracks = getQueue(settings, id).map((track) => ({ ...track }));
        projectId = `rscp:${id === BUILTIN_ID ? 'defaults' : !id ? 'library' : /^[\w:-]{1,80}$/.test(id) ? id : createTrackId()}`;
        q('#stm-maker-title').value =
            settings.playlists.find((list) => list.id === id)?.name ||
            (id ? settings.builtinCatalog.title : '我的音乐');
        edits();
        renderTracks();
    }
    function open() {
        returnFocus = document.activeElement;
        menus.close();
        inert = [...panel.children].filter((child) => child !== element).map((child) => [child, child.inert]);
        for (const [child] of inert) child.inert = true;
        element.hidden = false;
        chooseColors(palette());
        q('#stm-maker-theme').value = 'current';
        q('#stm-maker-surface').value = settings.surface;
        q('[data-maker=background]').checked = Boolean(settings.backgroundId);
        q('[data-maker=background]').disabled = !settings.backgroundId;
        q('[data-maker=font]').checked = Boolean(settings.fontId || FONT_PRESETS[settings.fontPreset]?.file);
        q('[data-maker=font-credit-label]').hidden = settings.fontPreset !== 'custom';
        q('[data-maker=opacity]').value = String(Math.round((settings.maskOpacity[settings.surface] ?? 0.65) * 100));
        const select = q('#stm-maker-collection');
        select.replaceChildren(new Option('总曲库', ''));
        if (settings.builtinCatalog.tracks.length) select.append(new Option(settings.builtinCatalog.title, BUILTIN_ID));
        for (const list of settings.playlists) select.append(new Option(list.name, list.id));
        select.value = getCollectionId() || '';
        chooseCollection();
        q('[data-maker=close]').focus();
    }
    function close() {
        revision++;
        controller?.abort();
        setBusy(false);
        controller = null;
        element.hidden = true;
        menus.close();
        q('.stm-maker-preview').srcdoc = '';
        q('.stm-maker-preview').hidden = true;
        prepared = null;
        tracks = [];
        for (const [child, value] of inert) child.inert = value;
        inert = [];
        returnFocus?.focus({ preventScroll: true });
    }
    function setBusy(value) {
        busy = value;
        if (value) {
            menus.close();
            busyControls = [...element.querySelectorAll('input,textarea,select,button')]
                .filter((control) => control.dataset.maker !== 'close')
                .map((control) => [control, control.disabled]);
            for (const [control] of busyControls) control.disabled = true;
        } else {
            for (const [control, disabled] of busyControls) control.disabled = disabled;
            busyControls = [];
        }
        element.classList.toggle('stm-maker-busy', value);
    }
    q('[data-maker=close]').addEventListener('click', close);
    element.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
        if (event.key === 'Tab') {
            const controls = [...element.querySelectorAll('button,input,select,textarea,summary,iframe')].filter(
                (node) => !node.disabled && node.getClientRects().length,
            );
            const at = controls.indexOf(document.activeElement);
            if (event.shiftKey && at <= 0) {
                event.preventDefault();
                controls.at(-1)?.focus();
            } else if (!event.shiftKey && at === controls.length - 1) {
                event.preventDefault();
                controls[0]?.focus();
            }
        }
    });
    element.addEventListener(
        'beforeinput',
        (event) => {
            if (busy) event.preventDefault();
        },
        true,
    );
    element.addEventListener(
        'click',
        (event) => {
            if (busy && !event.target.closest('[data-maker=close]')) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        },
        true,
    );
    q('#stm-maker-collection').addEventListener('change', chooseCollection);
    q('#stm-maker-title').addEventListener('input', edits);
    q('#stm-maker-theme').addEventListener('change', (event) => {
        chooseColors(event.target.value === 'current' ? palette() : CARD_THEMES[event.target.value]);
        applyColors();
    });
    for (const control of element.querySelectorAll('[data-maker-color],[data-maker=opacity],#stm-maker-surface'))
        control.addEventListener('input', applyColors);
    for (const name of ['background', 'font', 'collapsed', 'font-credit'])
        q(`[data-maker=${name}]`).addEventListener('change', edits);
    q('[data-maker=font-credit]').addEventListener('input', edits);
    q('[data-maker=add]').addEventListener('click', () => q('[data-maker-file=audio]').click());
    q('[data-maker-file=audio]').addEventListener('change', (event) => {
        const errors = [];
        for (const file of event.target.files) {
            try {
                validateAudioFile(file);
                if (tracks.length >= 200) throw new Error('最多 200 首。');
                tracks.push({
                    id: createTrackId(),
                    kind: 'local',
                    title: file.name.replace(/\.[^.]+$/, ''),
                    fileName: file.name,
                    exportBlob: file,
                });
            } catch (error) {
                errors.push(`${file.name}：${error.message}`);
            }
        }
        event.target.value = '';
        edits();
        renderTracks();
        if (errors.length) message(errors.join('\n'));
    });
    q('[data-maker=prepare]').addEventListener('click', async () => {
        controller?.abort();
        controller = new AbortController();
        const own = controller,
            stamp = ++revision;
        prepared = null;
        q('.stm-maker-downloads').hidden = true;
        q('.stm-maker-preview').srcdoc = '';
        q('.stm-maker-preview').hidden = true;
        setBusy(true);
        pausePlayback();
        try {
            const result = await prepareCardPackage(
                {
                    id: projectId,
                    title: q('#stm-maker-title').value,
                    tracks,
                    appearance: appearance(),
                    volume: settings.volume,
                    mode: settings.mode,
                    startCollapsed: q('[data-maker=collapsed]').checked,
                },
                {
                    getBlob: (id) => store.get(id),
                    readFallback: async (index, signal) =>
                        prepareCover(await fetchBlob(fallbackCoverUrl(index), signal)),
                    readPublicImage: (url, signal) => {
                        const safe = publicResource(url);
                        if (!safe) throw new Error('封面地址不能公开分发，请替换封面或使用内置封面。');
                        return fetchBlob(safe, signal).then(prepareCover);
                    },
                    readFont: (file, signal) => fetchBlob(new URL(`./assets/fonts/${file}`, import.meta.url), signal),
                    readFontLicense: async (file, signal) => {
                        const licenses = {
                            'GenWanMin2TC-R.woff2': ['OFL-GenWanMin.txt'],
                            'PoxiaoPixel.woff2': ['OFL-PoxiaoPixel.txt'],
                            'ChillHuoSong_F.woff2': ['OFL-ChillMovableType.txt'],
                            'AR-PL-UKai-CN.woff2': ['ARPHICPL.TXT', 'UKai-copyright.txt'],
                            'ChildFunSans.woff2': ['OFL-ChildFunSans.txt'],
                            'KingHwaOldSong.ttf': ['LICENSE-TerryWang.txt'],
                            'Huiwen-mincho.woff2': ['CC0-Huiwen.txt'],
                        };
                        if (!licenses[file]) throw new Error('字体许可记录缺失，未导出字体。');
                        return (
                            await Promise.all(
                                licenses[file].map(async (name) => {
                                    const blob = await fetchBlob(
                                        new URL(`./assets/fonts/${name}`, import.meta.url),
                                        signal,
                                    );
                                    return blob.text();
                                }),
                            )
                        ).join('\n\n');
                    },
                    probeAudio,
                    signal: own.signal,
                    onProgress: (progress) =>
                        message(`正在检查 ${progress.index + 1}/${progress.total}：${progress.title}`),
                },
            );
            const response = await fetch(new URL('./card-player/dist/runtime.js', import.meta.url), {
                signal: own.signal,
            });
            if (!response.ok) throw new Error('独立播放器文件读取失败，请更新插件后刷新。');
            const runtime = await response.text();
            own.signal.throwIfAborted();
            if (stamp !== revision || element.hidden) return;
            prepared = { ...result, runtime, scriptId: createTrackId() };
            const files = buildCardExports(prepared.config, runtime, prepared.scriptId);
            q('.stm-maker-preview').srcdoc = files.preview;
            q('.stm-maker-preview').hidden = false;
            q('.stm-maker-downloads').hidden = false;
            message(
                `检查通过：${result.config.tracks.length} 首，内嵌资源 ${(result.embeddedBytes / 1024 / 1024).toFixed(1)} MB，${result.linkedTracks} 首使用公开直链。请在下方点播放试听，再导出角色卡。`,
            );
        } catch (error) {
            if (!own.signal.aborted && stamp === revision) message(error.message);
        } finally {
            if (controller === own) setBusy(false);
        }
    });
    const files = () => {
        if (!prepared) throw new Error('请先检查资源并生成预览。');
        return buildCardExports(prepared.config, prepared.runtime, prepared.scriptId);
    };
    const action = (name, fn) =>
        q(`[data-maker=${name}]`).addEventListener('click', async () => {
            try {
                await fn();
            } catch (error) {
                message(error.message);
            }
        });
    for (const [name, key, extension, mime] of [
        ['script-json', 'script', '.tavern-helper.json', 'application/json'],
        ['javascript', 'javascript', '.js', 'text/javascript'],
        ['preview', 'preview', '.html', 'text/html'],
        ['songs', 'songs', '.songs.json', 'application/json'],
    ])
        action(name, () => {
            const content = files()[key];
            download(
                baseName() + extension,
                typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                mime,
            );
        });
    function exportCard(card) {
        const all = files(),
            output = attachPlayerToCard(card, all.script, prepared.config.id);
        const text = JSON.stringify(output, null, 2);
        if (new Blob([text]).size > 60 * 1024 * 1024)
            throw new Error('角色卡合计超过 60 MB，请减少原有资源或本次内嵌歌曲。');
        download((output.data.name || baseName()).replace(/[\\/:*?"<>|]/g, '_') + '.含音乐.json', text);
        message('已导出含播放器的角色卡 JSON。朋友导入该文件后，在酒馆助手允许并启用角色脚本即可播放。');
    }
    action('export-current', async () => {
        files();
        const latest = SillyTavern.getContext();
        const card = latest.characters[latest.characterId];
        if (latest.groupId || !card?.avatar)
            throw new Error('请先打开要导出的单人角色，或使用“选择角色卡 JSON 并装入播放器”。');
        const response = await fetch('/api/characters/export', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: card.avatar, format: 'json' }),
        });
        if (!response.ok) throw new Error('酒馆读取当前角色卡失败，未生成文件。');
        exportCard(await response.json());
    });
    action('export-file', () => {
        files();
        q('[data-maker-file=card]').click();
    });
    q('[data-maker-file=card]').addEventListener('change', async (event) => {
        try {
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > 60 * 1024 * 1024) throw new Error('角色卡 JSON 超过 60 MB，请先减少原有内嵌资源。');
            const json = JSON.parse(await file.text());
            exportCard(json);
        } catch (error) {
            message(error instanceof SyntaxError ? '所选文件不是有效的角色卡 JSON。' : error.message);
        } finally {
            event.target.value = '';
        }
    });
    return { open, close };
}
