import { createLyricsLookup } from './lyrics.js';
import { CardProjectStore, captureProjectResources } from './card-player/project-store.js';
import {
    PLAYER_BUILD,
    analyzePayload,
    formatBytes,
    verifyCardFile,
    verifyCardObject,
} from './card-player/quality.js';
import { getQueue, createTrackId, validateAudioFile } from './core.js';
import { fallbackCoverUrl, prepareCover, readEmbeddedMetadata, MAX_LYRICS } from './media.js';
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
    element.innerHTML = `<header class="stm-maker-header"><div><h3>角色卡播放器制作</h3><p class="stm-hint">配置歌单、封面与外观，导出独立运行的角色卡播放器。</p></div><button type="button" class="stm-icon" data-maker="close" aria-label="关闭角色卡播放器制作">×</button></header>
    <div class="stm-maker-projects"><label for="stm-maker-project">制作项目 · 自动保存在当前浏览器</label><select id="stm-maker-project"></select><button type="button" class="stm-secondary" data-maker="project-new">新建项目</button><button type="button" class="stm-secondary" data-maker="project-copy">复制项目</button><button type="button" class="stm-secondary" data-maker="project-delete">删除当前项目</button><p class="stm-hint" data-maker="draft-status" role="status"></p></div>
    <label for="stm-maker-collection">1 · 选择要携带的歌单</label><select id="stm-maker-collection"><option value="">总曲库</option></select>
    <label for="stm-maker-title">播放器名称</label><input id="stm-maker-title" maxlength="80" value="我的音乐">
    <p class="stm-hint">下方修改只影响导出副本。可编辑歌名、歌手、歌词与顺序，或替换音频、封面。</p>
    <button type="button" class="stm-secondary" data-maker="add">＋ 批量添加音频</button><input type="file" data-maker-file="audio" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.opus,.webm" multiple hidden>
    <ol class="stm-maker-tracks" aria-label="导出歌曲"></ol><section data-maker="lyrics-lookup" hidden></section>
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
    <p class="stm-hint">制作端版本 ${PLAYER_BUILD}。恢复旧项目后点击“检查资源并生成预览”即可重建，不改变歌曲和配色。</p><button type="button" class="stm-secondary" data-maker="analyze">分析资源容量（不试听）</button><button type="button" class="stm-secondary" data-maker="verify-file">核对已导出的 PNG / JSON</button><input type="file" data-maker-file="verify" accept=".json,.png" hidden><details class="stm-maker-analysis"><summary>资源大小与验证状态</summary><pre data-maker="analysis" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></details>
    <button type="button" class="stm-primary" data-maker="prepare">检查资源并生成预览</button><p class="stm-maker-status stm-hint" role="status" aria-live="polite"></p>
    <iframe class="stm-maker-preview" title="角色播放器独立预览" sandbox="allow-scripts" hidden></iframe>
    <div class="stm-maker-downloads" hidden><p class="stm-hint">资源已装入导出副本。继续修改歌曲后需重新检查；配色可实时预览。</p><button type="button" class="stm-primary" data-maker="export-current">导出当前角色卡 JSON（含播放器）</button><button type="button" class="stm-secondary" data-maker="export-file">选择角色卡 JSON 并装入播放器</button><input type="file" data-maker-file="card" accept=".json,application/json" hidden><button type="button" class="stm-secondary" data-maker="script-json">下载酒馆助手脚本 JSON</button><button type="button" class="stm-secondary" data-maker="javascript">下载独立 JavaScript</button><button type="button" class="stm-secondary" data-maker="preview">下载独立预览 HTML</button><button type="button" class="stm-secondary" data-maker="songs">下载歌曲清单</button><p class="stm-hint">导出生成新文件，不修改原角色卡。此处导出的是制作页中的配置副本；歌单绑定也支持从酒馆原生按钮导出随卡播放器。JSON 不携带角色头像图片。</p></div>`;
    const scroll = document.createElement('div');
    scroll.className = 'stm-maker-scroll';
    while (element.firstChild) scroll.append(element.firstChild);
    element.append(scroll);
    panel.append(element);
    const q = (selector) => element.querySelector(selector),
        status = q('.stm-maker-status');
    const menus = createSelectMenus(element);
    let lyricsProject;
    const lyricLookup = createLyricsLookup(q('[data-maker=lyrics-lookup]'), {
        onApply(original, result) {
            if (lyricsProject !== projectId || !tracks.includes(original)) return;
            original.lyrics = result.lyrics;
            original.lyricsSource = result.source;
            edits();
            renderTracks();
            message('歌词已保存到制作项目；重新检查并导出后会随角色卡携带。');
        },
    });
    const drafts = new CardProjectStore();
    let sourceSettings = {},
        projectAssets = {},
        saveTimer,
        disposed = false,
        opened = false,
        draftReady = false;
    let persistence = Promise.resolve(),
        openGeneration = 0;
    const draftRevisions = new Map(),
        recoveries = new Map();
    const sourceKeys = ['backgroundId', 'fontPreset', 'fontId', 'fontName', 'volume', 'mode'];
    const formSnapshot = () =>
        Object.fromEntries(
            [
                ...element.querySelectorAll(
                    '[data-maker-color],[data-maker],#stm-maker-theme,#stm-maker-surface,#stm-maker-title,#stm-maker-collection',
                ),
            ]
                .filter((node) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName))
                .map((node) => [
                    node.dataset.makerColor ? `color:${node.dataset.makerColor}` : node.id || node.dataset.maker,
                    node.type === 'checkbox' ? node.checked : node.value,
                ]),
        );
    let dirty = false;
    const draftStatus = (text) => {
        q('[data-maker=draft-status]').textContent = text;
    };
    function saveDraft() {
        clearTimeout(saveTimer);
        if (!draftReady || !projectId) return persistence;
        // Capture mutable fields synchronously before close/switch clears the current view.
        const snapshot = {
            id: projectId,
            title: q('#stm-maker-title').value,
            tracks: structuredClone(tracks),
            sourceSettings: structuredClone(sourceSettings),
            assets: structuredClone(projectAssets),
            form: { ...formSnapshot(), 'stm-maker-collection': collectionId },
            runtimeVersion: PLAYER_BUILD,
            editRevision: revision,
        };
        recoveries.set(snapshot.id, snapshot);
        dirty = true;
        draftStatus('正在保存草稿…');
        persistence = persistence
            .catch(() => {})
            .then(async () => {
                const resources = await captureProjectResources(
                    snapshot.tracks,
                    {
                        imageId: snapshot.sourceSettings.backgroundId,
                        fontId:
                            snapshot.sourceSettings.fontPreset === 'custom'
                                ? snapshot.sourceSettings.fontId
                                : null,
                        ...snapshot.assets,
                    },
                    (id) => store.get(id),
                );
                snapshot.tracks = resources.tracks;
                snapshot.assets = {
                    imageBlob: resources.appearance.imageBlob,
                    fontBlob: resources.appearance.fontBlob,
                };
                const saved = await drafts.save(snapshot, draftRevisions.get(snapshot.id) || 0);
                draftRevisions.set(snapshot.id, saved.revision);
                if (recoveries.get(snapshot.id) === snapshot) recoveries.delete(snapshot.id);
                if (projectId === snapshot.id) {
                    if (revision === snapshot.editRevision || (!opened && recoveries.size === 0))
                        dirty = false;
                    projectAssets = snapshot.assets;
                    if (revision === snapshot.editRevision) {
                        for (const track of tracks) {
                            const savedTrack = snapshot.tracks.find((item) => item.id === track.id);
                            if (savedTrack?.exportBlob) track.exportBlob = savedTrack.exportBlob;
                            if (savedTrack?.exportCover) track.exportCover = savedTrack.exportCover;
                        }
                    }
                    draftStatus('草稿已保存 · 仅存于当前浏览器，请定期导出备份');
                }
                try {
                    localStorage.setItem('riserein:maker:last-project', snapshot.id);
                } catch {
                    /* optional */
                }
                await refreshProjects();
            })
            .catch((error) => {
                draftStatus(`未保存：${error.message}。请保持页面开启并重试；旧草稿未覆盖。`);
                throw error;
            });
        // Event handlers must not produce unhandled rejections on quota failures.
        void persistence.catch(() => {});
        return persistence;
    }
    function scheduleSave() {
        dirty = true;
        if (draftReady) {
            clearTimeout(saveTimer);
            draftStatus('有修改，等待自动保存…');
            saveTimer = setTimeout(() => {
                void saveDraft().catch(() => {});
            }, 400);
        }
    }
    async function refreshProjects() {
        const rows = await drafts.list();
        if (disposed) return;
        const select = q('#stm-maker-project');
        select.replaceChildren(...rows.map((row) => new Option(row.title || '未命名项目', row.id)));
        if (!rows.some((row) => row.id === projectId))
            select.append(new Option(q('#stm-maker-title').value || '新项目', projectId));
        select.value = projectId;
    }
    function applyDraft(project) {
        draftRevisions.set(project.id, project.revision ?? draftRevisions.get(project.id) ?? 0);
        lyricLookup.close();
        projectId = project.id;
        tracks = project.tracks;
        collectionId = project.form['stm-maker-collection'] || '';
        sourceSettings = project.sourceSettings;
        projectAssets = project.assets || {};
        for (const node of element.querySelectorAll('input,textarea,select')) {
            const key = node.dataset.makerColor ? `color:${node.dataset.makerColor}` : node.id || node.dataset.maker;
            const value = project.form[key] ?? (node.dataset.makerColor ? project.form[node.dataset.makerColor] : undefined);
            if (value === undefined || (node.type === 'color' && typeof value !== 'string')) continue;
            if (node.type === 'checkbox') node.checked = value;
            else node.value = value;
        }
        q('[data-maker=background]').disabled = !sourceSettings.backgroundId && !projectAssets.imageBlob;
        q('[data-maker=font-credit-label]').hidden = sourceSettings.fontPreset !== 'custom';
        edits();
        renderTracks();
        draftStatus(
            `已恢复草稿 · 上次制作端 ${project.runtimeVersion || '旧版'}；请重新检查并生成当前版脚本`,
        );
    }
    const showAnalysis = (report) => {
        q('[data-maker=analysis]').textContent =
            report.rows
                .map(
                    (row) =>
                        `${row.name}：${row.external ? '公开直链（不内嵌，远程大小未验证）' : formatBytes(row.bytes)}`,
                )
                .join('\n') +
            `\n内嵌二进制合计：${formatBytes(report.embeddedBytes)}\n${report.scriptBytes === null ? '脚本尚未构建' : `脚本 JSON：${formatBytes(report.scriptBytes)}；PNG 播放器部分约 ${formatBytes(report.pngPlayerBytes)}（保留双份数据时约 ${formatBytes(report.pngUncompactedPlayerBytes)}）`}\n${report.note}\n静态检查：${report.static === 'passed' ? '通过' : '失败'}；浏览器音频解码：${report.browser === 'passed' ? '通过（不等于实际播放）' : '未验证'}；真实酒馆：未验证\n${report.problems.join('\n')}`;
        q('.stm-maker-analysis').open = true;
    };
    let tracks = [],
        projectId,
        prepared = null,
        controller = null,
        revision = 0,
        collectionId = '',
        returnFocus,
        inert = [],
        busy = false,
        busyControls = [];
    const edits = () => {
        revision++;
        prepared = null;
        q('.stm-maker-downloads').hidden = true;
        status.textContent = '内容已修改，请重新检查资源。';
        scheduleSave();
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
        for (const key of ['accent', 'background', 'text'])
            q(`[data-maker-color=${key}]`).value = colors[key];
    }
    function appearance() {
        const colors = Object.fromEntries(
            ['accent', 'background', 'text'].map((key) => [key, q(`[data-maker-color=${key}]`).value]),
        );
        const font = FONT_PRESETS[sourceSettings.fontPreset];
        return {
            ...colors,
            surface: q('#stm-maker-surface').value,
            opacity: Number(q('[data-maker=opacity]').value) / 100,
            ...(q('[data-maker=background]').checked
                ? {
                      imageId: sourceSettings.backgroundId,
                      imageBlob: projectAssets.imageBlob,
                  }
                : {}),
            ...(q('[data-maker=font]').checked
                ? sourceSettings.fontPreset === 'custom'
                    ? { fontId: sourceSettings.fontId, fontBlob: projectAssets.fontBlob }
                    : font?.file
                      ? { fontFile: font.file }
                      : {}
                : {}),
            fontLicense: q('[data-maker=font-credit]').value,
            fontName: sourceSettings.fontPreset === 'custom' ? sourceSettings.fontName : font?.name || '',
            fontFamily:
                sourceSettings.fontPreset === 'kai'
                    ? 'KaiTi, serif'
                    : ['song', 'fang'].includes(sourceSettings.fontPreset)
                      ? 'serif'
                      : 'system-ui, sans-serif',
        };
    }
    function applyColors() {
        scheduleSave();
        if (!prepared) return;
        const { accent, background, text, surface, opacity } = appearance();
        prepared.config.appearance = {
            ...prepared.config.appearance,
            accent,
            background,
            text,
            surface,
            opacity,
        };
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
                delete track.lyricsSource;
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
            action('查找歌词', () => {
                lyricsProject = projectId;
                lyricLookup.open(track);
                q('[data-maker=lyrics-lookup]').scrollIntoView({ block: 'nearest' });
            });
            const lrc = document.createElement('input');
            lrc.type = 'file';
            lrc.accept = '.lrc,.txt,text/plain';
            lrc.hidden = true;
            action('导入 LRC / TXT', () => lrc.click());
            lrc.addEventListener('change', async () => {
                const currentProject = projectId;
                try {
                    const file = lrc.files[0];
                    if (!file) return;
                    if (!/\.(lrc|txt)$/i.test(file.name) || !file.size || file.size > 512 * 1024)
                        throw new Error('请选择 512 KB 以内的 LRC / TXT。');
                    const text = (await file.text()).replace(/^\uFEFF/, '').trim();
                    if (!text || text.length > MAX_LYRICS) throw new Error('歌词不能为空，最多 50000 字符。');
                    if (element.hidden || projectId !== currentProject || !tracks.includes(track)) return;
                    track.lyrics = text;
                    delete track.lyricsSource;
                    edits();
                    renderTracks();
                } catch (error) {
                    message(error.message);
                } finally {
                    lrc.value = '';
                }
            });
            detail.append(lrc);
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
                    const stamp = revision,
                        currentProject = projectId;
                    const image = await prepareCover(file);
                    if (
                        element.hidden ||
                        currentProject !== projectId ||
                        stamp !== revision ||
                        !tracks.includes(track)
                    )
                        return;
                    track.exportCover = image;
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
        collectionId = id || '';
        tracks = getQueue(settings, id).map((track) => ({ ...track }));
        if (!projectId) projectId = `rscp:${createTrackId()}`;
        q('#stm-maker-title').value =
            settings.playlists.find((list) => list.id === id)?.name ||
            (id ? settings.builtinCatalog.title : '我的音乐');
        edits();
        renderTracks();
    }
    function open() {
        if (opened || disposed) return;
        const previousProject = projectId,
            generation = ++openGeneration;
        opened = true;
        draftReady = false;
        projectId = `rscp:${createTrackId()}`;
        sourceSettings = Object.fromEntries(sourceKeys.map((key) => [key, structuredClone(settings[key])]));
        projectAssets = {};
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
        q('[data-maker=font]').checked = Boolean(
            settings.fontId || FONT_PRESETS[sourceSettings.fontPreset]?.file,
        );
        q('[data-maker=font-credit-label]').hidden = settings.fontPreset !== 'custom';
        q('[data-maker=opacity]').value = String(
            Math.round((settings.maskOpacity[settings.surface] ?? 0.65) * 100),
        );
        const select = q('#stm-maker-collection');
        select.replaceChildren(new Option('总曲库', ''));
        if (settings.builtinCatalog.tracks.length)
            select.append(new Option(settings.builtinCatalog.title, BUILTIN_ID));
        for (const list of settings.playlists) select.append(new Option(list.name, list.id));
        select.value = getCollectionId() || '';
        chooseCollection();
        dirty = false;
        q('[data-maker=close]').focus();
        const stamp = revision;
        setBusy(true);
        draftStatus('正在恢复制作项目…');
        void (async () => {
            await persistence.catch(() => {});
            const rows = await drafts.list();
            let last;
            try {
                last = localStorage.getItem('riserein:maker:last-project');
            } catch {
                /* optional */
            }
            if (disposed || element.hidden || generation !== openGeneration) return;
            if (stamp !== revision) {
                draftReady = true;
                scheduleSave();
                return;
            }
            const recovered = recoveries.get(previousProject);
            const project = recovered || rows.find((row) => row.id === last) || rows[0];
            if (project) applyDraft(project);
            draftReady = true;
            await refreshProjects();
            if (!project) await saveDraft();
            if (recovered) {
                dirty = true;
                draftStatus('上次草稿未保存，已恢复当前页面内的编辑。请复制项目或导出备份后重试保存。');
            } else dirty = false;
        })()
            .catch((error) => {
                draftReady = true;
                draftStatus(`草稿恢复失败：${error.message}。请勿关闭尚未导出的内容。`);
            })
            .finally(() => {
                if (generation === openGeneration && !element.hidden) {
                    setBusy(false);
                    q('[data-maker=background]').disabled =
                        !sourceSettings.backgroundId && !projectAssets.imageBlob;
                }
            });
    }
    function close() {
        if (!opened) return;
        void saveDraft().catch(() => {});
        opened = false;
        openGeneration++;
        draftReady = false;
        revision++;
        controller?.abort();
        lyricLookup.close();
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
            const controls = [
                ...element.querySelectorAll('button,input,select,textarea,summary,iframe'),
            ].filter((node) => !node.disabled && node.getClientRects().length);
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
    async function projectTransition(change) {
        const generation = openGeneration;
        setBusy(true);
        try {
            await change(() => generation === openGeneration && !element.hidden);
        } finally {
            if (generation === openGeneration && !element.hidden) {
                setBusy(false);
                q('[data-maker=background]').disabled =
                    !sourceSettings.backgroundId && !projectAssets.imageBlob;
            }
        }
    }
    q('#stm-maker-collection').addEventListener('change', () =>
        projectTransition(async (active) => {
            // Preserve the old project rather than overwriting it with another collection.
            try {
                await saveDraft();
                if (!active()) return;
                projectId = `rscp:${createTrackId()}`;
                chooseCollection();
            } catch {
                /* Keep unsaved edits visible. */
            }
        }),
    );
    q('#stm-maker-title').addEventListener('input', edits);
    q('#stm-maker-theme').addEventListener('change', (event) => {
        chooseColors(event.target.value === 'current' ? palette() : CARD_THEMES[event.target.value]);
        applyColors();
    });
    for (const control of element.querySelectorAll(
        '[data-maker-color],[data-maker=opacity],#stm-maker-surface',
    ))
        control.addEventListener('input', applyColors);
    for (const name of ['background', 'font', 'collapsed', 'font-credit'])
        q(`[data-maker=${name}]`).addEventListener('change', edits);
    q('[data-maker=font-credit]').addEventListener('input', edits);
    q('[data-maker=add]').addEventListener('click', () => q('[data-maker-file=audio]').click());
    async function enrichTrack(track) {
        const id = projectId,
            initialTitle = track.title;
        try {
            const metadata = await readEmbeddedMetadata(track.exportBlob);
            const image = metadata.cover ? await prepareCover(metadata.cover) : null;
            if (element.hidden || id !== projectId || !tracks.includes(track)) return;
            if (track.title === initialTitle && metadata.title) track.title = metadata.title;
            if (!track.artist && metadata.artist) track.artist = metadata.artist;
            if (!track.lyrics && metadata.lyrics) track.lyrics = metadata.lyrics;
            if (!track.exportCover && !track.coverId && image) track.exportCover = image;
            edits();
            renderTracks();
        } catch (error) {
            if (id === projectId && !element.hidden)
                message(`音频已添加；内嵌信息读取失败，可手动编辑：${error.message}`);
        }
    }
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
                void enrichTrack(tracks.at(-1));
            } catch (error) {
                errors.push(`${file.name}：${error.message}`);
            }
        }
        event.target.value = '';
        edits();
        renderTracks();
        if (errors.length) message(errors.join('\n'));
    });
    async function prepare(validateAudio = true) {
        controller?.abort();
        controller = new AbortController();
        const own = controller,
            stamp = ++revision;
        prepared = null;
        q('.stm-maker-downloads').hidden = true;
        q('.stm-maker-preview').srcdoc = '';
        q('.stm-maker-preview').hidden = true;
        setBusy(true);
        q('[data-maker=analysis]').textContent = '';
        pausePlayback();
        try {
            const result = await prepareCardPackage(
                {
                    id: projectId,
                    title: q('#stm-maker-title').value,
                    tracks,
                    appearance: appearance(),
                    volume: sourceSettings.volume,
                    mode: sourceSettings.mode,
                    startCollapsed: q('[data-maker=collapsed]').checked,
                },
                {
                    getBlob: (id) => store.get(id),
                    readFallback: async (index, signal) =>
                        prepareCover(await fetchBlob(fallbackCoverUrl(index), signal)),
                    readPublicImage: (url, signal) => {
                        const safe = publicResource(url);
                        if (!safe) throw new Error('封面地址不能公开分发，请替换封面或使用内置封面。');
                        return fetchBlob(safe, signal, { maxBytes: 10 * 1024 * 1024 }).then(prepareCover);
                    },
                    readFont: (file, signal) =>
                        fetchBlob(new URL(`./assets/fonts/${file}`, import.meta.url), signal),
                    readFontLicense: async (file, signal) => {
                        const licenses = {
                            'PoxiaoPixel.woff2': ['OFL-PoxiaoPixel.txt'],
                            'ChildFunSans.woff2': ['OFL-ChildFunSans.txt'],
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
                    probeAudio: validateAudio ? probeAudio : async () => {},
                    onResource: (row) => {
                        q('[data-maker=analysis]').textContent += `\n${row.name}：${formatBytes(row.bytes)}`;
                        q('.stm-maker-analysis').open = true;
                    },
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
            showAnalysis({
                ...files.analysis,
                browser: validateAudio ? 'passed' : 'not-tested',
            });
            if (!validateAudio) {
                prepared = null;
                message('容量分析完成，尚未试听；请检查资源并生成预览后再导出。');
                return;
            }
            q('.stm-maker-preview').srcdoc = files.preview;
            q('.stm-maker-preview').hidden = false;
            q('.stm-maker-downloads').hidden = false;
            message(
                `检查通过：${result.config.tracks.length} 首，内嵌资源 ${(result.embeddedBytes / 1024 / 1024).toFixed(1)} MB，${result.linkedTracks} 首使用公开直链。请在下方点播放试听，再导出角色卡。`,
            );
        } catch (error) {
            if (!own.signal.aborted && stamp === revision) {
                message(error.message);
                q('[data-maker=analysis]').textContent +=
                    `\n静态检查失败：${error.message}\n浏览器播放与真实酒馆：未验证。未生成或覆盖导出文件。`;
                q('.stm-maker-analysis').open = true;
            }
        } finally {
            if (controller === own) setBusy(false);
        }
    }
    q('[data-maker=prepare]').addEventListener('click', () => prepare(true));
    q('[data-maker=analyze]').addEventListener('click', () => {
        q('[data-maker=analysis]').textContent = '';
        void prepare(false);
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
        const report = verifyCardObject(JSON.parse(text), {
            script: all.script,
            characterData: output.data,
        });
        showAnalysis({ ...report, browser: 'passed' });
        download((output.data.name || baseName()).replace(/[\\/:*?"<>|]/g, '_') + '.含音乐.json', text);
        message('已导出含播放器的角色卡 JSON。导入该文件后，在酒馆助手中允许并启用角色脚本即可播放。');
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
            if (file.size > 60 * 1024 * 1024)
                throw new Error('角色卡 JSON 超过 60 MB，请先减少原有内嵌资源。');
            const currentProject = projectId,
                currentPrepared = prepared;
            const json = JSON.parse(await file.text());
            if (element.hidden || projectId !== currentProject || prepared !== currentPrepared)
                throw new Error('读取角色卡期间制作项目已改变，请重新选择文件。');
            exportCard(json);
        } catch (error) {
            message(error instanceof SyntaxError ? '所选文件不是有效的角色卡 JSON。' : error.message);
        } finally {
            event.target.value = '';
        }
    });
    q('#stm-maker-project').addEventListener('change', (event) => {
        const id = event.target.value;
        void projectTransition(async (active) => {
            try {
                await saveDraft();
                const project = await drafts.get(id);
                if (project && active()) {
                    applyDraft(project);
                    await refreshProjects();
                }
            } catch (error) {
                draftStatus(`项目未切换：${error.message}`);
            }
        }).catch((error) => draftStatus(error.message));
    });
    for (const name of ['project-new', 'project-copy', 'project-delete'])
        action(name, () =>
            projectTransition(async (active) => {
                if (
                    name === 'project-delete' &&
                    !window.confirm('只删除当前制作草稿，不影响曲库、歌单和已导出的角色卡。确定删除？')
                )
                    return;
                if (name !== 'project-copy') await saveDraft();
                if (!active()) return;
                if (name === 'project-copy') {
                    // Also works after a multi-tab save conflict: duplicate the visible edits,
                    // not the other tab's last saved version.
                    clearTimeout(saveTimer);
                    await persistence.catch(() => {});
                    const resources = await captureProjectResources(
                        structuredClone(tracks),
                        {
                            imageId: sourceSettings.backgroundId,
                            fontId: sourceSettings.fontPreset === 'custom' ? sourceSettings.fontId : null,
                            ...projectAssets,
                        },
                        (id) => store.get(id),
                    );
                    const project = {
                        title: q('#stm-maker-title').value,
                        tracks: resources.tracks,
                        sourceSettings: structuredClone(sourceSettings),
                        assets: {
                            imageBlob: resources.appearance.imageBlob,
                            fontBlob: resources.appearance.fontBlob,
                        },
                        form: formSnapshot(),
                        runtimeVersion: PLAYER_BUILD,
                    };
                    project.id = `rscp:${createTrackId()}`;
                    project.title += ' · 副本';
                    project.form['stm-maker-title'] = project.title;
                    const saved = await drafts.save(project);
                    applyDraft(saved);
                } else {
                    if (name === 'project-delete') {
                        await drafts.delete(projectId, draftRevisions.get(projectId));
                        recoveries.delete(projectId);
                        draftReady = false;
                        const remaining = await drafts.list();
                        if (remaining.length) {
                            applyDraft(remaining[0]);
                            draftReady = true;
                            await refreshProjects();
                            return;
                        }
                    }
                    projectId = `rscp:${createTrackId()}`;
                    projectAssets = {};
                    sourceSettings = Object.fromEntries(
                        sourceKeys.map((key) => [key, structuredClone(settings[key])]),
                    );
                    chooseCollection();
                    draftReady = true;
                    await saveDraft();
                }
                await refreshProjects();
            }),
        );
    action('verify-file', () => q('[data-maker-file=verify]').click());
    q('[data-maker-file=verify]').addEventListener('change', async (event) => {
        try {
            const file = event.target.files[0];
            if (!file) return;
            const report = await verifyCardFile(file, /\.png$/i.test(file.name) ? 'png' : 'json');
            showAnalysis(report);
            message(
                `文件静态检查通过：${report.tracks} 首，${formatBytes(file.size)}。此检查不代表已试听或已通过真实酒馆验收。`,
            );
        } catch (error) {
            message(`核对失败：${error.message}`);
        } finally {
            event.target.value = '';
        }
    });
    const onPageHide = () => {
        void saveDraft().catch(() => {});
    };
    window.addEventListener('pagehide', onPageHide);
    const onBeforeUnload = (event) => {
        if (dirty) {
            event.preventDefault();
            event.returnValue = '';
        }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return {
        open,
        close,
        flush: saveDraft,
        dispose() {
            close();
            disposed = true;
            clearTimeout(saveTimer);
            lyricLookup.dispose();
            menus.dispose();
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('beforeunload', onBeforeUnload);
            void persistence.catch(() => {}).then(() => drafts.dispose());
            element.remove();
        },
    };
}
