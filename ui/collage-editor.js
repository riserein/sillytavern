import {createTrackId} from "../ids.js";
import {
  COLLAGE_PAGES,
  COLLAGE_TYPES,
  collageElement,
  defaultCollage,
  collageReferences,
  COLLAGE_MAX_BYTES,
} from "./collage-model.js";
/** Author-only tools over the live shared player. Preview mutations remain in the
 * existing designer history until its Apply/Save action. No second player. */
export function createCollageEditor({
  host,
  panel,
  getDesign,
  update,
  readImage,
  writeImage,
  retire,
  notice,
  guard,
}) {
  const doc = host.ownerDocument,
    win = doc.defaultView,
    abort = new AbortController(),
    root = doc.createElement("details");
  root.className = "stm-collage-tools";
  root.open = true;
  root.innerHTML =
    '<summary>自由排版 · 页面与图层</summary><p class="stm-hint">先选择“自由排版”。取消下方“排版操作”可试听真实控件；未应用的改动只在预览中。桌面与手机分别编辑坐标。文字层始终位于图片上方以保护阅读；正文透明度最低 85%，需要移除请用隐藏。</p><label>页面<select data-collage-tool="page"></select></label><label class="stm-check-label"><input type="checkbox" data-collage-tool="editing">排版操作（拖动 / 右下角缩放）</label><label class="stm-check-label"><input type="checkbox" data-collage-tool="snap" checked>5% 网格吸附 / 中线参考</label><label>添加元素<select data-collage-tool="type"></select></label><button type="button" data-collage-do="add">添加到本页</button><button type="button" data-collage-do="image">导入图片 / 静态装饰</button><label class="stm-check-label"><input type="checkbox" data-collage-tool="optimize">允许优化这次图片（WebP，最长 1280px；不处理音频）</label><input type="file" data-collage-tool="file" accept="image/png,image/jpeg,image/webp" hidden><label>图层（可多选）<select multiple data-collage-tool="layers"></select></label><label>文字内容<textarea data-collage-tool="text" maxlength="5000" rows="3"></textarea></label><div data-collage-properties></div><div class="stm-axis-tools"><button type="button" data-collage-do="copy">复制</button><button type="button" data-collage-do="remove">删除</button><button type="button" data-collage-do="hide">隐藏 / 显示</button><button type="button" data-collage-do="lock">锁定 / 解锁</button></div><label>多选对齐<select data-collage-tool="align"><option value="left">左对齐</option><option value="center">水平居中</option><option value="right">右对齐</option><option value="top">顶部对齐</option><option value="middle">垂直居中</option><option value="bottom">底部对齐</option></select></label><button type="button" data-collage-do="align">对齐所选元素</button>';
  host.append(root);
  const q = (k) => root.querySelector('[data-collage-tool="' + k + '"]'),
    listen = (n, t, f, options = {}) =>
      n.addEventListener(t, f, { ...options, signal: abort.signal });
  let page = "music",
    selected = new Set(),
    drag = null,
    disposed = false,
    imageBusy = false;
  const device = () =>
      panel.querySelector(".stm-collage")?.dataset.device === "mobile"
        ? "mobile"
        : "desktop",
    rows = () => getDesign().collage?.pages[page] || [],
    canvas = () => panel.querySelector(".stm-collage-canvas");
  for (const [i, id] of COLLAGE_PAGES.entries())
    q("page").append(
      new Option(["音乐页", "歌词页", "手记页", "曲目目录页"][i], id),
    );
  for (const [id, title] of Object.entries(COLLAGE_TYPES))
    q("type").append(new Option(title, id));
  function change(fn, { commit = true } = {}) {
    guard();
    const next = structuredClone(getDesign());
    next.collage ||= defaultCollage();
    fn(next.collage.pages[page]);
    update(next, { commit });
  }
  function decorate() {
    const c = canvas();
    if (!c) return;
    c.dataset.edit = String(q("editing").checked);
    for (const item of c.querySelectorAll("[data-collage-element]"))
      item.dataset.selected = String(selected.has(item.dataset.collageElement));
  }
  function refresh() {
    const design = getDesign();
    root.hidden =
      design.layout !== "journal" ||
      design.customization.journalMode !== "free";
    if (root.hidden) {
      if (canvas()) delete canvas().dataset.edit;
      return;
    }
    const list = q("layers");
    list.replaceChildren();
    for (const row of rows()) {
      const option = new Option(
        `${row.locked ? "🔒 " : ""}${row.hidden ? "隐藏 · " : ""}${COLLAGE_TYPES[row.type]}${row.text ? " · " + row.text.slice(0, 20) : ""}`,
        row.id,
      );
      option.selected = selected.has(row.id);
      list.append(option);
    }
    const first = rows().find((row) => selected.has(row.id));
    q("text").disabled = !first || !["text", "image"].includes(first.type);
    if (doc.activeElement !== q("text")) q("text").value = first?.text || "";
    for (const field of root.querySelectorAll("[data-collage-property]")) {
      const key = field.dataset.collageProperty;
      field.disabled = !first;
      if (first)
        field.value = ["x", "y", "w", "h"].includes(key)
          ? first[device()][key]
          : (first[key] ?? (key === "color" ? "#33443c" : ""));
    }
    decorate();
  }
  const properties = root.querySelector("[data-collage-properties]");
  for (const [key, label, min, max, step] of [
    ["x", "水平位置 %", 0, 95, 1],
    ["y", "垂直位置 %", 0, 98, 1],
    ["w", "宽度 %", 5, 100, 1],
    ["h", "高度 %", 2, 100, 1],
    ["fontSize", "字号 px", 13, 72, 1],
    ["weight", "字重", 400, 800, 50],
    ["lineHeight", "行距", 1.2, 2.6, 0.1],
    ["opacity", "透明度", 0, 1, 0.05],
    ["radius", "圆角", 0, 36, 1],
    ["z", "同类图层顺序", 0, 99, 1],
  ]) {
    const labelNode = doc.createElement("label"),
      input = doc.createElement("input");
    labelNode.textContent = label;
    input.type = "number";
    input.min = min;
    input.max = max;
    input.step = step;
    input.dataset.collageProperty = key;
    labelNode.append(input);
    properties.append(labelNode);
    listen(input, "change", () => {
      if (!input.checkValidity()) return;
      change((rows) => {
        for (const row of rows)
          if (selected.has(row.id) && !row.locked) {
            if (["x", "y", "w", "h"].includes(key)) {
              const r = row[device()];
              r[key] = Number(input.value);
              r.x = Math.min(r.x, 95);
              r.y = Math.min(r.y, 98);
              r.w = Math.min(r.w, 100 - r.x);
              r.h = Math.min(r.h, 100 - r.y);
            } else row[key] = Number(input.value);
          }
      });
    });
  }
  for (const [key, label, options] of [
    [
      "font",
      "字体",
      {
        inherit: "当前字体",
        sans: "系统黑体",
        serif: "系统衬线",
        monospace: "等宽",
      },
    ],
    ["align", "文字对齐", { start: "左", center: "中", end: "右" }],
  ]) {
    const wrapper = doc.createElement("label"),
      select = doc.createElement("select");
    wrapper.textContent = label;
    select.dataset.collageProperty = key;
    for (const [value, name] of Object.entries(options))
      select.append(new Option(name, value));
    wrapper.append(select);
    properties.append(wrapper);
    listen(select, "change", () =>
      change((rows) => {
        for (const row of rows)
          if (selected.has(row.id) && !row.locked) row[key] = select.value;
      }),
    );
  }
  const colorLabel = doc.createElement("label"),
    color = doc.createElement("input");
  colorLabel.textContent = "文字颜色（显示时保护对比度，不改原色）";
  color.type = "color";
  color.dataset.collageProperty = "color";
  colorLabel.append(color);
  properties.append(colorLabel);
  listen(color, "change", () =>
    change((rows) => {
      for (const row of rows)
        if (selected.has(row.id) && !row.locked) row.color = color.value;
    }),
  );
  listen(q("layers"), "change", () => {
    selected = new Set(
      [...q("layers").selectedOptions].map((row) => row.value),
    );
    refresh();
  });
  listen(q("text"), "change", () =>
    change((rows) => {
      for (const row of rows)
        if (
          selected.has(row.id) &&
          !row.locked &&
          ["text", "image"].includes(row.type)
        )
          row.text = q("text").value;
    }),
  );
  listen(q("editing"), "change", decorate);
  listen(q("page"), "change", () => {
    page = q("page").value;
    selected.clear();
    panel.querySelector('[data-collage-page="' + page + '"]')?.click();
    refresh();
  });
  listen(root, "click", (e) => {
    const op = e.target.closest("[data-collage-do]")?.dataset.collageDo;
    if (!op) return;
    try {
      if (op === "image") {
        q("file").click();
        return;
      }
      change((rows) => {
        if (op === "add") {
          if (rows.length >= 24) throw new Error("每页最多 24 个元素。");
          const type = q("type").value;
          if (
            !["text", "image", "line"].includes(type) &&
            rows.some((row) => row.type === type)
          )
            throw new Error("本页已有此真实组件，请选择已有图层。");
          const item = collageElement(type);
          rows.push(item);
          selected = new Set([item.id]);
        }
        if (op === "copy") {
          const copies = rows.filter((r) => selected.has(r.id));
          if (copies.some((r) => !["text", "image", "line"].includes(r.type)))
            throw new Error(
              "真实播放 / 歌词组件每页只保留一份，请复制文字或装饰。",
            );
          if (rows.length + copies.length > 24)
            throw new Error("每页最多 24 个元素。");
          selected = new Set();
          for (const row of copies) {
            const copy = structuredClone(row);
            copy.id = "e-" + createTrackId();
            copy.locked = false;
            for (const device of ["mobile", "desktop"]) {
              copy[device].x = Math.min(
                copy[device].x + 2,
                100 - copy[device].w,
              );
              copy[device].y = Math.min(
                copy[device].y + 2,
                100 - copy[device].h,
              );
            }
            rows.push(copy);
            selected.add(copy.id);
          }
        }
        if (op === "remove") {
          for (let i = rows.length - 1; i >= 0; i--)
            if (selected.has(rows[i].id) && !rows[i].locked) rows.splice(i, 1);
        }
        for (const row of rows)
          if (selected.has(row.id)) {
            if (op === "hide" && !row.locked) row.hidden = !row.hidden;
            if (op === "lock") row.locked = !row.locked;
          }
        if (op === "align") {
          const selectedRows = rows.filter(
              (r) => selected.has(r.id) && !r.locked,
            ),
            rects = selectedRows.map((r) => r[device()]);
          if (!rects.length) return;
          const left = Math.min(...rects.map((r) => r.x)),
            right = Math.max(...rects.map((r) => r.x + r.w)),
            top = Math.min(...rects.map((r) => r.y)),
            bottom = Math.max(...rects.map((r) => r.y + r.h));
          for (const r of rects) {
            const mode = q("align").value;
            if (mode === "left") r.x = left;
            if (mode === "center") r.x = (left + right - r.w) / 2;
            if (mode === "right") r.x = right - r.w;
            if (mode === "top") r.y = top;
            if (mode === "middle") r.y = (top + bottom - r.h) / 2;
            if (mode === "bottom") r.y = bottom - r.h;
          }
        }
      });
    } catch (error) {
      notice(error.message);
    }
  });
  listen(q("file"), "change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (imageBusy) {
      notice("上一张图片仍在处理中，请稍后再导入。");
      return;
    }
    imageBusy = true;
    q("file").disabled = true;
    let id;
    const existing = collageReferences(getDesign());
    try {
      guard();
      const before = JSON.stringify(getDesign());
      if (rows().length >= 24) throw new Error("每页最多 24 个元素。");
      id = await writeImage(file, abort.signal, q("optimize").checked);
      let total = 0;
      for (const asset of new Set([...existing, id]))
        total += (await readImage(asset))?.size || 0;
      if (total > COLLAGE_MAX_BYTES)
        throw new Error(
          "拼贴图片合计超过 8 MiB，请优化或替换图片；未更改正式设计。",
        );
      if (disposed) {
        retire([id]);
        return;
      }
      guard();
      if (before !== JSON.stringify(getDesign()))
        throw new Error("处理图片期间预览已改变，请重试；原设计未覆盖。");
      change((rows) => {
        const item = collageElement("image");
        item.assetId = id;
        item.text = file.name.slice(0, 200);
        rows.push(item);
        selected = new Set([item.id]);
      });
      notice("图片已加入预览；可试听并检查，应用后才保存正式设计。");
    } catch (error) {
      if (id && !existing.has(id)) retire([id]);
      notice(error.message);
    } finally {
      imageBusy = false;
      if (!disposed) q("file").disabled = false;
    }
  });
  listen(
    panel,
    "click",
    (e) => {
      if (q("editing").checked && e.target.closest(".stm-collage-canvas")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  listen(
    panel,
    "pointerdown",
    (e) => {
      if (!q("editing").checked || root.hidden || e.button !== 0) return;
      const item = e.target.closest("[data-collage-element]"),
        row = rows().find((r) => r.id === item?.dataset.collageElement);
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        if (selected.has(row.id)) selected.delete(row.id);
        else selected.add(row.id);
        refresh();
        return;
      }
      if (!selected.has(row.id)) selected = new Set([row.id]);
      if (row.locked) {
        refresh();
        return;
      }
      const box = item.getBoundingClientRect();
      drag = {
        x: e.clientX,
        y: e.clientY,
        bounds: canvas().getBoundingClientRect(),
        resize: e.clientX > box.right - 22 && e.clientY > box.bottom - 22,
        device: device(),
        original: structuredClone(getDesign()),
        ids: new Set(selected),
      };
      decorate();
    },
    { capture: true },
  );
  listen(
    win,
    "pointermove",
    (e) => {
      if (!drag) return;
      e.preventDefault();
      const dx = ((e.clientX - drag.x) * 100) / drag.bounds.width,
        dy = ((e.clientY - drag.y) * 100) / drag.bounds.height,
        next = structuredClone(drag.original),
        snap = (v) => (q("snap").checked ? Math.round(v / 5) * 5 : v);
      for (const row of next.collage.pages[page])
        if (drag.ids.has(row.id) && !row.locked) {
          const r = row[drag.device];
          if (drag.resize) {
            r.w = Math.max(5, Math.min(100 - r.x, snap(r.w + dx)));
            r.h = Math.max(2, Math.min(100 - r.y, snap(r.h + dy)));
          } else {
            r.x = Math.max(0, Math.min(100 - r.w, snap(r.x + dx)));
            r.y = Math.max(0, Math.min(100 - r.h, snap(r.y + dy)));
          }
        }
      try {
        guard();
        update(next, { commit: false });
      } catch {
        drag = null;
      }
    },
    { passive: false },
  );
  for (const event of ["pointerup", "pointercancel"])
    listen(win, event, () => {
      if (!drag) return;
      drag = null;
      try {
        guard();
        update(getDesign());
      } catch {}
    });
  listen(panel, "stm:collage-layout", decorate);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      drag = null;
      abort.abort();
      if (canvas()) delete canvas().dataset.edit;
      root.remove();
    },
  };
}
