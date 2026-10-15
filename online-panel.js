import { PLATFORM_NAMES } from './platforms/catalog.js';
import { fallbackCoverUrl } from './media.js';
import { playSymbol } from './player-components.js';
import { verifyPlayback } from './platforms/diagnostics.js';
export const ONLINE_MARKUP = `
<div class="stm-import-tabs" role="tablist" aria-label="音乐导入方式">
<button type="button" role="tab" data-online-mode="local" aria-selected="true" aria-controls="stm-direct-import">本地与直链</button>
<button type="button" role="tab" data-online-mode="search" aria-selected="false" aria-controls="stm-online-search">在线搜索</button>
<button type="button" role="tab" data-online-mode="share" aria-selected="false" aria-controls="stm-online-share">分享链接</button></div>
<section id="stm-online-search" data-online-view="search" role="tabpanel" aria-label="在线搜索" hidden>
<p class="stm-hint">只显示已接入搜索的来源。Openverse 是公开许可音频库，包含音乐与环境声，歌曲会保留来源和许可。</p>
<form class="stm-search-form"><label for="stm-online-platform">搜索来源</label><select id="stm-online-platform"></select><label class="stm-sr-only" for="stm-online-query">搜索歌曲或歌手</label><div class="stm-inline-form"><input id="stm-online-query" placeholder="歌曲、歌手或关键词" maxlength="160" required><button type="submit" class="stm-secondary">搜索</button></div></form>
<ol class="stm-online-results" aria-label="在线搜索结果"></ol><button type="button" class="stm-secondary" data-online-action="more" hidden>加载更多</button></section>
<section id="stm-online-share" data-online-view="share" role="tabpanel" aria-label="分享链接导入" hidden>
<form class="stm-share-form"><label for="stm-share-text">粘贴歌曲或歌单分享文本</label><textarea id="stm-share-text" rows="3" maxlength="4096" placeholder="可以粘贴整段分享文字，我们会提取链接。" required></textarea><button type="submit" class="stm-secondary">读取并预览</button></form>
<p class="stm-hint">识别链接与读取歌单是不同能力。未接入的平台歌曲可以保存来源书签；未读全的歌单不会导入。</p>
<div class="stm-share-preview" hidden><div class="stm-details-summary"><img data-online="preview-cover" alt="歌单封面" class="stm-collection-cover"><div><strong data-online="preview-title"></strong><small data-online="preview-count"></small></div></div>
<p class="stm-hint" data-online="preview-warning"></p><label data-online="reference-name" hidden>歌曲名称（可自行修改）<input id="stm-share-title" maxlength="160"></label>
<label class="stm-check-label" data-online="new-list-label" hidden><input type="checkbox" id="stm-share-new-list">按原顺序创建歌单（重复导入会复用原歌单）</label><label data-online="list-name" hidden>歌单名称<input id="stm-share-list-name" maxlength="80"></label>
<div class="stm-import-selection" hidden><p class="stm-hint">勾选要导入的歌曲；未勾选的不会导入。歌曲顺序保持原歌单顺序。</p><div><button type="button" class="stm-secondary" data-online-action="select-all">全选</button><button type="button" class="stm-secondary" data-online-action="select-playable">只选可直接播放</button><button type="button" class="stm-secondary" data-online-action="select-fit">按剩余容量选择</button><button type="button" class="stm-secondary" data-online-action="select-none">清空选择</button></div><p class="stm-hint" data-online="selection-count" aria-live="polite"></p></div>
<ol class="stm-share-tracks" aria-label="分享链接导入预览"></ol><button type="button" class="stm-primary" data-online-action="confirm">确认导入</button></div><button type="button" class="stm-secondary" data-online-action="official-list" hidden>打开官方播放器（不导入曲目）</button><div data-online="official-list-player" hidden></div></section>
<div class="stm-online-feedback" hidden><p class="stm-hint" data-online="status" role="status" aria-live="polite"></p><button type="button" class="stm-secondary" data-online-action="cancel" hidden>取消请求</button></div>`;
export function createOnlinePanel({ panel, service, menus, getTarget, hasTrack, getCapacity, onSave, onPlay, onEmbed, openOfficialList, closeOfficialList, onState, showStatus }) {
    const query = (selector) => panel.querySelector(selector);
    const status = query('[data-online="status"]');
    const modeButtons = [...panel.querySelectorAll('[data-online-mode]')];
    const results = query('.stm-online-results');
    const selector = query('#stm-online-platform');
    selector.append(new Option('全部可用来源', 'all'));
    for (const item of service.platforms().filter((item) => item.capabilities.search))
        selector.append(new Option(item.name, item.id));
    menus.refresh();
    const previewImage = query('[data-online="preview-cover"]');
    previewImage.addEventListener('error', () => {
        const fallback = fallbackCoverUrl(0);
        if (previewImage.src !== fallback) previewImage.src = fallback;
    });
    let controller = null,
        revision = 0,
        preview = null,
        tracks = [],
        nextPages = {},
        lastQuery = '',
        lastPlatform = '',
        lastStarted = 0;
    let selected = new Set(), probeController;
    const playbackLabel = track => service.canPlay(track) ? '可直接播放' : service.canEmbed(track) ? '官方播放器 · 可能仅试听' : track.restriction === 'authorization' ? '需要平台授权 · 当前仅保存来源' : track.restriction === 'license' ? '许可或音源不可用 · 仅保存来源' : '暂时只能保存来源';
    function selectionCount() {
        const items = preview?.tracks.filter((_, index) => selected.has(index)) || [];
        const newIds = new Set(items.filter(track => !hasTrack(track.id)).map(track => track.id));
        query('[data-online="selection-count"]').textContent = `已选 ${items.length} / ${preview?.total || 0} 首 · 新增 ${newIds.size} 首 · 曲库剩余 ${getCapacity()} 个位置${newIds.size > getCapacity() ? '，超出容量，请减少勾选后再确认' : ''}`;
    }
    const message = (text, error = false) => {
        status.textContent = text;
        status.classList.toggle('stm-error', error);
        query('.stm-online-feedback').hidden = !text;
    };
    function busy(value) {
        for (const form of [query('.stm-search-form'), query('.stm-share-form')])
            form.querySelector('button[type="submit"]').disabled = value;
        query('[data-online-action="cancel"]').hidden = !value;
        query('[data-online-action="more"]').disabled = value;
    }
    function cancel(notify = false) {
        probeController?.abort();
        closeOfficialList();
        if (controller) {
            controller.abort();
            controller = null;
            revision++;
            busy(false);
            if (notify) message('已取消请求。');
        }
    }
    modeButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            cancel();
            const mode = button.dataset.onlineMode;
            query('#stm-direct-import').hidden = mode !== 'local';
            for (const view of panel.querySelectorAll('[data-online-view]'))
                view.hidden = view.dataset.onlineView !== mode;
            for (const other of modeButtons) {
                const active = other === button;
                other.setAttribute('aria-selected', String(active));
                other.tabIndex = active ? 0 : -1;
            }
            query('.stm-online-feedback').hidden = mode === 'local' || !status.textContent;
        });
        button.addEventListener('keydown', (event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next =
                    event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                modeButtons[next].click();
                modeButtons[next].focus();
            }
        });
    });
    function rows(target, items, previewOnly = false) {
        target.replaceChildren();
        for (const [index, track] of items.entries()) {
            const row = document.createElement('li');
            row.className = 'stm-online-result';
            const image = document.createElement('img');
            image.alt = '';
            image.loading = 'lazy';
            image.src = track.cover || fallbackCoverUrl(0);
            image.addEventListener(
                'error',
                () => {
                    image.src = fallbackCoverUrl(0);
                },
                { once: true },
            );
            const info = document.createElement('div');
            info.className = 'stm-online-info';
            const name = document.createElement('strong');
            name.textContent = track.title;
            const detail = document.createElement('small');
            detail.textContent = [
                track.artist,
                PLATFORM_NAMES[track.platform],
                track.duration
                    ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}`
                    : '',
                playbackLabel(track),
            ]
                .filter(Boolean)
                .join(' · ');
            info.append(name, detail);
            if (track.license) {
                const credit = document.createElement('a');
                credit.className = 'stm-hint';
                credit.href = track.license.url || track.license.sourceUrl;
                credit.target = '_blank';
                credit.rel = 'noopener noreferrer';
                credit.textContent = track.license.attribution;
                info.append(credit);
            }
            const source = document.createElement('a');
            source.href = track.sourceUrl;
            source.target = '_blank';
            source.rel = 'noopener noreferrer';
            source.textContent = '来源';
            source.className = 'stm-online-source';
            source.setAttribute('aria-label', `在官方平台查看：${track.title}`);
            info.append(source);
            row.append(image, info);
            if (previewOnly && preview?.type === 'playlist') {
                const label = document.createElement('label'); label.className = 'stm-check-label';
                const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(index);
                checkbox.setAttribute('aria-label', `选择导入：${track.title}`);
                checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(index) : selected.delete(index); selectionCount(); });
                label.append(checkbox); row.prepend(label);
            }
            if (!previewOnly) {
                if (service.canPlay(track)) {
                    const play = document.createElement('button');
                    play.type = 'button';
                    play.className = 'stm-row-play';
                    play.dataset.trackToggle = track.id;
                    play.dataset.trackTitle = track.title;
                    play.setAttribute('aria-label', `播放歌曲：${track.title}`);
                    play.innerHTML = playSymbol(false);
                    play.addEventListener('click', () => {
                        void onPlay(track).catch((error) => message(error.message, true));
                    });
                    row.append(play);
                    const check = document.createElement('button'); check.type = 'button'; check.className = 'stm-secondary stm-probe'; check.textContent = '检查播放';
                    check.setAttribute('aria-label', `检查真实播放：${track.title}`);
                    check.addEventListener('click', async () => {
                        probeController?.abort(); probeController = new AbortController();
                        const activeProbe = probeController; check.disabled = true; message('正在检查实际播放…');
                        try {
                            const result = await verifyPlayback(query('audio'), () => onPlay(track, true), { signal: activeProbe.signal });
                            if (!activeProbe.signal.aborted) message(`真实播放已通过：进度已前进至 ${result.elapsed.toFixed(1)} 秒。请同时确认设备能听到声音；这不保证其他歌曲或其他网络也可播放。`);
                        } catch (error) { if (error.name !== 'AbortError') message(error.message, true); }
                        finally { check.disabled = false; }
                    }); row.append(check);
                } else if (service.canEmbed(track)) {
                    const embed = document.createElement('button'); embed.type = 'button'; embed.className = 'stm-secondary'; embed.textContent = '官方播放器';
                    embed.addEventListener('click', () => onEmbed(track)); row.append(embed);
                }
                const add = document.createElement('button');
                add.type = 'button';
                add.className = 'stm-secondary';
                add.textContent = hasTrack(track.id) ? '加入歌单' : '加入';
                add.setAttribute('aria-label', `加入曲库或歌单：${track.title}`);
                add.addEventListener('click', () => {
                    try {
                        const added = onSave(
                            { type: 'track', complete: true, total: 1, tracks: [track], name: track.title },
                            { targetId: getTarget() },
                        );
                        showStatus(added);
                        rows(results, tracks);
                    } catch (error) {
                        message(error.message, true);
                    }
                });
                row.append(add);
            }
            target.append(row);
        }
        onState();
    }
    async function search(more = false) {
        const term = query('#stm-online-query').value.trim(),
            platform = selector.value;
        if (!more && term === lastQuery && platform === lastPlatform && Date.now() - lastStarted < 600) return;
        cancel();
        controller = new AbortController();
        const active = controller,
            turn = ++revision;
        busy(true);
        message(more ? '正在读取更多结果…' : '正在搜索…');
        lastStarted = Date.now();
        if (!more) {
            tracks = [];
            nextPages = {};
            results.replaceChildren();
            query('[data-online-action="more"]').hidden = true;
            lastQuery = term;
            lastPlatform = platform;
        }
        try {
            const result = await service.search(term, {
                platform,
                signal: active.signal,
                pages: more ? nextPages : {},
            });
            if (turn !== revision) return;
            const seen = new Set(tracks.map((track) => track.id));
            tracks.push(...result.tracks.filter((track) => !seen.has(track.id) && seen.add(track.id)));
            nextPages = result.nextPages;
            rows(results, tracks);
            query('[data-online-action="more"]').hidden = !Object.keys(nextPages).length;
            message(
                [
                    tracks.length ? `找到 ${tracks.length} 首音频。` : result.errors.length ? '暂时无法读取所选来源，请稍后重试或换一个来源。' : '没有找到音频，请尝试其他关键词。',
                    ...result.errors.map((error) => `${PLATFORM_NAMES[error.platform]}：${error.message}`),
                ].join(' '),
                Boolean(result.errors.length),
            );
        } catch (error) {
            if (turn === revision && error.name !== 'AbortError') message(error.message, true);
        } finally {
            if (turn === revision) {
                controller = null;
                busy(false);
            }
        }
    }
    query('.stm-search-form').addEventListener('submit', (event) => {
        event.preventDefault();
        void search();
    });
    query('[data-online-action="more"]').addEventListener('click', () => {
        void search(true);
    });
    query('.stm-share-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        cancel();
        preview = null;
        query('.stm-share-preview').hidden = true;
        controller = new AbortController();
        const active = controller,
            turn = ++revision;
        busy(true);
        message('正在识别分享链接…');
        try {
            const result = await service.preview(query('#stm-share-text').value, {
                signal: active.signal,
                onProgress: (count) => {
                    if (turn === revision) message(`已读取 ${count} 首，正在继续读取歌单…`);
                },
            });
            if (turn !== revision) return;
            preview = result;
            selected = new Set(result.tracks.map((_, index) => index));
            query('[data-online="preview-title"]').textContent =
                result.tracks[0]?.metadataStatus === 'reference'
                    ? `${PLATFORM_NAMES[result.platform]} · 来源书签`
                    : `${PLATFORM_NAMES[result.platform]} · ${result.name}`;
            query('[data-online="preview-cover"]').src = result.cover || result.tracks[0]?.cover || fallbackCoverUrl(0);
            const full = result.tracks.filter((track) => service.canPlay(track)).length;
            query('[data-online="preview-count"]').textContent =
                `${result.source?.author ? `作者：${result.source.author} · ` : ''}共 ${result.total} 首 · 可导入 ${result.tracks.length} 首 · 站内播放 ${full} 首 · 站外或受限 ${result.tracks.length - full} 首${result.tracks.some(track => service.canEmbed(track)) ? '（含官方嵌入播放器，未承诺完整播放）' : ''}`;
            query('[data-online="preview-warning"]').textContent =
                result.warning || '导入仅保存歌曲信息，不下载音乐；站内播放仍取决于来源当时的可用性。';
            const reference = result.tracks.length === 1 && result.tracks[0].metadataStatus === 'reference';
            query('[data-online="reference-name"]').hidden = !reference;
            query('#stm-share-title').value = result.tracks[0]?.title || '';
            const list = result.type === 'playlist';
            query('.stm-import-selection').hidden = !list;
            selectionCount();
            query('[data-online="new-list-label"]').hidden = !list;
            query('[data-online="list-name"]').hidden = !list;
            query('#stm-share-new-list').checked = list;
            query('#stm-share-list-name').value = result.name;
            rows(query('.stm-share-tracks'), result.tracks, true);
            query('.stm-share-preview').hidden = false;
            message('请核对预览后确认导入。');
        } catch (error) {
            if (turn === revision && error.name !== 'AbortError') {
                message(error.message, true);
                query('[data-online-action="official-list"]').hidden = !service.officialEmbed(query('#stm-share-text').value);
            }
        } finally {
            if (turn === revision) {
                controller = null;
                busy(false);
            }
        }
    });
    query('#stm-share-text').addEventListener('input', () => {
        cancel();
        preview = null;
        query('.stm-share-preview').hidden = true;
        query('[data-online-action="official-list"]').hidden = true;
        message('');
    });
    query('#stm-share-new-list').addEventListener('change', (event) => {
        query('[data-online="list-name"]').hidden = !event.target.checked;
    });
    query('[data-online-action="confirm"]').addEventListener('click', () => {
        if (!preview) return;
        try {
            if (preview.tracks[0]?.metadataStatus === 'reference')
                preview.tracks[0].title = query('#stm-share-title').value.trim() || preview.tracks[0].title;
            const items = preview.tracks.filter((_, index) => selected.has(index));
            if (!items.length) throw new Error('请至少选择一首歌曲。');
            const summary = onSave({ ...preview, tracks: items, total: items.length,
                source: { ...preview.source, total: preview.total } }, {
                targetId: getTarget(),
                newPlaylist: preview.type === 'playlist' && query('#stm-share-new-list').checked,
                name: query('#stm-share-list-name').value,
            });
            selectionCount();
            message(`${items.length < preview.total ? `已按你的选择导入 ${items.length} / ${preview.total} 首。` : ''}${summary}`);
            showStatus(summary);
        } catch (error) {
            message(error.message, true);
        }
    });
    query('[data-online-action="cancel"]').addEventListener('click', () => cancel(true));
    for (const mode of ['all', 'playable', 'none', 'fit']) query(`[data-online-action="select-${mode}"]`).addEventListener('click', () => {
        if (!preview) return;
        let remaining = getCapacity(); const newIds = new Set();
        selected = new Set();
        preview.tracks.forEach((track, index) => {
            let choose = mode === 'all' || (mode === 'playable' && service.canPlay(track));
            if (mode === 'fit') {
                choose = hasTrack(track.id) || newIds.has(track.id) || remaining > 0;
                if (choose && !hasTrack(track.id) && !newIds.has(track.id)) { remaining--; newIds.add(track.id); }
            }
            if (choose) selected.add(index);
        });
        rows(query('.stm-share-tracks'), preview.tracks, true); selectionCount();
    });
    query('[data-online-action="official-list"]').addEventListener('click', () => openOfficialList(query('#stm-share-text').value));
    return {
        cancel,
        dispose() {
            cancel();
        },
    };
}
