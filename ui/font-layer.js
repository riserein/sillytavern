import { FONT_PRESETS, loadBuiltinFont } from "../fonts.js";
/** Author-only font override. Recipient receives its one selected font via native transport. */
export function createDesignFontLayer(panel, launcher, onError = () => {}) {
  const bases = new WeakMap(),
    owned = new Set(),
    pending = new Map();
  let disposed = false,
    revision = 0;
  function set(id) {
    if (disposed) return;
    const turn = ++revision,
      preset = FONT_PRESETS[id];
    for (const root of [panel, launcher]) {
      const value = root.style.getPropertyValue("--stm-font-family");
      if (!value.includes("var(--design-font-family)")) bases.set(root, value);
      if (id === "current" || !preset) {
        const base = bases.get(root);
        if (base) root.style.setProperty("--stm-font-family", base);
        else root.style.removeProperty("--stm-font-family");
      } else {
        root.style.setProperty(
          "--design-font-family",
          preset.family === "inherit"
            ? getComputedStyle(root.parentElement).fontFamily
            : preset.family,
        );
        root.style.setProperty(
          "--stm-font-family",
          "var(--design-font-family)",
        );
      }
    }
    if (!preset?.file) return;
    if (
      [...panel.ownerDocument.fonts].some(
        (face) => face.family === "stm-" + id && face.status === "loaded",
      )
    )
      return;
    if (!pending.has(id))
      pending.set(
        id,
        loadBuiltinFont(id)
          .then((face) => {
            if (!disposed) {
              owned.add(face);
              panel.ownerDocument.fonts.add(face);
            }
            return face;
          })
          .catch((error) => {
            pending.delete(id);
            throw error;
          }),
      );
    void pending.get(id).catch(() => {
      if (!disposed && turn === revision)
        onError("所选设计字体加载失败，暂用设备字体；可重新选择重试。");
    });
  }
  return {
    set,
    dispose() {
      disposed = true;
      revision++;
      for (const face of owned) panel.ownerDocument.fonts.delete(face);
      owned.clear();
      pending.clear();
    },
  };
}
