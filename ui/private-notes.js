import { PrivateNotesStore, validatePrivateNotes } from "../private-notes.js";
/** Player-owned personal state, deliberately outside author settings and card serializers. */
export function createPrivateNotes({
  host,
  author,
  authorize,
  getScope,
  getTrack,
  getScene,
}) {
  const doc = host.ownerDocument,
    abort = new AbortController(),
    store = new PrivateNotesStore({
      authorize,
      indexedDB: doc.defaultView.indexedDB,
    }),
    root = doc.createElement("section");
  root.className = "stm-private-notes";
  root.innerHTML =
    '<nav aria-label="手记归属"><button type="button" data-note-tab="author" aria-pressed="true">作者手记</button><button type="button" data-note-tab="mine" aria-pressed="false">我的手记</button></nav><div data-note-personal hidden><p class="stm-hint">仅存当前账号的本地私人空间，不随角色卡或模板分享。每条最多 2000 字，账号合计 200 条 / 1 MiB。请主动导出私人备份。</p><label class="stm-check-label"><input type="checkbox" data-note-all>显示本角色全部手记</label><ol data-note-list></ol><button type="button" class="stm-secondary" data-note-action="new">新建手记</button><p class="stm-hint" data-note-association></p><label>我的音乐日记<textarea data-note-text maxlength="4000" rows="6" placeholder="写下此刻的心情…"></textarea></label><div class="stm-axis-tools"><button type="button" data-note-action="save">保存手记</button><button type="button" class="stm-secondary" data-note-action="cancel">取消编辑 / 重新读取</button><button type="button" class="stm-secondary" data-note-action="delete" disabled>删除本条</button></div><details><summary>私人手记备份与恢复</summary><p class="stm-hint">此文件含私人文字，勿作为角色卡素材分享。导入只创建副本，不覆盖原文；会归入当前角色和脚本。</p><button type="button" class="stm-secondary" data-note-action="export">导出本角色私人手记</button><button type="button" class="stm-secondary" data-note-action="import">导入私人备份</button><input data-note-file type="file" accept=".json,application/json" hidden></details><p role="status" data-note-status class="stm-hint"></p></div>';
  host.prepend(root);
  const q = (s) => root.querySelector(s),
    on = (n, t, f) => n.addEventListener(t, f, { signal: abort.signal });
  let disposed = false,
    scopeKey = "",
    editing = null,
    binding = null,
    dirty = false,
    turn = 0,
    busy = false;
  const current = () => ({ ...getScope(), project: getScope().project || "" }),
    key = (scope) => JSON.stringify(scope),
    status = (t) => {
      if (!disposed) q("[data-note-status]").textContent = t;
    };
  function clear() {
    editing = null;
    binding = null;
    dirty = false;
    q("[data-note-text]").value = "";
    q("[data-note-action=delete]").disabled = true;
    associate();
  }
  function associate() {
    const track = getTrack(),
      scene = getScene();
    binding ||= {
      ...current(),
      trackId: track?.id || "",
      trackTitle: track?.title || "",
      sceneId: scene?.id || "",
      sceneName: scene?.name || "",
    };
    q("[data-note-association]").textContent =
      `关联：${binding.trackTitle || "无歌曲"}${binding.sceneName ? " · " + binding.sceneName : ""}${editing ? " · " + new Date(editing.created).toLocaleString() : ""}`;
  }
  async function refresh() {
    const scope = current(),
      token = ++turn;
    try {
      const rows = await store.list(scope);
      if (disposed || token !== turn || key(scope) !== key(current())) return;
      const list = q("[data-note-list]");
      list.replaceChildren();
      for (const row of rows.filter(
        (r) =>
          q("[data-note-all]").checked || r.trackId === (getTrack()?.id || ""),
      )) {
        const li = doc.createElement("li"),
          button = doc.createElement("button");
        button.type = "button";
        button.dataset.noteId = row.id;
        button.textContent = `${new Date(row.created).toLocaleDateString()} · ${row.trackTitle || "自由手记"} · ${row.text.slice(0, 48)}`;
        button.addEventListener(
          "click",
          () => {
            if (dirty && !doc.defaultView.confirm("放弃尚未保存的手记？"))
              return;
            editing = row;
            binding = { ...row };
            q("[data-note-text]").value = row.text;
            dirty = false;
            q("[data-note-action=delete]").disabled = false;
            associate();
          },
          { signal: abort.signal },
        );
        li.append(button);
        list.append(li);
      }
      status(`${rows.length} 条已保存的本角色手记。`);
    } catch (e) {
      status(e.message);
    }
  }
  function sync() {
    if (disposed || q("[data-note-personal]").hidden) return;
    const next = key(current());
    if (next !== scopeKey) {
      scopeKey = next;
      turn++;
      clear();
      q("[data-note-list]").replaceChildren();
      void refresh();
    } else if (!dirty && !editing) {
      binding = null;
      associate();
      if (!q("[data-note-personal]").hidden) void refresh();
    }
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    const scope = current();
    try {
      await fn(scope);
    } catch (e) {
      status(
        e.name === "QuotaExceededError"
          ? "浏览器空间不足，原手记保留；请先备份并释放空间。"
          : e.message,
      );
    } finally {
      busy = false;
    }
  }
  on(root, "click", (e) => {
    const tab = e.target.closest("[data-note-tab]")?.dataset.noteTab;
    if (tab) {
      q("[data-note-personal]").hidden = tab !== "mine";
      author.hidden = tab === "mine";
      for (const b of root.querySelectorAll("[data-note-tab]"))
        b.setAttribute("aria-pressed", String(b.dataset.noteTab === tab));
      if (tab === "mine") {
        sync();
        void refresh();
      }
      return;
    }
    const action = e.target.closest("[data-note-action]")?.dataset.noteAction;
    if (!action) return;
    if (["new", "cancel"].includes(action)) {
      if (dirty && !doc.defaultView.confirm("放弃尚未保存的手记？")) return;
      clear();
      void refresh();
      return;
    }
    if (action === "save")
      void run(async (scope) => {
        const text = q("[data-note-text]").value;
        if (!text.trim()) throw new Error("请先填写手记。");
        if (
          key(scope) !==
          key({
            role: binding.role,
            script: binding.script,
            project: binding.project,
          })
        )
          throw new Error("角色作用域已改变，请重新读取。");
        const saved = await store.save(
          { ...binding, id: editing?.id, text },
          editing?.revision || 0,
        );
        if (disposed || key(scope) !== key(current())) return;
        editing = saved;
        dirty = false;
        q("[data-note-action=delete]").disabled = false;
        await refresh();
        status("私人手记已保存到本机；角色卡作者数据未更改。");
      });
    if (
      action === "delete" &&
      editing &&
      doc.defaultView.confirm("删除此条私人手记？")
    )
      void run(async () => {
        await store.remove(editing.id, editing.revision);
        if (!disposed) {
          clear();
          await refresh();
        }
      });
    if (action === "export")
      void run(async (scope) => {
        const rows = await store.list(scope);
        if (disposed) return;
        const url = URL.createObjectURL(
            new Blob(
              [
                JSON.stringify({
                  format: "riserein-private-notes",
                  version: 1,
                  notes: rows,
                }),
              ],
              { type: "application/json" },
            ),
          ),
          a = doc.createElement("a");
        a.href = url;
        a.download = "私人音乐手记.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status("已导出私人文件，请妥善保管，勿随角色卡分享。");
      });
    if (action === "import") q("[data-note-file]").click();
  });
  on(q("[data-note-text]"), "input", () => {
    dirty = true;
    status(
      `${Array.from(q("[data-note-text]").value).length} / 2000 字；尚未保存。`,
    );
  });
  on(q("[data-note-all]"), "change", () => void refresh());
  on(q("[data-note-file]"), "change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    void run(async (scope) => {
      if (file.size > NOTE_LIMIT_BYTES) throw new Error("私人备份超过 1 MiB。");
      const data = JSON.parse(await file.text());
      if (data.format !== "riserein-private-notes" || data.version !== 1)
        throw new Error("不支持此私人备份格式。");
      const rows = validatePrivateNotes(data.notes);
      if (disposed || key(scope) !== key(current())) return;
      if (
        !doc.defaultView.confirm(
          `将 ${rows.length} 条私人手记作为副本导入当前角色？不覆盖已有内容。`,
        )
      )
        return;
      await store.importCopies(rows, { scope });
      if (!disposed) {
        await refresh();
        status("私人手记已导入独立副本。");
      }
    });
  });
  // Don't perform account/network reads until Notes is actually opened or a backup is requested.
  return {
    sync,
    store,
    dispose() {
      disposed = true;
      turn++;
      abort.abort();
      store.close();
      root.remove();
      author.hidden = false;
    },
  };
}
const NOTE_LIMIT_BYTES = 1024 * 1024;
