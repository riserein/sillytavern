import { clampPosition, positionToRatio } from './floating.js';

export function clampPanelSize(size, viewport) {
    const maxWidth = Math.max(1, Math.min(720, viewport.width - 24));
    const maxHeight = Math.max(1, Math.min(960, viewport.height - 32));
    return {
        width: Math.min(maxWidth, Math.max(Math.min(320, maxWidth), Number.isFinite(size.width) ? size.width : 390)),
        height: Math.min(maxHeight, Math.max(Math.min(420, maxHeight), Number.isFinite(size.height) ? size.height : 660)),
    };
}

export function normalizePanelSize(raw) {
    if (!Number.isFinite(raw?.width) || !Number.isFinite(raw?.height)) return null;
    return clampPanelSize(raw, { width: 10000, height: 10000 });
}

export function makeResizable(panel, handle, { getSize, onChange, onLayout }) {
    let active = null;
    let suppressClick = false;
    const viewport = () => ({ width: innerWidth, height: innerHeight });
    function place(size, origin) {
        const value = clampPanelSize(size, viewport());
        panel.style.width = `${value.width}px`; panel.style.height = `${value.height}px`;
        if (origin) {
            const position = clampPosition(origin, value, viewport());
            Object.assign(panel.style, { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', transform: 'none' });
        }
        return value;
    }
    function refresh() { if (!active && getSize()) place(getSize()); onLayout(); }
    function commit() {
        const bounds = panel.getBoundingClientRect();
        onChange({ width: bounds.width, height: bounds.height }, positionToRatio({ x: bounds.x, y: bounds.y }, viewport()));
    }
    handle.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || active) return;
        const bounds = panel.getBoundingClientRect();
        active = { id: event.pointerId, x: event.clientX, y: event.clientY, bounds, moved: false };
        suppressClick = false; panel.classList.add('stm-resizing');
        handle.setPointerCapture(event.pointerId); event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
        if (!active || active.id !== event.pointerId) return;
        const dx = event.clientX - active.x, dy = event.clientY - active.y;
        if (!active.moved && Math.hypot(dx, dy) < 6) return;
        active.moved = suppressClick = true;
        place({ width: active.bounds.width + dx, height: active.bounds.height + dy }, { x: active.bounds.x, y: active.bounds.y });
        event.preventDefault();
    });
    const finish = event => {
        if (!active || active.id !== event.pointerId) return;
        const moved = active.moved; active = null;
        if (moved) commit();
        panel.classList.remove('stm-resizing');
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        onLayout();
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, finish);
    handle.addEventListener('click', event => { if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    handle.addEventListener('keydown', event => {
        const direction = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction) return;
        event.preventDefault(); event.stopPropagation();
        const bounds = panel.getBoundingClientRect(); const step = event.shiftKey ? 40 : 10;
        panel.classList.add('stm-resizing');
        place({ width: bounds.width + direction[0] * step, height: bounds.height + direction[1] * step }, { x: bounds.x, y: bounds.y });
        commit(); panel.classList.remove('stm-resizing'); onLayout();
    });
    window.addEventListener('resize', refresh);
    refresh();
    return {
        refresh,
        reset() { panel.style.removeProperty('width'); panel.style.removeProperty('height'); onLayout(); },
        dispose() { window.removeEventListener('resize', refresh); },
    };
}
