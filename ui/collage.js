import { inspectStaticRaster } from "./raster.js";
import { normalizeCollage, defaultCollage } from "./collage-model.js";
import { readableColor } from "./contrast.js";
/** Visual projection over the existing controls, cover, lyric reader and queue.
 * No Audio, independent clock, LRC parser or author storage is created. */
export function createCollage({
  panel,
  getTrack,
  getTracks,
  getGroup,
  getScene,
  getTranslation,
  onTrack,
  onLyrics,
  onNotes,
  readBlob,
}) {
  const doc = panel.ownerDocument,
    abort = new AbortController(),
    playback = panel.querySelector("[data-view=playback]"),
    root = doc.createElement("section");
  root.className = "stm-collage";
  root.hidden = true;
  root.innerHTML =
    '<nav aria-label="手账页面"><button type="button" data-collage-page="music">Music｜音乐</button><button type="button" data-collage-page="lyrics">Lyrics｜歌词</button><button type="button" data-collage-page="notes">Notes｜手记</button><button type="button" data-collage-page="collection">Collection｜目录</button></nav><div class="stm-collage-canvas"><div class="stm-collage-reading-region" aria-hidden="true"></div></div>';
  const canvas = root.querySelector(".stm-collage-canvas"),
    nodes = {
      cover: panel.querySelector(".stm-cover-stage"),
      controls: panel.querySelector(".stm-player-controls"),
      lyrics: panel.querySelector(".stm-lyrics-view"),
      note: panel.querySelector("[data-journal-pane=notes]"),
    };
  const homes = Object.values(nodes).map((node) => {
    const anchor = doc.createComment("collage-home");
    node.before(anchor);
    return { node, anchor };
  });
  playback.prepend(root);
  let active = false,
    config = null,
    model = null,
    page = "music",
    device = "desktop",
    signature = "",
    structureSignature = "",
    generation = 0,
    disposed = false;
  const urls = new Map(),
    pending = new Map(),
    items = new Map();
  const ownUrls = () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    pending.clear();
  };
  function restore() {
    for (const { node, anchor } of homes) anchor.after(node);
    nodes.lyrics.hidden = true;
    nodes.note.hidden = true;
  }
  function layout() {
    const narrow =
      panel.dataset.editorPreview === "true" &&
      panel.dataset.collagePreviewDevice
        ? panel.dataset.collagePreviewDevice === "mobile"
        : panel.clientWidth < 540;
    device = narrow ? "mobile" : "desktop";
    root.dataset.device = device;
    canvas.style.height =
      (narrow
        ? Math.max(640, Math.min(900, panel.clientHeight - 160))
        : Math.max(600, Math.min(850, panel.clientHeight - 140))) + "px";
    let left = 100,
      top = 100,
      right = 0,
      bottom = 0;
    for (const row of model?.pages[page] || []) {
      const item = items.get(row.id);
      if (!item) continue;
      const r = row[device];
      Object.assign(item.style, {
        left: r.x + "%",
        top: r.y + "%",
        width: r.w + "%",
        height: r.h + "%",
        zIndex: row.z,
        opacity: ["image", "line"].includes(row.type)
          ? row.opacity
          : Math.max(0.85, row.opacity),
        borderRadius: row.radius + "px",
        fontFamily:
          row.font === "inherit"
            ? ""
            : row.font === "sans"
              ? "system-ui,sans-serif"
              : row.font,
        fontSize: row.fontSize + "px",
        fontWeight: row.weight,
        lineHeight: row.lineHeight,
        textAlign: row.align,
      });
      item.style.setProperty("--collage-z", String(row.z));
      if (row.color)
        item.style.color = readableColor(
          row.color,
          [
            getComputedStyle(panel).getPropertyValue("--read-surface").trim() ||
              "#202b35",
          ],
          4.5,
        );
      else item.style.removeProperty("color");
      if (!row.hidden && !["image", "line", "cover"].includes(row.type)) {
        left = Math.min(left, r.x);
        top = Math.min(top, r.y);
        right = Math.max(right, r.x + r.w);
        bottom = Math.max(bottom, r.y + r.h);
      }
    }
    const region = canvas.querySelector(".stm-collage-reading-region");
    region.hidden = right === 0;
    Object.assign(region.style, {
      left: left + "%",
      top: top + "%",
      width: right - left + "%",
      height: bottom - top + "%",
    });
    root.dispatchEvent(
      new CustomEvent("stm:collage-layout", { bubbles: true }),
    );
  }
  async function image(row, item, token) {
    let blob;
    try {
      if (!row.assetId) return;
      if (!urls.has(row.assetId)) {
        if (!pending.has(row.assetId))
          pending.set(row.assetId, Promise.resolve(readBlob(row.assetId)));
        blob = await pending.get(row.assetId);
        if (disposed || token !== generation || !active) return;
        if (!blob) throw new Error("图片资源缺失");
        inspectStaticRaster(
          new Uint8Array(await blob.arrayBuffer()),
          blob.type,
        );
        if (disposed || token !== generation || !active) return;
        if (!urls.has(row.assetId))
          urls.set(row.assetId, URL.createObjectURL(blob));
      }
      const img = doc.createElement("img");
      img.alt = row.text || "手账静态装饰";
      img.src = urls.get(row.assetId);
      item.replaceChildren(img);
    } catch {
      if (!disposed && token === generation)
        item.textContent = "图片资源缺失，请由制作端检查并重新导出。";
    }
  }
  const structure = () =>
    JSON.stringify(
      model.pages[page].map(({ id, type, text, assetId, hidden }) => ({
        id,
        type,
        text,
        assetId,
        hidden,
      })),
    );
  function trimAssets() {
    const wanted = new Set(
      model.pages[page].map((r) => r.assetId).filter(Boolean),
    );
    for (const [id, url] of urls)
      if (!wanted.has(id)) {
        URL.revokeObjectURL(url);
        urls.delete(id);
      }
    for (const id of pending.keys()) if (!wanted.has(id)) pending.delete(id);
  }
  function render() {
    structureSignature = structure();
    trimAssets();
    root.dataset.separateTitle = String(
      model.pages[page].some((r) => r.type === "title" && !r.hidden),
    );
    generation++;
    const token = generation;
    restore();
    for (const item of items.values()) item.remove();
    items.clear();
    for (const row of model.pages[page]) {
      if (row.hidden) continue;
      const item = doc.createElement("div");
      item.className = "stm-collage-item";
      item.dataset.collageElement = row.id;
      item.dataset.type = row.type;
      canvas.append(item);
      items.set(row.id, item);
      if (nodes[row.type]) {
        item.append(nodes[row.type]);
        nodes[row.type].hidden = false;
      } else if (row.type === "image") void image(row, item, token);
      else if (row.type === "text") item.textContent = row.text;
      else if (row.type === "line") item.append(doc.createElement("hr"));
      else if (row.type === "queue") {
        const ol = doc.createElement("ol");
        item.append(ol);
      }
    }
    layout();
    sync();
    onLyrics(
      page === "lyrics" &&
        model.pages[page].some((r) => r.type === "lyrics" && !r.hidden),
    );
    if (page === "notes") onNotes();
    panel.dataset.lyricsOpen = "false";
  }
  function sync() {
    if (!active || disposed) return;
    const track = getTrack(),
      scene = getScene(),
      note =
        getGroup()?.showNotes !== false
          ? getGroup()?.notes?.find((row) => row.trackId === track?.id)?.text ||
            ""
          : "";
    const texts = {
      title: track?.title || "尚未选择歌曲",
      artist: track?.artist || "",
      album: track?.album || "",
      translation: getTranslation() || "本句暂无译文",
      scene: scene?.description || "",
    };
    for (const row of model.pages[page]) {
      const item = items.get(row.id);
      if (!item) continue;
      if (Object.hasOwn(texts, row.type)) item.textContent = texts[row.type];
      if (row.type === "queue") {
        const ol = item.querySelector("ol"),
          queue = getTracks(),
          queueKey = JSON.stringify([
            getTrack()?.id,
            queue.map((t) => [t.id, t.title]),
          ]);
        if (item.dataset.queueKey === queueKey) continue;
        item.dataset.queueKey = queueKey;
        ol.replaceChildren();
        for (const [i, track] of queue.entries()) {
          const li = doc.createElement("li"),
            button = doc.createElement("button");
          button.type = "button";
          button.dataset.collageTrack = track.id;
          button.textContent =
            String(i + 1).padStart(2, "0") + " · " + track.title;
          button.setAttribute(
            "aria-current",
            String(track.id === getTrack()?.id),
          );
          li.append(button);
          ol.append(li);
        }
      }
    }
    if (page === "notes") {
      nodes.note.querySelector("[data-journal-note-title]").textContent =
        track?.title || "";
      nodes.note.querySelector("[data-journal-description]").textContent =
        scene?.description || "";
      nodes.note.querySelector("[data-journal-note]").textContent = note;
      nodes.note.querySelector("[data-journal-scene-heading]").hidden =
        !scene?.description;
      nodes.note.querySelector("[data-journal-song-heading]").hidden = !note;
    }
  }
  function show(next) {
    if (!active || !Object.hasOwn(model.pages, next)) return;
    page = next;
    for (const button of root.querySelectorAll("[data-collage-page]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.collagePage === page),
      );
    render();
  }
  function apply(value) {
    const enabled =
      value.layout === "journal" && value.customization.journalMode === "free";
    if (!enabled) {
      if (active) {
        active = false;
        generation++;
        restore();
        root.hidden = true;
        onLyrics(false);
        ownUrls();
        signature = "";
      }
      return;
    }
    const next = normalizeCollage(value.collage) || defaultCollage(),
      nextSignature = JSON.stringify(next);
    config = value;
    if (!active) {
      active = true;
      root.hidden = false;
      page = "music";
      signature = "";
      structureSignature = "";
    }
    model = next;
    if (signature !== nextSignature) {
      signature = nextSignature;
      if (structureSignature !== structure()) show(page);
      else {
        layout();
        sync();
      }
    } else layout();
  }
  root.addEventListener(
    "click",
    (e) => {
      const next = e.target.closest("[data-collage-page]")?.dataset.collagePage;
      if (next) show(next);
      const id = e.target.closest("[data-collage-track]")?.dataset.collageTrack;
      if (id) onTrack(id);
    },
    { signal: abort.signal },
  );
  panel.addEventListener(
    "stm:collage-preview-device",
    () => {
      if (active) layout();
    },
    { signal: abort.signal },
  );
  const resize = new ResizeObserver(() => {
    if (active) layout();
  });
  resize.observe(panel);
  return {
    apply,
    show,
    sync,
    syncTranslation() {
      if (!active) return;
      for (const row of model.pages[page])
        if (row.type === "translation" && items.has(row.id))
          items.get(row.id).textContent = getTranslation() || "本句暂无译文";
    },
    get active() {
      return active;
    },
    get canvas() {
      return canvas;
    },
    dispose() {
      disposed = true;
      abort.abort();
      resize.disconnect();
      if (active) restore();
      ownUrls();
      for (const { anchor } of homes) anchor.remove();
      root.remove();
    },
  };
}
