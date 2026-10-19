import { luminance } from './ui/contrast.js';
export const DEFAULT_CUSTOM_COLORS = { enabled: false, accent: '#dbc291', background: '#25211e', text: '#f0e9dc' };
export const CUSTOM_PROPERTIES = ['--stm-accent', '--stm-on-accent', '--stm-body', '--stm-muted', '--stm-solid', '--stm-matte', '--stm-glass', '--stm-line', '--stm-subtle', '--stm-hover', '--stm-active', '--stm-track', '--stm-image-text-shadow'];

export function normalizeCustomColors(raw) {
    const colors = { ...DEFAULT_CUSTOM_COLORS, enabled: raw?.enabled === true };
    for (const name of ['accent', 'background', 'text']) {
        if (typeof raw?.[name] === 'string' && /^#[a-f0-9]{6}$/i.test(raw[name])) colors[name] = raw[name].toLowerCase();
    }
    return colors;
}

export function hexRgba(hex, alpha) {
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${rgb.join(', ')}, ${alpha})`;
}

export function customPalette(colors) {
    const { accent, background, text } = normalizeCustomColors(colors);
    return {
        '--stm-accent': accent,
        '--stm-on-accent': luminance(accent) > .179 ? '#17191d' : '#ffffff',
        '--stm-body': text,
        '--stm-muted': hexRgba(text, .75),
        '--stm-solid': background,
        '--stm-matte': hexRgba(background, .97),
        '--stm-glass': hexRgba(background, .66),
        '--stm-line': hexRgba(accent, .3),
        '--stm-subtle': hexRgba(text, .04),
        '--stm-hover': hexRgba(text, .09),
        '--stm-active': hexRgba(accent, .14),
        '--stm-track': hexRgba(text, .25),
        '--stm-image-text-shadow': luminance(text) > .179 ? '0 1px 2px #000d, 0 0 5px #0009' : '0 1px 2px #fffd, 0 0 5px #fff9',
    };
}

export function defaultMaskOpacity(surface, hasImage, theme, custom = false) {
    if (surface === 'clear') return 0;
    if (hasImage) return surface === 'matte' ? .65 : .38;
    if (surface === 'matte') return theme === 'pearl' && !custom ? .98 : .97;
    return custom || theme === 'amber' ? .66 : theme === 'pearl' ? .76 : .64;
}

/** Small halos stay inside the player, including blank areas, without intercepting input. */
export function attachClickEffects(panel, launcher, enabled) {
    const layer = document.createElement('span');
    layer.className = 'stm-click-effects';
    layer.setAttribute('aria-hidden', 'true'); panel.append(layer);
    let pointer = null;
    const down = event => { if (event.isPrimary) pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; };
    const move = event => { if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer.moved = true; };
    const cancel = event => { if (pointer?.id === event.pointerId) pointer.moved = true; };
    const click = event => {
        if (!enabled() || event.defaultPrevented || (event.detail && pointer?.moved) || matchMedia('(prefers-reduced-motion: reduce)').matches || !layer.animate) return;
        if (event.target.closest?.(':disabled')) return;
        const bounds = layer.getBoundingClientRect();
        const target = event.target.getBoundingClientRect?.() || bounds;
        const wave = document.createElement('span'); wave.className = 'stm-click-wave';
        wave.style.width = wave.style.height = '30px';
        wave.style.left = `${(event.detail ? event.clientX : target.x + target.width / 2) - bounds.x}px`;
        wave.style.top = `${(event.detail ? event.clientY : target.y + target.height / 2) - bounds.y}px`;
        const colors = getComputedStyle(panel);
        for (const property of ['--stm-accent', '--stm-active']) layer.style.setProperty(property, colors.getPropertyValue(property));
        while (layer.children.length >= 8) layer.firstElementChild.remove();
        layer.append(wave);
        const animation = wave.animate([
            { transform: 'translate(-50%, -50%) scale(.15)', opacity: .65 },
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
        ], { duration: 480, easing: 'cubic-bezier(.16, 1, .3, 1)' });
        animation.finished.then(() => wave.remove(), () => wave.remove());
    };
    for (const [name, callback] of [['pointerdown', down], ['pointermove', move], ['pointercancel', cancel], ['click', click]]) panel.addEventListener(name, callback, true);
    return () => {
        for (const [name, callback] of [['pointerdown', down], ['pointermove', move], ['pointercancel', cancel], ['click', click]]) panel.removeEventListener(name, callback, true);
        layer.remove();
    };
}
