import { colorChannels, colorHex, compositeColor, contrastRatio } from '../ui/contrast.js';

/** Browser-only measurement of painted layers, including the shared shell veil.
 * Unknown image pixels are bounded by black/white; display:contents never paints. */
export function sampleReadingInk(node) {
    const css = getComputedStyle(node), layers = [];
    let parent = node, opaque = false, opacity = 1;
    while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (style.display === 'contents') { parent = parent.parentElement; continue; }
        opacity *= Number(style.opacity);
        if (parent.matches('.stm-player[data-reading]')) {
            const veil = getComputedStyle(parent, '::after'), rgba = colorChannels(veil.backgroundColor);
            if (veil.content !== 'none' && veil.display !== 'none' && rgba) {
                const alpha = rgba[3] * Number(veil.opacity);
                layers.push(colorHex(rgba) + Math.round(alpha * 255).toString(16).padStart(2, '0'));
                if (alpha === 1) { opaque = true; break; }
            }
            const image = getComputedStyle(parent, '::before');
            if (image.content !== 'none' && image.display !== 'none' && image.backgroundImage !== 'none') break;
        }
        if (style.backgroundImage !== 'none') break;
        const rgba = colorChannels(style.backgroundColor);
        if (rgba) layers.push(style.backgroundColor);
        if (rgba?.[3] === 1) { opaque = true; break; }
        parent = parent.parentElement;
    }
    const bases = opaque ? [layers.pop()] : ['#000000', '#ffffff'];
    const backgrounds = bases.map(base => layers.toReversed().reduce((bg, layer) => compositeColor(layer, bg), base));
    return { safe: true, ratio: Math.min(...backgrounds.map(bg => contrastRatio(compositeColor(css.color, bg), bg))), opacity, size: parseFloat(css.fontSize), foreground: css.color, backgrounds, basis: opaque ? 'painted-opaque-box' : 'black-white-image-bounds' };
}
