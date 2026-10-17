import { FONT_PRESETS, MAX_FONTS, validateFontFile, decodeFont, loadBuiltinFont } from './fonts.js';

/** A scoped, keyboard-accessible picker. Preview faces stay loaded while browsing. */
export function createFontPicker({ panel, launcher, store, settings, save, showStatus, createId, availableFonts, retireAssets }) {
    const query = selector => panel.querySelector(selector);
    const toggle = query('#stm-font');
    const gallery = query('#stm-font-gallery');
    const status = query('[data-role="font-status"]');
    const input = query('[data-role="font-file"]');
    const importButton = query('[data-action="import-font"]');
    const cache = new Map();
    const faces = new Set();
    let revision = 0;
    let importing = false;
    let disposed = false;
    const selectedKey = () => settings.fontPreset === 'custom' ? settings.fontId : settings.fontPreset;
    const entries = () => [
        ...Object.entries(FONT_PRESETS).filter(([id, preset]) => id !== 'custom' && (!preset.file || !availableFonts || availableFonts.includes(preset.file))).map(([id, preset]) => ({ id, ...preset })),
        ...settings.fonts.map(font => ({ ...font, local: true })),
    ];
    const entryFor = id => entries().find(entry => entry.id === id);
    const fontFamily = entry => entry.id === 'inherit' ? getComputedStyle(panel.parentElement).fontFamily
        : entry.local ? `"stm-font-${entry.id.replace(/[^a-f0-9]/g, '')}", serif` : entry.family;

    function load(entry) {
        if (!entry.local && !entry.file) return Promise.resolve(null);
        if (!cache.has(entry.id)) {
            const promise = (async () => {
                let face;
                if (entry.local) {
                    const blob = await store.get(entry.id);
                    if (!blob) throw new Error('这款字体不在当前浏览器中，请重新导入。');
                    face = await decodeFont(blob, entry.id);
                } else face = await loadBuiltinFont(entry.id);
                if (disposed || (entry.local && !settings.fonts.some(font => font.id === entry.id))) return null;
                faces.add(face); document.fonts.add(face);
                return face;
            })().catch(error => { cache.delete(entry.id); throw error; });
            cache.set(entry.id, promise);
        }
        return cache.get(entry.id);
    }

    function renderSelection() {
        const key = selectedKey();
        const current = entryFor(key) || entryFor('inherit');
        toggle.querySelector('strong').textContent = current.name;
        toggle.dataset.fontChoice = key;
        for (const row of gallery.children) {
            const button = row.querySelector('[role="radio"]');
            const selected = button.dataset.fontChoice === key;
            button.setAttribute('aria-checked', String(selected));
            button.tabIndex = selected ? 0 : -1;
        }
    }

    function apply(entry, face) {
        const family = face ? `"${face.family}", serif` : entry.family || 'inherit';
        for (const element of [panel, launcher]) element.style.setProperty('--stm-font-family', family);
        renderSelection();
    }

    async function choose(entry, persist = true) {
        const turn = ++revision;
        status.textContent = `正在加载：${entry.name}…`;
        toggle.setAttribute('aria-busy', 'true');
        try {
            const face = await load(entry);
            if (disposed || turn !== revision) return;
            if (entry.local && !settings.fonts.some(font => font.id === entry.id)) return;
            settings.fontPreset = entry.local ? 'custom' : entry.id;
            if (entry.local) { settings.fontId = entry.id; settings.fontName = entry.name; }
            apply(entry, face);
            if (persist) save();
            status.textContent = entry.local ? `当前使用：${entry.name} · 仅保存在当前浏览器。`
                : entry.file ? `${entry.original} · 完整字库已内置，可离线使用。`
                    : '设备字体以实际显示为准；未安装时由系统回退。内置字体在各设备上均可使用。';
        } catch (error) {
            if (turn !== revision || disposed) return;
            // Failed selections retain the previous face and saved choice.
            status.textContent = `${entry.name}加载失败：${error.message || '请检查字体文件是否完整。'}`;
        } finally { if (turn === revision) toggle.removeAttribute('aria-busy'); }
    }

    async function preview(row) {
        const entry = entryFor(row.dataset.fontId);
        if (!entry) return;
        const sample = row.querySelector('.stm-font-sample');
        const caption = row.querySelector('.stm-font-caption');
        try {
            await load(entry);
            if (disposed || !row.isConnected) return;
            sample.style.fontFamily = fontFamily(entry);
            sample.hidden = false;
            caption.classList.add('stm-sr-only');
            caption.textContent = entry.local ? '本地字体' : entry.file ? '内置字体' : '设备字体 · 未安装会回退';
            row.querySelector('[role="radio"]').title = caption.textContent;
            row.dataset.preview = 'ready';
        } catch {
            if (!row.isConnected) return;
            // Never present a fallback font as this face's preview.
            sample.hidden = true;
            caption.classList.remove('stm-sr-only');
            caption.textContent = `${entry.name} · 加载失败，点选重试`;
            row.dataset.preview = 'error';
        }
    }

    const observer = new IntersectionObserver(records => {
        for (const record of records) if (record.isIntersecting && !gallery.hidden) {
            observer.unobserve(record.target);
            void preview(record.target);
        }
    }, { root: gallery, rootMargin: '60px' });

    async function remove(entry) {
        if (importing) return;
        try { if (!retireAssets) await store.delete(entry.id); }
        catch { showStatus('字体删除失败，请重试。', true); return; }
        settings.fonts = settings.fonts.filter(font => font.id !== entry.id);
        if (settings.fontId === entry.id) {
            settings.fontId = null; settings.fontName = '';
            if (settings.fontPreset === 'custom') {
                ++revision; settings.fontPreset = 'inherit';
                apply(entryFor('inherit'), null);
                toggle.removeAttribute('aria-busy');
            }
        }
        const face = await cache.get(entry.id)?.catch(() => null);
        if (face) { document.fonts.delete(face); faces.delete(face); }
        cache.delete(entry.id);
        retireAssets?.([entry.id]);
        save(); renderList();
        status.textContent = `已移除：${entry.name}。其他字体保留。`;
        gallery.querySelector('[aria-checked="true"]')?.focus();
    }

    function renderList() {
        observer.disconnect(); gallery.replaceChildren();
        for (const entry of entries()) {
            const row = document.createElement('div');
            row.className = 'stm-font-row'; row.dataset.fontId = entry.id;
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'stm-font-choice';
            button.setAttribute('role', 'radio'); button.setAttribute('aria-label', entry.name);
            button.dataset.fontChoice = entry.id;
            const caption = document.createElement('small'); caption.className = 'stm-font-caption'; caption.textContent = `${entry.name} · 加载中`;
            const sample = document.createElement('span'); sample.className = 'stm-font-name stm-font-sample'; sample.hidden = true;
            sample.textContent = entry.name;
            button.append(sample, caption);
            button.addEventListener('click', () => { void preview(row); void choose(entry); });
            row.append(button);
            if (entry.local) {
                const trash = document.createElement('button'); trash.type = 'button'; trash.className = 'stm-font-delete';
                trash.setAttribute('aria-label', `删除字体：${entry.name}`); trash.textContent = '×'; trash.disabled = importing;
                trash.addEventListener('click', () => { void remove(entry); }); row.append(trash);
            }
            gallery.append(row);
            if (!gallery.hidden) observer.observe(row);
        }
        renderSelection();
    }

    function setOpen(open) {
        gallery.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open) {
            renderList();
            const current = gallery.querySelector('[aria-checked="true"]');
            current?.scrollIntoView({ block: 'nearest' }); current?.focus({ preventScroll: true });
        } else { observer.disconnect(); toggle.focus({ preventScroll: true }); }
    }
    toggle.addEventListener('click', () => setOpen(gallery.hidden));
    gallery.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !event.target.matches('[role="radio"]')) return;
        event.preventDefault();
        const buttons = [...gallery.querySelectorAll('[role="radio"]')];
        const position = buttons.indexOf(event.target);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (position + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus(); buttons[next].click();
    });

    importButton.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
        const files = [...input.files]; input.value = '';
        if (!files.length || importing) return;
        importing = true; importButton.disabled = true;
        for (const button of gallery.querySelectorAll('.stm-font-delete')) button.disabled = true;
        const turn = revision;
        let last = null;
        const errors = [];
        let added = 0;
        let duplicates = 0;
        for (const file of files) {
            if (disposed) break;
            let id = null;
            try {
                validateFontFile(file);
                // crypto.subtle is unavailable on HTTP LAN installs; imports still work there.
                const digest = globalThis.crypto?.subtle && await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
                if (disposed) break;
                const hash = digest ? [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') : null;
                const previous = hash && settings.fonts.find(font => font.hash === hash);
                if (previous) { last = previous; duplicates++; continue; }
                if (settings.fonts.length >= MAX_FONTS) throw new Error(`最多保留 ${MAX_FONTS} 款本地字体，请先删除不需要的字体。`);
                id = `font:${createId()}`;
                const face = await decodeFont(file, id);
                if (disposed) break;
                await store.put(id, file);
                if (disposed) { await store.delete(id).catch(() => {}); break; }
                const entry = { id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 80), ...(hash ? { hash } : {}) };
                settings.fonts.push(entry);
                faces.add(face); document.fonts.add(face); cache.set(id, Promise.resolve(face));
                last = entry; added++; save();
            } catch (error) {
                if (id) await store.delete(id).catch(() => {});
                errors.push(`${file.name}：${error.message || '无法读取字体文件。'}`);
            }
        }
        if (disposed) { importing = false; return; }
        importing = false; importButton.disabled = false;
        renderList();
        if (last && revision === turn) await choose({ ...last, local: true });
        showStatus(errors.length ? `导入 ${added} 款，${errors.join('；')}` : `字体已导入 ${added} 款${duplicates ? `，${duplicates} 款重复字体已保留原项` : ''}。可在预览列表中切换。`, Boolean(errors.length));
    });

    renderList();
    void choose(entryFor(selectedKey()) || entryFor('inherit'), false);
    return {
        dispose() {
            disposed = true; ++revision; observer.disconnect();
            for (const face of faces) document.fonts.delete(face);
            faces.clear(); cache.clear();
        },
    };
}
