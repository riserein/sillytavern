/** Keep native select models for the existing playlist logic; render scoped frosted menus. */
export function createSelectMenus(panel) {
    const controls = [];
    let opened = null;
    const close = (focus = false) => {
        if (!opened) return;
        const current = opened; opened = null;
        current.menu.hidden = true; current.button.setAttribute('aria-expanded', 'false');
        if (focus) current.button.focus({ preventScroll: true });
    };
    function position(control) {
        const anchor = control.button.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        const width = Math.min(Math.max(anchor.width, 190), bounds.width - 28);
        const below = bounds.bottom - anchor.bottom - 16;
        const above = anchor.top - bounds.top - 16;
        const height = Math.min(240, Math.max(below, above), control.menu.scrollHeight);
        control.menu.style.width = `${width}px`;
        control.menu.style.maxHeight = `${Math.max(65, height)}px`;
        control.menu.style.left = `${Math.max(12, Math.min(anchor.left - bounds.left, bounds.width - width - 16))}px`;
        control.menu.style.top = `${below >= height || below >= above ? anchor.bottom - bounds.top + 5 : Math.max(12, anchor.top - bounds.top - height - 5)}px`;
    }
    function refresh(control) {
        control.button.querySelector('span').textContent = control.select.selectedOptions[0]?.textContent || '请选择歌单';
        control.button.disabled = control.select.disabled || !control.select.options.length;
        if (opened === control) fill(control);
    }
    function fill(control) {
        control.menu.replaceChildren();
        for (const option of control.select.options) {
            const button = document.createElement('button');
            button.type = 'button'; button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', String(option.value === control.select.value));
            button.textContent = option.textContent; button.dataset.value = option.value; button.disabled = option.disabled;
            button.addEventListener('click', () => {
                control.select.value = option.value;
                close(true);
                control.select.dispatchEvent(new Event('change', { bubbles: true }));
                refresh(control);
            });
            control.menu.append(button);
        }
        position(control);
    }
    for (const select of panel.querySelectorAll('select:not([data-no-menu])')) {
        const wrapper = document.createElement('div'); wrapper.className = 'stm-select'; wrapper.id = `${select.id}-control`;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'stm-select-trigger';
        button.id = `${select.id}-trigger`; button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', `${select.id}-menu`);
        const label = select.getAttribute('aria-label') || select.labels[0]?.textContent || '选择歌单';
        button.setAttribute('aria-label', label);
        const text = document.createElement('span'); const chevron = document.createElement('span');
        chevron.textContent = '⌄'; chevron.setAttribute('aria-hidden', 'true'); button.append(text, chevron);
        select.before(wrapper); wrapper.append(button, select);
        select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
        const menu = document.createElement('div'); menu.className = 'stm-select-menu'; menu.id = `${select.id}-menu`;
        menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', label); menu.hidden = true; panel.append(menu);
        const control = { select, button, menu };
        controls.push(control);
        const open = () => {
            close(); opened = control; menu.hidden = false; button.setAttribute('aria-expanded', 'true'); fill(control);
            menu.querySelector('[aria-selected="true"]:not(:disabled)')?.focus({ preventScroll: true });
        };
        button.addEventListener('click', () => { if (opened === control) close(); else open(); });
        button.addEventListener('keydown', event => {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); open(); }
        });
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
            if (event.key === 'Tab') { close(true); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const items = [...menu.querySelectorAll('button:not(:disabled)')];
            if (!items.length) return;
            const index = items.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
            items[next].focus();
        });
        select.addEventListener('change', () => refresh(control));
        const observer = new MutationObserver(() => refresh(control));
        observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
        control.observer = observer; refresh(control);
    }
    const outside = event => { if (opened && !opened.button.contains(event.target) && !opened.menu.contains(event.target)) close(); };
    const scroll = event => { if (opened && !opened.menu.contains(event.target)) close(); };
    const resize = () => close();
    document.addEventListener('pointerdown', outside, true);
    panel.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return {
        close,
        refresh() { for (const control of controls) refresh(control); },
        dispose() { close(); controls.forEach(control => control.observer.disconnect()); document.removeEventListener('pointerdown', outside, true); panel.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize); },
    };
}
