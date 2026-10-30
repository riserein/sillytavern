import { collageReferences, COLLAGE_MAX_BYTES } from "../ui/collage-model.js";
const dataBytes = (value) => {
  const text = value.slice(value.indexOf(",") + 1);
  if (text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    throw new Error("拼贴图片编码无效。");
  return (
    (text.length / 4) * 3 -
    (text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0)
  );
};
/** Embedded art only; external HTML/SVG/URLs cannot become collage assets. */
export function normalizeCollageAssets(raw, portableImage) {
  if (raw === undefined) return {};
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length > 96
  )
    throw new Error("拼贴图片目录无效。");
  let bytes = 0;
  const result = {};
  for (const [id, value] of Object.entries(raw)) {
    if (
      !/^cover:[a-f0-9-]{36}$/.test(id) ||
      typeof value !== "string" ||
      !value.startsWith("data:image/") ||
      !portableImage(value)
    )
      throw new Error("拼贴图片引用或格式无效。");
    bytes += dataBytes(value);
    if (dataBytes(value) > 2 * 1024 * 1024 || bytes > COLLAGE_MAX_BYTES)
      throw new Error("拼贴图片单项超过 2 MiB 或合计超过 8 MiB。");
    result[id] = value;
  }
  return result;
}
export async function prepareCollagePackage(
  design,
  { getBlob, encodeBlob, add, checkedImage, signal },
) {
  const refs = collageReferences(design),
    assets = {};
  let bytes = 0;
  for (const id of refs) {
    signal?.throwIfAborted();
    const image = await getBlob(id);
    if (!image) throw new Error("拼贴图片缺失，未生成不完整角色卡。");
    bytes += image.size;
    if (image.size > 2 * 1024 * 1024 || bytes > COLLAGE_MAX_BYTES)
      throw new Error("拼贴图片超过单项 2 MiB / 合计 8 MiB 上限。");
    assets[id] = await encodeBlob(
      add(checkedImage(image), "collage-image", "手账拼贴图片"),
    );
  }
  return assets;
}
