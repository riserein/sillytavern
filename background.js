export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function validateImageFile(file) {
    if (!file || !/^image\/(png|jpeg|webp|gif|avif)$/i.test(file.type)) throw new Error('请选择 PNG、JPG、WebP、GIF 或 AVIF 图片。');
    if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('背景图片不能为空，大小不能超过 10 MB。');
}

/** A portrait crop that always stays inside the source image. */
export function cropRectangle(width, height, { zoom = 1, x = 0.5, y = 0.5 } = {}, ratio = 2 / 3) {
    if (!(width > 0 && height > 0)) throw new Error('无法读取图片尺寸。');
    if (!(ratio > 0 && Number.isFinite(ratio))) ratio = 2 / 3;
    const cropWidth = Math.min(width, height * ratio) / clamp(zoom, 1, 4);
    const cropHeight = cropWidth / ratio;
    return { x: (width - cropWidth) * clamp(x, 0, 1), y: (height - cropHeight) * clamp(y, 0, 1), width: cropWidth, height: cropHeight };
}

async function decodeImage(blob) {
    if (globalThis.createImageBitmap) return createImageBitmap(blob, { imageOrientation: 'from-image' });
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
    } finally { URL.revokeObjectURL(url); }
}

export function createImageCropper(element, { onSave, onError, onClose, getAspectRatio = () => 2 / 3 }) {
    const query = selector => element.querySelector(selector);
    const canvas = query('canvas');
    const zoom = query('[data-crop="zoom"]');
    const horizontal = query('[data-crop="x"]');
    const vertical = query('[data-crop="y"]');
    const save = query('[data-crop-action="save"]');
    const cancel = query('[data-crop-action="cancel"]');
    let source;
    let original;
    let revision = 0;
    let dragging;
    let saving = false;
    let disposed = false;
    let ratio = 2 / 3;

    const position = () => ({ zoom: Number(zoom.value), x: Number(horizontal.value) / 100, y: Number(vertical.value) / 100 });
    function draw(target = canvas) {
        if (!source) return;
        const rect = cropRectangle(source.width, source.height, position(), ratio);
        const painter = target.getContext('2d');
        painter.clearRect(0, 0, target.width, target.height);
        painter.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, target.width, target.height);
    }
    function close() {
        revision++;
        source?.close?.();
        source = original = dragging = undefined;
        element.hidden = true;
        onClose();
    }
    for (const input of [zoom, horizontal, vertical]) input.addEventListener('input', () => draw());
    canvas.addEventListener('pointerdown', event => {
        if (!source || saving || !event.isPrimary || event.button !== 0) return;
        dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
        if (!dragging || dragging.id !== event.pointerId || !source) return;
        const rect = cropRectangle(source.width, source.height, position(), ratio);
        const box = canvas.getBoundingClientRect();
        if (source.width > rect.width) horizontal.value = String(clamp(Number(horizontal.value) - (event.clientX - dragging.x) * rect.width / box.width / (source.width - rect.width) * 100, 0, 100));
        if (source.height > rect.height) vertical.value = String(clamp(Number(vertical.value) - (event.clientY - dragging.y) * rect.height / box.height / (source.height - rect.height) * 100, 0, 100));
        dragging.x = event.clientX;
        dragging.y = event.clientY;
        draw();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { dragging = undefined; });
    cancel.addEventListener('click', () => { if (!saving) close(); });
    element.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!saving) close(); }
        if (event.key === 'Tab') {
            const controls = Array.from(element.querySelectorAll('button:not(:disabled), input:not(:disabled)'));
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    });
    save.addEventListener('click', async () => {
        if (!source || saving) return;
        saving = true;
        const sequence = revision;
        for (const input of [save, cancel, zoom, horizontal, vertical]) input.disabled = true;
        try {
            const output = document.createElement('canvas');
            output.width = 768;
            output.height = Math.round(output.width / ratio);
            draw(output);
            const cropped = await new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片裁剪失败，请重试。')), 'image/webp', 0.9));
            if (disposed || sequence !== revision) return;
            await onSave({ original, cropped });
            if (!disposed) close();
        } catch (error) { if (!disposed) onError(error); }
        finally {
            saving = false;
            for (const input of [save, cancel, zoom, horizontal, vertical]) input.disabled = false;
        }
    });
    return {
        dispose() { disposed = true; revision++; source?.close?.(); source = original = dragging = undefined; canvas.width = canvas.height = 1; element.hidden = true; },
        async open(blob) {
            if (disposed) return;
            const sequence = ++revision;
            try {
                validateImageFile(blob);
                const decoded = await decodeImage(blob);
                if (sequence !== revision) { decoded.close?.(); return; }
                if (decoded.width * decoded.height > 40_000_000) { decoded.close?.(); throw new Error('图片分辨率过大，请缩小到 4000 万像素以内。'); }
                source?.close?.();
                source = decoded;
                original = blob;
                ratio = getAspectRatio();
                if (!(ratio > 0 && Number.isFinite(ratio))) ratio = 2 / 3;
                canvas.height = Math.round(canvas.width / ratio);
                canvas.style.aspectRatio = String(ratio);
                zoom.value = '1';
                horizontal.value = vertical.value = '50';
                element.hidden = false;
                draw();
                zoom.focus();
            } catch (error) { if (sequence === revision) onError(error); }
        },
    };
}
