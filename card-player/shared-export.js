import { normalizeDesign } from "../ui/config.js";
import { nativeCardScript } from "./native-export.js";
import { normalizeCardConfig } from "./config.js";
import {
  PLAYER_BUILD,
  payloadLiteral,
  assertCapacity,
  analyzePayload,
} from "./quality.js";
/** Same native runtime, Helper record format and payload as ST's PNG/JSON bridge. */
export function buildSharedCardExports(
  input,
  runtime,
  scriptId,
  { design, ui = {}, assets = {}, fontFile = "" } = {},
) {
  const config = normalizeCardConfig(input),
    selected = normalizeDesign(design);
  selected.customization.iconId = null;
  selected.recipientDisplay = config.recipientDisplay;
  // Explicit visual preference transport; never copy a host settings object.
  const uiKeys=['theme','colorScheme','surface','maskOpacity','customColors','clickEffects','fontPreset','transitionDuration','reading'];
  const safeUi=Object.fromEntries(uiKeys.filter(key=>Object.hasOwn(ui,key)).map(key=>[key,structuredClone(ui[key])]));
  const payload = {
    version: 1,
    runtimeVersion: PLAYER_BUILD,
    config,
    ui: { ...safeUi, uiDesign: selected },
    fontFile: config.appearance.font ? fontFile || "maker-selected.woff2" : "",
    fontEncoding: "",
    fontOriginalBytes: 0,
    playlist: { id: config.id, name: config.title, description: "", cover: "" },
    assets,
  };
  const script = nativeCardScript(payload, runtime, scriptId),
    encoded = payloadLiteral(payload);
  if (!runtime.includes("startNativePreview"))
    throw new Error("共享预览文件不完整，请更新插件后重试。");
  const preview = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>共享角色播放器预览</title><style>html,body{margin:0;min-height:100vh;background:#263534;color:#dce5df;font:13px system-ui}p{padding:10px 20px}</style><p>独立共享界面预览 · 点击播放试听；角色生命周期仍需在酒馆助手中验收。</p><script>(()=>{\n${runtime}\nPromise.resolve(RisereinNativePlayer.startNativePreview(${encoded})).catch(error=>{const p=document.createElement('p');p.textContent='预览未启动：'+error.message;document.body.append(p);});\n})();</script></html>`;
  return {
    payload,
    script,
    javascript: script.content,
    preview,
    songs: {
      runtimeVersion: PLAYER_BUILD,
      title: config.title,
      projectId: config.id,
      design: selected,
      font: {
        name: config.appearance.fontName,
        license: config.appearance.fontLicense,
      },
      tracks: config.tracks.map(({ src, cover, ...row }) => ({
        ...row,
        resource: src.startsWith("data:") ? "embedded audio bytes" : src,
        cover: cover ? "embedded image bytes" : "",
      })),
    },
    bytes: new TextEncoder().encode(JSON.stringify(script)).length,
    analysis: assertCapacity(analyzePayload(payload, script)),
  };
}
