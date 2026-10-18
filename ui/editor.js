import {
  LAYOUTS,
  LAUNCHERS,
  DESIGN_THEMES,
  MOTION_LEVELS,
  normalizeDesign,
  createDesignHistory,
  validateTemplate,
  randomColors,
} from "./config.js";
import { COMPONENTS } from "./components.js";
import { contrastRatio, readableColors } from "./contrast.js";
import { FONT_PRESETS } from "../fonts.js";
/** Author-only editor. The preview is the live player, never a second Audio or iframe. */
export function createDesignEditor({
  panel,
  launcher,
  settings,
  getDesign,
  getContext,
  preview,
  apply,
  save,
  bind,
  readIcon,
  writeIcon,
  retireAssets,
  showPage,
  setOpen,
}) {
  const doc = panel.ownerDocument,
    win = doc.defaultView,
    abort = new AbortController(),
    entry = doc.createElement("button");
  entry.type = "button";
  entry.className = "stm-secondary";
  entry.dataset.action = "open-designer";
  entry.textContent = "打开播放器设计器 · 我的设计";
  panel.querySelector(".stm-design-settings summary").after(entry);
  let root = null,
    history = null,
    selected = "cover",
    disposed = false,
    editorAbort = null,
    observer = null,
    frame = null,
    returnFocus = null,
    launchHidden = false,
    canvas = null,
    working = null,
    busy = false,
    epoch = 0,
    openingAvatar = null;
  const imported = new Set(),
    locks = new Set();
  const q = (s) => root.querySelector(s),
    listen = (node, event, callback, options = {}) =>
      node.addEventListener(event, callback, {
        ...options,
        signal: editorAbort.signal,
      });
  const notice = (text) => {
    if (root) q("[data-editor-status]").textContent = text;
  };
  function update(value, { commit = true } = {}) {
    working = normalizeDesign(value);
    if (commit) history.push(working);
    preview(working);
    refresh();
  }
  function change(field, value) {
    const next = structuredClone(working);
    if (field.startsWith("c.")) next.customization[field.slice(2)] = value;
    else next[field] = value;
    update(next);
  }
  function refresh() {
    if (!root) return;
    for (const element of root.querySelectorAll("[data-field]")) {
      const field = element.dataset.field,
        value = field.startsWith("c.")
          ? working.customization[field.slice(2)]
          : working[field];
      if (element.type === "checkbox") element.checked = Boolean(value);
      else element.value = String(value ?? (element.type==='color'?'#a8bec7':''));
    }
    q("[data-undo]").disabled = !history.canUndo;
    q("[data-redo]").disabled = !history.canRedo;
    const colors = working.customization.colors;
    for (const input of root.querySelectorAll("[data-color]"))
      input.value =
        colors[input.dataset.color] ||
        DESIGN_THEMES[working.theme]?.[input.dataset.color] ||
        "#536e7a";
    const c = working.components[selected];
    q("[data-component]").value = selected;
    for (const input of root.querySelectorAll("[data-prop]")) {
      const value = c[input.dataset.prop];
      if (input.type === "checkbox") input.checked = value;
      else
        input.value = String(
          value ??
            ({ size: 1, margin: 0, opacity: 1, radius: 18, color: "#a8bec7" }[
              input.dataset.prop
            ] ||
              "auto"),
        );
    }
    for (const input of root.querySelectorAll("[data-prop]"))
      input.disabled =
        selected === "background" &&
        ["size", "margin", "position"].includes(input.dataset.prop);
    q("[data-color-warning]").textContent =
      colors.background &&
      colors.text &&
      contrastRatio(colors.background, colors.text) < 4.5
        ? "文字与背景对比度偏低，可调整颜色或解锁文字色后随机配色。"
        : "";
  }
  function layout() {
    if (!root) return;
    const narrow = win.innerWidth < 850,
      section = root.dataset.section,
      rect = canvas.getBoundingClientRect();
    panel.dataset.editorHidden = String(narrow && section !== "preview");
    const mobile = root.dataset.device === "mobile",
      width = Math.min(rect.width - 20, mobile ? 390 : 660),
      height = Math.max(300, Math.min(rect.height - 20, 850));
    for (const [key, value] of Object.entries({
      left: rect.x + (rect.width - width) / 2,
      top: rect.y + 10,
      width,
      height,
    }))
      panel.style.setProperty("--editor-" + key, value + "px");
  }
  function queueLayout() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => {
      frame = null;
      layout();
    });
  }
  function currentAvatar() {
    return getContext()?.characters?.[getContext().characterId]?.avatar || null;
  }
  function guard() {
    if (!root || disposed || currentAvatar() !== openingAvatar)
      throw new Error("当前角色已改变，请关闭设计器后为新角色重新打开。");
  }
  function rebuildTemplates() {
    const select = q("[data-templates]");
    const old = select.value;
    select.replaceChildren(new Option("选择一套已保存设计", ""));
    for (const row of settings.designs)
      select.append(new Option(row.name, row.id));
    select.value = old;
  }
  const selectedTemplate = () =>
    settings.designs.find((row) => row.id === q("[data-templates]").value);
  function download(name, blob) {
    const url = URL.createObjectURL(blob),
      link = doc.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    win.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    const revision = epoch;
    try {
      guard();
      await fn();
    } catch (error) {
      if (root && epoch === revision)
        notice(error.message || "操作未完成，原设计保留。");
    } finally {
      if (epoch === revision) busy = false;
    }
  }
  function close() {
    if (!root) return;
    epoch++;
    busy = false;
    editorAbort.abort();
    observer.disconnect();
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    panel.removeAttribute("data-editor-preview");
    panel.removeAttribute("data-editor-hidden");
    for (const key of ["left", "top", "width", "height"])
      panel.style.removeProperty("--editor-" + key);
    launcher.hidden = launchHidden;
    preview(null);
    root.remove();
    root = null;
    for (const id of imported) retireAssets([id]);
    imported.clear();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function open() {
    if (root || disposed) return;
    openingAvatar = currentAvatar();
    working = normalizeDesign(getDesign());
    history = createDesignHistory(working);
    editorAbort = new AbortController();
    returnFocus = doc.activeElement;
    launchHidden = launcher.hidden;
    launcher.hidden = true;
    setOpen(true);
    showPage("playback");
    root = doc.createElement("section");
    root.className = "stm-design-editor";
    root.dataset.section = "preview";
    root.dataset.device = "desktop";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "音乐播放器设计器");
    root.innerHTML = `<header><div><small>PLAYER STUDIO</small><h2>音乐播放器设计器</h2></div><button type="button" data-editor-close aria-label="关闭设计器">×</button></header><nav class="stm-editor-steps" aria-label="设计步骤"><button data-step="templates">1 · 模板</button><button data-step="preview">2 · 预览</button><button data-step="properties">3 · 属性</button></nav><div class="stm-editor-body"><aside data-editor-pane="templates"><h3>模板与形态</h3><div data-layout-fields></div><button data-icon-import>导入静态悬浮图标</button><input data-icon-file type="file" accept="image/png,image/webp,.png,.webp" hidden><h3>我的设计</h3><select data-templates aria-label="我的设计"></select><input data-template-name maxlength="80" placeholder="设计名称" aria-label="设计名称"><div class="stm-editor-actions"><button data-template-save>保存为模板</button><button data-template-rename>重命名</button><button data-template-copy>复制</button><button data-template-delete>删除</button><button data-template-export>导出 JSON</button><button data-template-import>导入 JSON</button></div><input data-template-file type="file" accept="application/json,.json" hidden><h3>配色</h3><div data-colors></div><button data-random>随机配色</button><p data-color-warning role="status"></p></aside><section data-editor-pane="preview"><div class="stm-editor-preview-tools"><button data-device="desktop">桌面</button><button data-device="mobile">手机</button><label><input type="checkbox" data-audition checked>试听操作</label></div><p>试听操作可播放、切歌及查看歌词；取消勾选后，点击播放器组件查看对应属性。</p><div class="stm-editor-canvas" aria-label="实时播放器预览"></div></section><aside data-editor-pane="properties"><h3>组件属性</h3><select data-component aria-label="选中的组件"></select><div data-props></div><h3>布局细节</h3><div data-detail-fields></div><h3>角色专属设计</h3><select data-bind-role aria-label="绑定目标角色"></select><select data-bind-playlist aria-label="绑定角色的歌单"></select><button data-bind>保存设计并绑定歌单</button><p>保存到角色后，使用酒馆原生 PNG / JSON 导出。接收端需允许酒馆助手角色脚本；不会携带全部模板。</p></aside></div><footer><div class="stm-editor-actions"><button data-undo>撤销</button><button data-redo>重做</button><button data-reset>恢复默认</button><button data-apply>应用设计</button></div><p data-editor-status role="status">正在预览，尚未应用的改动不会写入原设计。音乐使用原播放器实例。</p></footer>`;
    doc.body.append(root);
    canvas = q(".stm-editor-canvas");
    panel.dataset.editorPreview = "true";
    function field(
      label,
      id,
      { options, min, max, step = 1, checkbox = false, color = false } = {},
      parent = q("[data-detail-fields]"),
    ) {
      const wrap = doc.createElement("label");
      wrap.textContent = label;
      let input = doc.createElement(options ? "select" : "input");
      input.dataset.field = id;
      if (options)
        for (const [value, name] of Object.entries(options))
          input.append(new Option(name, value));
      else if (checkbox) input.type = "checkbox";
      else if(color)input.type="color";
      else {
        input.type = "range";
        input.min = min;
        input.max = max;
        input.step = step;
      }
      wrap.append(input);
      parent.append(wrap);
      listen(input, "change", () =>
        change(
          id,
          checkbox
            ? input.checked
            : options||color
              ? input.value
              : Number(input.value),
        ),
      );
    }
    const left = q("[data-layout-fields]");
    field(
      "播放器布局",
      "layout",
      {
        options: Object.fromEntries(
          Object.entries(LAYOUTS).map(([id, e]) => [id, e.name]),
        ),
      },
      left,
    );
    field(
      "视觉主题",
      "theme",
      {
        options: Object.fromEntries(
          Object.entries(DESIGN_THEMES).map(([id, e]) => [id, e.name]),
        ),
      },
      left,
    );
    field("悬浮组件", "launcher", { options: LAUNCHERS }, left);
    field("字体", "fontPreset", {
      options: {
        current: "沿用外观中当前字体",
        ...Object.fromEntries(
          Object.entries(FONT_PRESETS)
            .filter(([id]) => id !== "custom")
            .map(([id, e]) => [id, e.name]),
        ),
      },
    });
    for (const [label, id, min, max, step] of [
      ["封面尺寸", "coverSize", 0.55, 1.15, 0.01],
      ["外壳圆角", "cornerRadius", 0, 36, 1],
      ["磁带外壳透明度","tapeOpacity",.35,1,.01],
      ["背景透明度", "opacity", 0.3, 1, 0.01],
      ["模糊强度", "blur", 0, 24, 1],
      ["播放按钮尺寸", "buttonSize", 40, 68, 1],
      ["标题尺寸", "titleSize", 16, 36, 1],
      ["悬浮组件尺寸", "launcherSize", 40, 88, 1],
      ["图标边框", "launcherBorder", 0, 4, 1],
      ["悬浮组件透明度", "launcherOpacity", 0.45, 1, 0.01],
    ])
      field(label, "c." + id, { min, max, step });
    for (const [label, id, options] of [
      [
        "动画等级",
        "animationLevel",
        Object.fromEntries(
          MOTION_LEVELS.map((id, i) => [
            id,
            ["关闭", "轻量", "标准", "丰富"][i],
          ]),
        ),
      ],
      [
        "玻璃材质",
        "material",
        { clear: "清透", frosted: "磨砂", liquid: "水光" },
      ],
      [
        "机身材质",
        "body",
        {
          walnut: "胡桃木",
          metal: "深色金属",
          ceramic: "暖白陶瓷",
          silver: "磨砂银",
        },
      ],
      ["唱片外圈", "grooves", { fine: "细密", bold: "粗纹" }],
      ["铭牌样式","nameplate",{engraved:"雕刻铭牌",plain:"简洁铭牌"}],
      ["磁带转轴","reelStyle",{classic:"经典齿轮",spoke:"银色轮辐"}],
      ["极简方向", "orientation", { horizontal: "横向", vertical: "竖向" }],
      [
        "图标形状",
        "launcherShape",
        { circle: "圆形", rounded: "圆角", square: "方形" },
      ],
    ])
      field(label, "c." + id, { options });
    for (const [label, id] of [
      ["显示歌手", "showArtist"],
      ["显示歌词入口", "showLyricsButton"],
      ["显示进度", "showProgress"],
      ["显示音量", "showVolume"],
      ["显示播放模式", "showMode"],
      ["显示队列", "showQueue"],
      ["显示装饰", "showDecorations"],
      ["唱片旋转","rotate"],["装饰刻度","showScale"],
      ["显示背景图片", "showBackground"],
      ["显示磁带曲目编号", "showTrackNumber"],
      ["胶囊显示下一首", "showNext"],
      ["极简专注模式", "focus"],
    ])
      field(label, "c." + id, { checkbox: true });
    field("唱臂颜色","c.tonearmColor",{color:true});field("磁带标签颜色","c.labelColor",{color:true});
    field("允许接收端修改布局", "allowRecipientLayout", { checkbox: true });
    for (const [key, name] of Object.entries({
      background: "主背景",
      surface: "次级背景",
      text: "文字",
      muted: "辅助文字",
      accent: "强调",
      border: "边框",
    })) {
      const label = doc.createElement("label");
      label.textContent = name;
      const input = doc.createElement("input");
      input.type = "color";
      input.dataset.color = key;
      const lock = doc.createElement("input");
      lock.type = "checkbox";
      lock.setAttribute("aria-label", "锁定" + name);
      lock.checked = locks.has(key);
      label.append(input, "锁定", lock);
      q("[data-colors]").append(label);
      listen(input, "change", () => {
        const next = structuredClone(working);
        next.customization.colors[key] = input.value;
        update(next);
      });
      listen(lock, "change", () =>
        lock.checked ? locks.add(key) : locks.delete(key),
      );
    }
    for (const [id, e] of Object.entries(COMPONENTS))
      q("[data-component]").append(new Option(e.name, id));
    listen(q("[data-component]"), "change", (e) => {
      selected = e.target.value;
      refresh();
    });
    for (const [key, name, type, min, max, step] of [
      ["visible", "显示", "checkbox"],
      ["size", "尺寸", "range", 0.65, 1.3, 0.01],
      ["margin", "边距", "range", 0, 24, 1],
      ["color", "颜色", "color"],
      ["opacity", "透明度", "range", 0.5, 1, 0.01],
      ["radius", "圆角", "range", 0, 36, 1],
      ["position", "预设位置", "select"],
    ]) {
      const label = doc.createElement("label");
      label.textContent = name;
      const input = doc.createElement(type === "select" ? "select" : "input");
      input.dataset.prop = key;
      if (type === "select")
        for (const [value, name] of Object.entries({
          auto: "沿用模板",
          start: "模板区域起始",
          center: "模板区域居中",
          end: "模板区域末端",
        }))
          input.append(new Option(name, value));
      else {
        input.type = type;
        if (min !== undefined) {
          input.min = min;
          input.max = max;
          input.step = step;
        }
      }
      label.append(input);
      q("[data-props]").append(label);
      listen(input, "change", () => {
        const next = structuredClone(working);
        next.components[selected][key] =
          type === "checkbox"
            ? input.checked
            : type === "range"
              ? Number(input.value)
              : input.value;
        update(next);
      });
    }
    listen(q("[data-random]"), "click", () => {
      const next = structuredClone(working);
      next.customization.colors = readableColors(
        randomColors(next.customization.colors, locks),
        locks,
      );
      update(next);
    });
    listen(q("[data-undo]"), "click", () =>
      update(history.undo(), { commit: false }),
    );
    listen(q("[data-redo]"), "click", () =>
      update(history.redo(), { commit: false }),
    );
    listen(q("[data-reset]"), "click", () => {
      if (win.confirm("恢复此预览的默认设计？已保存模板和音乐保持不变。"))
        update(normalizeDesign({ layout: working.layout }));
    });
    listen(q("[data-apply]"), "click", () =>
      action(async () => {
        const old = normalizeDesign(getDesign()).customization.iconId;
        apply(working);
        if (old && old !== working.customization.iconId) retireAssets([old]);
        notice("已应用设计。已分发的角色卡需要重新导出才会更新。");
      }),
    );
    listen(q("[data-template-save]"), "click", () =>
      action(async () => {
        if (settings.designs.length >= 30)
          throw new Error("最多保存 30 套设计，请先导出或删除不需要的设计。");
        const row = {
          id: "design:" + crypto.randomUUID(),
          name: q("[data-template-name]").value.trim() || "我的设计",
          config: structuredClone(working),
        };
        settings.designs.push(row);
        save();
        rebuildTemplates();
        q("[data-templates]").value = row.id;
        notice("设计模板已保存，也会纳入完整 ZIP 备份。");
      }),
    );
    listen(q("[data-templates]"), "change", () => {
      const row = selectedTemplate();
      if (row) {
        q("[data-template-name]").value = row.name;
        update(row.config);
      }
    });
    for (const operation of ["rename", "copy", "delete"])
      listen(q("[data-template-" + operation + "]"), "click", () =>
        action(async () => {
          const row = selectedTemplate();
          if (!row) throw new Error("请先选择一套已保存的设计。");
          if (operation === "rename") {
            row.name = q("[data-template-name]").value.trim() || row.name;
          } else if (operation === "copy") {
            if (settings.designs.length >= 30)
              throw new Error("已达到 30 套设计上限。");
            settings.designs.push({
              ...structuredClone(row),
              id: "design:" + crypto.randomUUID(),
              name: (row.name + " · 副本").slice(0, 80),
            });
          } else {
            if (
              !win.confirm(
                "删除设计模板「" +
                  row.name +
                  "」？当前应用的设计与音乐将保留。",
              )
            )
              return;
            settings.designs = settings.designs.filter(
              (item) => item.id !== row.id,
            );
          }
          save();
          rebuildTemplates();
          if (operation === "delete" && row.config.customization.iconId)
            retireAssets([row.config.customization.iconId]);
          notice("我的设计已更新。");
        }),
      );
    listen(q("[data-template-export]"), "click", () =>
      action(async () => {
        const config = structuredClone(working),
          id = config.customization.iconId;
        let icon;
        if (config.launcher === "custom" && id) {
          const blob = await readIcon(id);
          if (!blob) throw new Error("图标文件缺失，未导出不完整模板。");
          icon = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        guard();
        config.customization.iconId = null;
        download(
          "播放器设计.json",
          new Blob(
            [
              JSON.stringify(
                {
                  format: "riserein-player-design",
                  version: 1,
                  name: q("[data-template-name]").value || "我的设计",
                  config,
                  ...(icon ? { icon } : {}),
                },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
        );
        notice("已导出安全配置与当前图标，不包含歌曲或可执行代码。");
      }),
    );
    listen(q("[data-icon-import]"), "click", () =>
      q("[data-icon-file]").click(),
    );
    listen(q("[data-icon-file]"), "change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      void action(async () => {
        const turn = epoch,
          before = JSON.stringify(working),
          signal = editorAbort.signal,
          id = await writeIcon(file, signal);
        if (!root || turn !== epoch) {
          retireAssets([id]);
          return;
        }
        imported.add(id);
        guard();
        if (before !== JSON.stringify(working))
          throw new Error("处理图标期间设计已改变，未覆盖当前预览。");
        const next = structuredClone(working);
        next.launcher = "custom";
        next.customization.iconId = id;
        update(next);
        notice("图标已加入预览，应用设计或保存模板后保留。");
      });
    });
    listen(q("[data-template-import]"), "click", () =>
      q("[data-template-file]").click(),
    );
    listen(q("[data-template-file]"), "change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      void action(async () => {
        const turn = epoch,
          signal = editorAbort.signal,
          before = JSON.stringify(working);
        if (file.size > 2 * 1024 * 1024)
          throw new Error("设计文件超过 2 MiB。");
        const template = validateTemplate(JSON.parse(await file.text()));
        signal.throwIfAborted();
        template.config.customization.iconId = null;
        if (template.icon) {
          const blob = await (await fetch(template.icon)).blob();
          const id = await writeIcon(blob, signal);
          if (!root || turn !== epoch) {
            retireAssets([id]);
            return;
          }
          imported.add(id);
          template.config.customization.iconId = id;
        }
        guard();
        if (turn !== epoch) return;
        if (before !== JSON.stringify(working))
          throw new Error("导入期间预览已改变，未覆盖当前设计；请重试。");
        update(template.config);
        q("[data-template-name]").value = template.name;
        notice("导入检查通过，正在预览；点击保存为模板或应用设计。");
      });
    });
    const context = getContext();
    q("[data-bind-role]").append(new Option("选择目标角色", ""));
    for (const card of context?.characters || [])
      if (card.avatar)
        q("[data-bind-role]").append(
          new Option(card.name || card.avatar, card.avatar),
        );
    q("[data-bind-role]").value = openingAvatar || "";
    q("[data-bind-playlist]").append(new Option("选择已创建的歌单", ""));
    for (const list of settings.playlists)
      q("[data-bind-playlist]").append(new Option(list.name, list.id));
    listen(q("[data-bind]"), "click", () =>
      action(async () => {
        const avatar = q("[data-bind-role]").value,
          playlist = q("[data-bind-playlist]").value;
        if (!avatar || !playlist)
          throw new Error("先选择目标角色和歌单，再保存绑定。");
        notice("正在保存设计与随卡音乐…");
        await bind(avatar, playlist, structuredClone(working));
        notice(
          "设计和歌单已绑定，并写入随卡播放器。请使用酒馆原生按钮导出 PNG / JSON。",
        );
      }),
    );
    for (const button of root.querySelectorAll("[data-step]"))
      listen(button, "click", () => {
        root.dataset.section = button.dataset.step;
        layout();
      });
    for (const button of root.querySelectorAll("[data-device]"))
      listen(button, "click", () => {
        root.dataset.device = button.dataset.device;
        layout();
      });
    listen(
      panel,
      "click",
      (event) => {
        if (q("[data-audition]").checked) return;
        const element = event.target.closest("[data-design-component]");
        if (element) {
          event.preventDefault();
          event.stopImmediatePropagation();
          selected = element.dataset.designComponent;
          root.dataset.section = "properties";
          refresh();
          layout();
        }
      },
      { capture: true },
    );
    // The live panel stays in its original document and parent. No audio removal,
    // reparenting, source changes or user-window-position writes occur for preview.
    const preventDrag = (event) => {
      if (event.target.closest(".stm-header,.stm-resize-handle")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    panel.addEventListener("pointerdown", preventDrag, {
      capture: true,
      signal: editorAbort.signal,
    });
    listen(q("[data-editor-close]"), "click", close);
    listen(win, "resize", queueLayout);
    listen(
      doc,
      "keydown",
      (event) => {
        if (
          event.target.closest(".stm-header,.stm-resize-handle") &&
          event.key.startsWith("Arrow")
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          close();
          return;
        }
        if (event.key !== "Tab") return;
        const nodes = [
          ...root.querySelectorAll("button,input,select"),
          ...panel.querySelectorAll('button,input,select,[tabindex="0"]'),
        ].filter(
          (el) =>
            !el.disabled &&
            !el.hidden &&
            el.getClientRects().length &&
            getComputedStyle(el).visibility !== "hidden" &&
            !el.closest("[inert]"),
        );
        const at = nodes.indexOf(doc.activeElement);
        if (
          at < 0 ||
          (!event.shiftKey && at === nodes.length - 1) ||
          (event.shiftKey && at === 0)
        ) {
          event.preventDefault();
          (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
        }
      },
      { capture: true },
    );
    observer = new ResizeObserver(queueLayout);
    observer.observe(canvas);
    rebuildTemplates();
    refresh();
    preview(working);
    layout();
    q("[data-editor-close]").focus();
  }
  entry.addEventListener("click", open, { signal: abort.signal });
  return {
    open,
    close,
    get opened() {
      return Boolean(root);
    },
    dispose() {
      disposed = true;
      close();
      abort.abort();
      entry.remove();
    },
  };
}
