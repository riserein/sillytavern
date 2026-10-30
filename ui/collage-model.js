/** Flat, data-only pages. Coordinates are percentages of independent desktop/mobile
 * canvases, with separate defaults rather than scaled desktop pixel positions. */
export const COLLAGE_PAGES = ["music", "lyrics", "notes", "collection"];
export const COLLAGE_TYPES = Object.freeze({
  image: "图片 / 静态装饰",
  text: "文字",
  cover: "歌曲封面",
  title: "歌名",
  artist: "歌手",
  album: "专辑",
  lyrics: "完整歌词",
  translation: "当前译文",
  note: "作者手记",
  scene: "场景介绍",
  queue: "曲目目录",
  controls: "真实播放控制",
  line: "分割线",
});
export const COLLAGE_MAX_BYTES = 8 * 1024 * 1024;
const safeId = (value) =>
  typeof value === "string" && /^cover:[a-f0-9-]{36}$/.test(value)
    ? value
    : null;
const num = (v, d, min, max) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, v))
    : d;
const color = (v) =>
  typeof v === "string" && /^#[a-f0-9]{6}$/i.test(v) ? v.toLowerCase() : null;
const rect = (value, fallback) => {
  const x = num(value?.x, fallback.x, 0, 95),
    y = num(value?.y, fallback.y, 0, 98);
  return {
    x,
    y,
    w: num(value?.w, fallback.w, 5, 100 - x),
    h: num(value?.h, fallback.h, 2, 100 - y),
  };
};
export function collageElement(type, id = "e-" + crypto.randomUUID()) {
  if (!Object.hasOwn(COLLAGE_TYPES, type))
    throw new Error("不支持此拼贴元素。");
  return {
    id,
    type,
    text: type === "text" ? "写下一段属于这首歌的文字" : "",
    assetId: null,
    desktop: { x: 8, y: 8, w: 84, h: type === "line" ? 2 : 16 },
    mobile: { x: 7, y: 6, w: 86, h: type === "line" ? 2 : 16 },
    font: "inherit",
    fontSize: type === "title" ? 26 : 16,
    weight: 400,
    lineHeight: 1.7,
    color: null,
    align: "start",
    opacity: 1,
    radius: 0,
    z: 10,
    locked: false,
    hidden: false,
  };
}
export function defaultCollage() {
  const make = (type, id, desktop, mobile) => ({
    ...collageElement(type, id),
    desktop,
    mobile,
  });
  return {
    version: 1,
    pages: {
      music: [
        make(
          "cover",
          "cover",
          { x: 8, y: 10, w: 40, h: 42 },
          { x: 16, y: 5, w: 68, h: 30 },
        ),
        make(
          "controls",
          "controls",
          { x: 54, y: 8, w: 40, h: 84 },
          { x: 7, y: 40, w: 86, h: 58 },
        ),
      ],
      lyrics: [
        make(
          "lyrics",
          "lyrics",
          { x: 6, y: 4, w: 88, h: 92 },
          { x: 4, y: 3, w: 92, h: 94 },
        ),
      ],
      notes: [
        make(
          "note",
          "note",
          { x: 8, y: 8, w: 84, h: 80 },
          { x: 7, y: 6, w: 86, h: 86 },
        ),
      ],
      collection: [
        make(
          "queue",
          "queue",
          { x: 6, y: 5, w: 88, h: 90 },
          { x: 5, y: 4, w: 90, h: 92 },
        ),
      ],
    },
  };
}
export function normalizeCollage(raw) {
  if (raw === undefined || raw === null) return null;
  if (raw.version !== 1 || !raw.pages || typeof raw.pages !== "object")
    return null;
  try {
    if (JSON.stringify(raw).length > 512 * 1024) return null;
  } catch {
    return null;
  }
  const seen = new Set();
  let textCount = 0;
  const pages = {};
  for (const page of COLLAGE_PAGES) {
    const nodes = raw.pages[page];
    if (!Array.isArray(nodes) || nodes.length > 24) return null;
    const live = new Set();
    pages[page] = [];
    for (const row of nodes) {
      if (
        !row ||
        !Object.hasOwn(COLLAGE_TYPES, row.type) ||
        typeof row.id !== "string" ||
        !/^[\w:-]{1,100}$/.test(row.id) ||
        seen.has(row.id)
      )
        return null;
      seen.add(row.id);
      if (!["text", "image", "line"].includes(row.type)) {
        if (live.has(row.type)) return null;
        live.add(row.type);
      }
      const fallback = collageElement(row.type, row.id),
        text = typeof row.text === "string" ? row.text : "";
      textCount += text.length;
      if (text.length > 5000 || textCount > 50000) return null;
      pages[page].push({
        ...fallback,
        text,
        assetId: row.type === "image" ? safeId(row.assetId) : null,
        desktop: rect(row.desktop, fallback.desktop),
        mobile: rect(row.mobile, fallback.mobile),
        font: ["inherit", "sans", "serif", "monospace"].includes(row.font)
          ? row.font
          : "inherit",
        fontSize: num(row.fontSize, 16, 13, 72),
        weight: num(row.weight, 400, 400, 800),
        lineHeight: num(row.lineHeight, 1.7, 1.2, 2.6),
        color: color(row.color),
        align: ["start", "center", "end"].includes(row.align)
          ? row.align
          : "start",
        opacity: num(row.opacity, 1, 0, 1),
        radius: num(row.radius, 0, 0, 36),
        z: Math.round(num(row.z, 10, 0, 99)),
        locked: row.locked === true,
        hidden: row.hidden === true,
      });
    }
  }
  return { version: 1, pages };
}
export function collageReferences(config) {
  return new Set(
    Object.values(config?.collage?.pages || {}).flatMap((rows) =>
      Array.isArray(rows)
        ? rows.map((row) => safeId(row.assetId)).filter(Boolean)
        : [],
    ),
  );
}
export function validateCollage(raw) {
  const safe = normalizeCollage(raw);
  if (!safe) throw new Error("拼贴页结构、元素种类、数量或文本容量无效。");
  const allowed = new Set(Object.keys(collageElement("text", "check")));
  for (const [page, rows] of Object.entries(raw.pages)) {
    if (!COLLAGE_PAGES.includes(page)) throw new Error("未知拼贴页面。");
    for (const row of rows) {
      if (Object.keys(row).some((key) => !allowed.has(key)))
        throw new Error("拼贴包含未知属性，禁止 HTML、脚本和任意 CSS。");
      const normalized = safe.pages[page].find((n) => n.id === row.id);
      for (const key of ["desktop", "mobile"])
        if (
          Object.keys(row[key] || {}).some(
            (p) => !["x", "y", "w", "h"].includes(p),
          ) ||
          Object.entries(row[key] || {}).some(
            ([p, v]) => normalized[key][p] !== v,
          )
        )
          throw new Error("拼贴坐标越界或无效。");
      for (const key of Object.keys(row).filter(
        (k) => !["desktop", "mobile"].includes(k),
      ))
        if (row[key] !== normalized[key])
          throw new Error("拼贴属性超限或格式无效。");
    }
  }
  if (Object.keys(raw).some((key) => !["version", "pages"].includes(key)))
    throw new Error("拼贴包含未知顶层属性。");
  return safe;
}
export function mapCollageAssets(config, map) {
  const copy = structuredClone(config);
  if (copy?.collage)
    for (const rows of Object.values(copy.collage.pages))
      for (const row of rows) if (row.assetId) row.assetId = map(row.assetId);
  return copy;
}
