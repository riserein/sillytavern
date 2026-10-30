import {
  lyricAnchors,
  normalizeTranslation,
  translationCandidates,
  translationBindingIssues,
} from "../translations.js";
/** Author-only: draft matching is never presented as confirmed synchronization. */
export function createTranslationEditor({
  panel,
  getTrack,
  onSave,
  onDisplay,
  onError,
}) {
  const doc = panel.ownerDocument,
    abort = new AbortController(),
    root = doc.createElement("section");
  root.id = "stm-translation-editor";
  root.className = "stm-queue-overlay stm-translation-editor";
  root.hidden = true;
  root.setAttribute("aria-label", "逐句译文匹配");
  root.innerHTML =
    '<div class="stm-tool-scroll"><header><h3>逐句译文匹配</h3><button type="button" class="stm-secondary" data-translation-action="close">取消 / 关闭</button></header><p class="stm-hint">译文单独保存，不拼入原 LRC。TXT 不会自动按行号同步；请预览并确认每句对应关系。</p><label>原文语言<input data-translation-field="sourceLanguage" maxlength="40" placeholder="例如：俄语"></label><label>译文语言<input data-translation-field="language" maxlength="40" placeholder="例如：中文"></label><label>译者、来源与分发说明<textarea data-translation-field="source" maxlength="1000" rows="2"></textarea></label><div class="stm-axis-tools"><button type="button" class="stm-secondary" data-translation-action="import">导入译文 LRC / TXT</button><button type="button" class="stm-secondary" data-translation-action="sequence">按顺序填入待确认草稿</button><button type="button" class="stm-secondary" data-translation-action="clear">清除本曲译文</button><input type="file" accept=".lrc,.txt,text/plain" data-translation-file hidden></div><ol class="stm-translation-match"></ol><label class="stm-check-label"><input type="checkbox" data-translation-field="confirmed">我已检查原文与译文的逐句对应关系</label><label class="stm-check-label"><input type="checkbox" data-translation-field="distribute">随角色卡携带译文</label><label class="stm-check-label"><input type="checkbox" data-translation-field="rightsConfirmed">我确认有权分发这些译文，并已填写署名或授权说明</label><p class="stm-hint" data-translation-status role="status"></p><button type="button" class="stm-primary" data-translation-action="save">确认保存译文</button></div>';
  panel.append(root);
  const q = (s) => root.querySelector(s),
    on = (node, type, fn) =>
      node.addEventListener(type, fn, { signal: abort.signal });
  let target = null,
    draft = null,
    main = null,
    other = null,
    baseline = "",
    original = "",
    generation = 0,
    disposed = false,
    dirty = false;
  const status = (text) => (q("[data-translation-status]").textContent = text);
  function close(force = false) {
    if (!force && dirty && !doc.defaultView.confirm("放弃尚未保存的译文匹配？"))
      return;
    generation++;
    onDisplay(false);
    target = null;
    draft = null;
    main = null;
    other = null;
    dirty = false;
  }
  function render() {
    if (!draft) return;
    for (const field of root.querySelectorAll("[data-translation-field]")) {
      const value = draft[field.dataset.translationField];
      if (field.type === "checkbox") field.checked = !!value;
      else field.value = value || "";
    }
    const list = q("ol");
    list.replaceChildren();
    for (const row of main.rows) {
      const li = doc.createElement("li"),
        originalText = doc.createElement("p"),
        select = doc.createElement("select"),
        text = doc.createElement("textarea");
      originalText.textContent = row.text || "♪";
      select.dataset.translationMatch = row.id;
      select.setAttribute("aria-label", "选择对应的译文句子");
      select.append(
        new Option("手动填写 / 尚未匹配", ""),
        ...(other?.rows || []).map(
          (candidate) =>
            new Option(
              (candidate.time === null
                ? "无时间轴"
                : candidate.time.toFixed(2) + " 秒") +
                " · " +
                candidate.text,
              candidate.id,
            ),
        ),
      );
      const match = draft.bindings.find((r) => r.lineId === row.id);
      if (match && match.originalHash !== row.originalHash)
        originalText.append(doc.createTextNode("（原文已变化，请核对译文）"));
      select.value = match?.sourceLineId || "";
      text.dataset.translationText = row.id;
      text.rows = 2;
      text.maxLength = 4000;
      text.value = match?.text || "";
      text.setAttribute("aria-label", "译文：" + row.text.slice(0, 80));
      li.append(originalText, select, text);
      list.append(li);
    }
    status(
      `已填 ${draft.bindings.filter((r) => r.text?.trim()).length} / ${main.rows.length} 句。未填句保留原文，不伪装为完整翻译。`,
    );
  }
  function open(id) {
    const track = getTrack(id);
    if (!track) throw new Error("歌曲已不存在。");
    main = lyricAnchors(track.lyrics || "");
    if (!main.rows.length) throw new Error("请先导入原文歌词。");
    target = id;
    baseline = JSON.stringify(track.translation || null);
    original = track.lyrics || "";
    draft = normalizeTranslation(track.translation) || {
      version: 1,
      sourceLanguage: "",
      language: "中文",
      source: "",
      sourceLyrics: "",
      confirmed: false,
      distribute: false,
      rightsConfirmed: false,
      bindings: [],
    };
    other = draft.sourceLyrics ? lyricAnchors(draft.sourceLyrics) : null;
    if (translationBindingIssues(track).length) draft.confirmed = false;
    dirty = false;
    generation++;
    onDisplay(true);
    render();
  }
  function edit(id, text, sourceRow) {
    const row = main.rows.find((r) => r.id === id);
    if (!row) return;
    draft.bindings = draft.bindings.filter((r) => r.lineId !== id);
    if (text.trim())
      draft.bindings.push({
        lineId: id,
        originalHash: row.originalHash,
        text,
        ...(sourceRow
          ? {
              sourceLineId: sourceRow.id,
              ...(sourceRow.time !== null
                ? { sourceTime: sourceRow.time }
                : {}),
            }
          : {}),
      });
    draft.confirmed = false;
    q("[data-translation-field=confirmed]").checked = false;
    dirty = true;
    status("已修改逐句译文，请重新确认对应关系。");
  }
  on(root, "input", (e) => {
    if (e.target.dataset.translationText) {
      edit(e.target.dataset.translationText, e.target.value);
      return;
    }
    const key = e.target.dataset.translationField;
    if (key) {
      draft[key] =
        e.target.type === "checkbox" ? e.target.checked : e.target.value;
      dirty = true;
    }
  });
  on(root, "change", async (e) => {
    try {
      if (e.target.dataset.translationMatch) {
        const id = e.target.dataset.translationMatch,
          source = other?.rows.find((r) => r.id === e.target.value);
        edit(id, source?.text || "", source);
        render();
        return;
      }
      if (e.target.matches("[data-translation-file]")) {
        const file = e.target.files[0],
          stamp = generation;
        e.target.value = "";
        if (!file) return;
        if (file.size > 200000)
          throw new Error("译文文件超过 200 KB，未读取。");
        const text = await file.text();
        if (disposed || stamp !== generation) return;
        const candidates = translationCandidates(original, text);
        other = candidates.other;
        draft.sourceLyrics = text;
        draft.bindings = candidates.rows.filter((r) => r.text.trim());
        draft.confirmed = false;
        dirty = true;
        render();
        status(
          "已读取译文并预览时间匹配；TXT 没有自动对应，请逐句选择或手动填写并确认。",
        );
      }
    } catch (error) {
      onError(error);
      status(error.message);
    }
  });
  on(root, "click", async (e) => {
    const action = e.target.closest("[data-translation-action]")?.dataset
      .translationAction;
    if (!action || !draft) return;
    try {
      if (action === "close") return close();
      if (action === "import") {
        q("[data-translation-file]").click();
        return;
      }
      if (action === "sequence") {
        if (!other?.rows.length) throw new Error("请先导入译文文件。");
        draft.bindings = main.rows.flatMap((row, i) =>
          other.rows[i]?.text?.trim()
            ? [
                {
                  lineId: row.id,
                  originalHash: row.originalHash,
                  text: other.rows[i].text,
                  sourceLineId: other.rows[i].id,
                  ...(other.rows[i].time !== null
                    ? { sourceTime: other.rows[i].time }
                    : {}),
                },
              ]
            : [],
        );
        draft.confirmed = false;
        dirty = true;
        render();
        status(
          "这是按顺序填入的草稿，尚未确认同步。请检查每句、修正错配，再勾选确认。",
        );
        return;
      }
      if (action === "clear") {
        if (JSON.stringify(getTrack(target)?.translation || null) !== baseline)
          throw new Error("正式译文已改变，请重新读取；未清除新内容。");
        if (!doc.defaultView.confirm("清除本曲正式译文？原文歌词保留。"))
          return;
        await onSave(target, null);
        close(true);
        return;
      }
      if (action === "save") {
        if (
          (getTrack(target)?.lyrics || "") !== original ||
          JSON.stringify(getTrack(target)?.translation || null) !== baseline
        )
          throw new Error(
            "原文或正式译文在编辑期间已改变，请重新读取；未覆盖新内容。",
          );
        const known = new Map(
            main.rows.map((row) => [row.id, row.originalHash]),
          ),
          orphans = draft.bindings.filter((row) => !known.has(row.lineId));
        if (orphans.length) {
          if (
            !doc.defaultView.confirm(
              orphans.length +
                " 条旧译文在新原文中没有对应行。保留在原始译文文本中，并移出同步匹配列表？",
            )
          )
            return;
          if (!draft.sourceLyrics)
            draft.sourceLyrics = draft.bindings
              .map((row) => row.text)
              .join("\n");
          draft.bindings = draft.bindings.filter((row) =>
            known.has(row.lineId),
          );
        }
        if (draft.confirmed)
          draft.bindings = draft.bindings.map((row) => ({
            ...row,
            originalHash: known.get(row.lineId) || row.originalHash,
          }));
        const normalized = normalizeTranslation(draft);
        if (!normalized)
          throw new Error(
            "请填写有效译文；每句最多 2000 字，总译文最多 50,000 字符。",
          );
        if (!normalized.confirmed)
          throw new Error("请先检查并确认原文与译文的对应关系。");
        if (
          normalized.distribute &&
          (!normalized.rightsConfirmed || !normalized.source.trim())
        )
          throw new Error("随卡携带前请确认分发授权，并填写译者／来源说明。");
        await onSave(target, normalized);
        baseline = JSON.stringify(normalized);
        draft = structuredClone(normalized);
        dirty = false;
        status("译文已保存，原文与原始译文时间戳均未改写。");
      }
    } catch (error) {
      onError(error);
      status(error.message);
    }
  });
  on(root, "keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
  return {
    open,
    close,
    dispose() {
      disposed = true;
      generation++;
      abort.abort();
      root.remove();
    },
  };
}
