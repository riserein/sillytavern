/** Constrained component styles; no selectors, CSS strings or free coordinates in templates. */
export const COMPONENTS = Object.freeze({
  cover: { name: "封面", selector: ".stm-cover-stage" },
  title: { name: "歌曲标题", selector: "[data-role=title]" },
  artist: { name: "歌手", selector: "[data-role=source]" },
  progress: { name: "进度条", selector: "#stm-seek" },
  controls: { name: "播放按钮", selector: ".stm-transport" },
  volume: { name: "音量控制", selector: ".stm-volume" },
  lyrics: { name: "歌词入口", selector: ".stm-cover-tip" },
  mode: { name: "播放模式", selector: "#stm-mode" },
  queue: { name: "播放队列", selector: "[data-action=toggle-queue]" },
  decoration: {
    name: "装饰组件",
    selector: ".stm-design-tonearm,.stm-design-reels",
  },
  background: { name: "背景", selector: null },
});
const bounded = (n, min, max) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.max(min, Math.min(max, n))
    : null;
export function normalizeComponents(raw = {}) {
  return Object.fromEntries(
    Object.keys(COMPONENTS).map((id) => {
      const p = raw?.[id] || {};
      return [
        id,
        {
          visible: p.visible !== false,
          size: bounded(p.size, 0.65, 1.3),
          margin: bounded(p.margin, 0, 24),
          color: /^#[a-f\d]{6}$/i.test(p.color) ? p.color.toLowerCase() : null,
          opacity: bounded(p.opacity, 0.5, 1),
          radius: bounded(p.radius, 0, 36),
          position: ["auto", "start", "center", "end"].includes(p.position)
            ? p.position
            : "auto",
        },
      ];
    }),
  );
}
export function applyComponents(panel, config, accessible) {
  for (const [id, { selector }] of Object.entries(COMPONENTS)) {
    if (!selector) continue;
    const c = config.components[id];
    for (const element of panel.querySelectorAll(selector)) {
      element.dataset.designComponent = id;
      element.dataset.componentHidden = String(!accessible && !c.visible);
      element.dataset.componentPosition = c.position;
      const values = {
        opacity: c.opacity,
        color: c.color,
        "border-radius": c.radius === null ? null : c.radius + "px",
        "margin-block": c.margin === null ? null : c.margin + "px",
      };
      // Use zoom for bounded layout sizing rather than free positioning or transforms
      // that would overwrite vinyl rotation. Core button hit area remains >= 40 px.
      values.zoom =
        id === "controls"
          ? c.size === null
            ? null
            : Math.max(1, c.size)
          : c.size;
      for (const [key, value] of Object.entries(values)) {
        if (value === null) element.style.removeProperty(key);
        else element.style.setProperty(key, String(value));
      }
    }
  }
  panel.dataset.componentBackground = String(
    config.components.background.visible,
  );
  panel.dataset.componentBgColor = String(
    Boolean(config.components.background.color),
  );
  panel.dataset.componentBgOpacity = String(
    config.components.background.opacity !== null,
  );
  const bg = config.components.background;
  for (const [key, value] of Object.entries({
    opacity: bg.opacity,
    color: bg.color,
    radius: bg.radius === null ? null : bg.radius + "px",
  })) {
    if (value === null) panel.style.removeProperty("--component-bg-" + key);
    else panel.style.setProperty("--component-bg-" + key, String(value));
  }
}
