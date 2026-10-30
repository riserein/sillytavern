/** Bounded static-raster headers, used before browser decoding and backup restore.
 * Not an image decoder: the browser still has to decode the complete file. */
export function inspectStaticRaster(bytes, type) {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.length ||
    bytes.length > 2 * 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp"].includes(type)
  )
    throw new Error("拼贴图片必须是 2 MiB 以内的静态 PNG、JPEG 或 WebP。");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    word = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  let width = 0,
    height = 0;
  if (type === "image/png") {
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) ||
      v.getUint32(8) !== 13 ||
      word(12, 16) !== "IHDR"
    )
      throw new Error("PNG 图片头无效。");
    width = v.getUint32(16);
    height = v.getUint32(20);
    for (let at = 8; at + 12 <= bytes.length; ) {
      const size = v.getUint32(at),
        kind = word(at + 4, at + 8);
      if (size > bytes.length - at - 12) throw new Error("PNG 文件不完整。");
      if (kind === "acTL") throw new Error("不支持动画 PNG。");
      at += size + 12;
    }
  }
  if (type === "image/webp") {
    if (bytes.length < 20 || word(0, 4) !== "RIFF" || word(8, 12) !== "WEBP")
      throw new Error("WebP 图片头无效。");
    for (let at = 12; at + 8 <= bytes.length; ) {
      const kind = word(at, at + 4),
        size = v.getUint32(at + 4, true),
        s = at + 8;
      if (size > bytes.length - s) throw new Error("WebP 文件不完整。");
      if (
        kind === "ANIM" ||
        kind === "ANMF" ||
        (kind === "VP8X" && bytes[s] & 2)
      )
        throw new Error("不支持动画 WebP。");
      if (kind === "VP8X" && size >= 10) {
        width = 1 + bytes[s + 4] + (bytes[s + 5] << 8) + (bytes[s + 6] << 16);
        height = 1 + bytes[s + 7] + (bytes[s + 8] << 8) + (bytes[s + 9] << 16);
      }
      if (kind === "VP8 " && size >= 10) {
        width = v.getUint16(s + 6, true) & 0x3fff;
        height = v.getUint16(s + 8, true) & 0x3fff;
      }
      if (kind === "VP8L" && size >= 5) {
        const n = v.getUint32(s + 1, true);
        width = (n & 0x3fff) + 1;
        height = ((n >>> 14) & 0x3fff) + 1;
      }
      if (width > 2048 || height > 2048)
        throw new Error("拼贴图片尺寸超过 2048 × 2048。");
      at += 8 + size + (size % 2);
    }
  }
  if (type === "image/jpeg") {
    if (bytes[0] !== 255 || bytes[1] !== 216)
      throw new Error("JPEG 图片头无效。");
    for (let at = 2; at + 4 < bytes.length; ) {
      if (bytes[at] !== 255) throw new Error("JPEG 标记无效。");
      const marker = bytes[at + 1];
      if (marker === 255) {
        at++;
        continue;
      }
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) {
        at += 2;
        continue;
      }
      const size = v.getUint16(at + 2);
      if (size < 2 || size > bytes.length - at - 2)
        throw new Error("JPEG 文件不完整。");
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        size >= 8
      ) {
        height = v.getUint16(at + 5);
        width = v.getUint16(at + 7);
        break;
      }
      at += 2 + size;
    }
  }
  if (!width || !height || width > 2048 || height > 2048)
    throw new Error("拼贴图片尺寸无效或超过 2048 × 2048。");
  return { width, height };
}
export async function checkCollageImages(config, getBlob) {
  const rows = Object.values(config?.collage?.pages || {}).flat(),
    ids = new Set(rows.map((r) => r.assetId).filter(Boolean));
  let total = 0;
  for (const id of ids) {
    const blob = await getBlob(id);
    if (!(blob instanceof Blob)) throw new Error("拼贴图片缺失。");
    total += blob.size;
    if (total > 8 * 1024 * 1024) throw new Error("拼贴图片合计超过 8 MiB。");
    inspectStaticRaster(new Uint8Array(await blob.arrayBuffer()), blob.type);
  }
  return true;
}
