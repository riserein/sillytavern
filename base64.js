/** Avoid Uint8Array.from(string): its generic iterator can allocate hundreds of MiB. */
export function base64Bytes(value) {
    const text = /[\t\n\f\r ]/.test(value) ? value.replace(/[\t\n\f\r ]/g, '') : value;
    if (text.length % 4 === 1) throw new DOMException('Invalid base64 length', 'InvalidCharacterError');
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    const firstPadding = text.indexOf('=');
    if (firstPadding !== -1 && firstPadding !== text.length - padding)
        throw new DOMException('Invalid base64 padding', 'InvalidCharacterError');
    const bytes = new Uint8Array(Math.floor(text.length * 3 / 4) - padding);
    let offset = 0;
    for (let i = 0; i < text.length; i += 65536) {
        const binary = atob(text.slice(i, i + 65536));
        for (let j = 0; j < binary.length; j++) bytes[offset++] = binary.charCodeAt(j);
    }
    return bytes;
}
