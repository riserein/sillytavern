const MARGIN = 8;
const DRAG_THRESHOLD = 6;

export function clampPosition(position, size, viewport) {
    return {
        x: Math.min(Math.max(MARGIN, viewport.width - size.width - MARGIN), Math.max(MARGIN, position.x)),
        y: Math.min(Math.max(MARGIN, viewport.height - size.height - MARGIN), Math.max(MARGIN, position.y)),
    };
}

export function positionToRatio(position, viewport) {
    return { x: position.x / Math.max(1, viewport.width), y: position.y / Math.max(1, viewport.height) };
}

export function positionFromRatio(position, size, viewport) {
    return clampPosition({ x: position.x * viewport.width, y: position.y * viewport.height }, size, viewport);
}

/** Use pointer capture so dragging keeps working outside the handle, with both mouse and touch. */
export function makeDraggable(element, handle, { getPosition, onPositionChange }) {
    const events = new AbortController();
    let active = null;
    let suppressClick = false;
    let frame = null;
    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    const rect = () => element.getBoundingClientRect();

    function place(position) {
        // ST transforms its root on mobile; a fixed bottom offset would be relative to that root.
        // Explicit top/left coordinates also remove the panel's initial upward translation.
        element.style.left = `${position.x}px`;
        element.style.top = `${position.y}px`;
        element.style.right = 'auto';
        element.style.transform = 'none';
    }

    function clearPosition() {
        for (const property of ['left', 'top', 'right', 'transform']) element.style.removeProperty(property);
    }

    function refresh() {
        if (element.hidden || active || element.classList.contains('stm-resizing')) return;
        const saved = getPosition();
        if (saved) {
            place(positionFromRatio(saved, rect(), viewport()));
        } else {
            clearPosition();
            const bounds = rect();
            const position = clampPosition({ x: bounds.x, y: bounds.y }, bounds, viewport());
            if (position.x !== bounds.x || position.y !== bounds.y) place(position);
        }
    }

    function commit() {
        const bounds = rect();
        onPositionChange(positionToRatio({ x: bounds.x, y: bounds.y }, viewport()));
    }

    function finish(event) {
        if (!active || event.pointerId !== active.id) return;
        const wasMoved = active.moved;
        active = null;
        element.classList.remove('stm-dragging');
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        if (wasMoved) commit();
    }

    const on = (target, type, callback, capture = false) => target.addEventListener(type, callback, { capture, signal: events.signal });
    on(handle, 'pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || active) return;
        suppressClick = false;
        const control = event.target.closest?.('button, input, select, textarea, a');
        if (control && control !== handle) return;
        const bounds = rect();
        active = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.x, top: bounds.y, moved: false };
        handle.setPointerCapture(event.pointerId);
    });
    on(handle, 'pointermove', event => {
        if (!active || event.pointerId !== active.id) return;
        const dx = event.clientX - active.x;
        const dy = event.clientY - active.y;
        if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        active.moved = true;
        suppressClick = true;
        element.classList.add('stm-dragging');
        place(clampPosition({ x: active.left + dx, y: active.top + dy }, rect(), viewport()));
        event.preventDefault();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on(handle, event, finish);
    on(handle, 'click', event => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
    on(handle, 'keydown', event => {
        if (event.target !== handle) return;
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction) return;
        const bounds = rect();
        const step = event.shiftKey ? 40 : 10;
        place(clampPosition({ x: bounds.x + direction[0] * step, y: bounds.y + direction[1] * step }, bounds, viewport()));
        commit();
        event.preventDefault();
        event.stopPropagation();
    });
    on(window, 'resize', () => {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { frame = null; refresh(); });
    });
    const observer = new ResizeObserver(refresh);
    observer.observe(element);
    refresh();
    return { dispose() { events.abort(); observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); active = null; }, refresh, reset: () => { clearPosition(); refresh(); } };
}
