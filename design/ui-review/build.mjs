import { readFile, writeFile, mkdir, cp, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const folder = dirname(fileURLToPath(import.meta.url)), root = join(folder, '../..');
const temp = await mkdtemp(join(tmpdir(), 'stm-ui-preview-'));
try {
    const { readdir } = await import('node:fs/promises');
    for (const file of (await readdir(root)).filter(name => name.endsWith('.js'))) await cp(join(root, file), join(temp, file));
    await cp(join(root, 'platforms'), join(temp, 'platforms'), { recursive: true });
    const covers = await Promise.all(['forest', 'moon', 'sunroom'].map(async name => `data:image/webp;base64,${(await readFile(join(folder, 'covers', `${name}.webp`))).toString('base64')}`));
    const media = (await readFile(join(temp, 'media.js'), 'utf8')).replace(/export const fallbackCoverUrl =[^\n]+/, `export const fallbackCoverUrl = index => ${JSON.stringify(covers)}[index % 3];`);
    await writeFile(join(temp, 'media.js'), media);
    await writeFile(join(temp, 'local-store.js'), `export class LocalMusicStore {
        async get(id) { return window.__previewBlobs.get(id); }
        async put(id, blob) { window.__previewBlobs.set(id, blob); }
        async delete(id) { window.__previewBlobs.delete(id); }
        async deleteMany(ids) { ids.forEach(id => window.__previewBlobs.delete(id)); }
    }`);
    const built = spawnSync('npm', ['exec', '--yes', '--package', 'esbuild@0.25.10', '--', 'esbuild', join(temp, 'index.js'), '--bundle', '--format=iife', '--target=es2022', '--define:import.meta.url=window.__PREVIEW_MODULE_URL__', `--outfile=${join(temp, 'runtime.js')}`], { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: process.env.npm_config_cache || join(tmpdir(), 'stm-ui-build-cache') } });
    if (built.status) throw new Error(built.stderr || 'Prototype bundling failed');
    const [runtime, bootstrap, enhance, baseCSS, css] = await Promise.all([
        readFile(join(temp, 'runtime.js'), 'utf8'), readFile(join(folder, 'bootstrap.js'), 'utf8'),
        readFile(join(folder, 'preview.js'), 'utf8'), readFile(join(root, 'style.css'), 'utf8'), readFile(join(folder, 'preview.css'), 'utf8'),
    ]);
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>音乐播放器 · 两套设计原型</title>
    <style>${baseCSS}</style><style id="concept-style">${css}</style><body>
    <header class="preview-toolbar"><div><strong>听音界面 · 设计预览</strong><small>未应用正式界面 · 本页数据刷新重置 · 试听为合成音</small></div>
    <div class="preview-choices"><button data-concept="a">A 纸上听音</button><button data-concept="b">B 夜航听音</button><button data-concept="current">当前版结构</button></div>
    <div class="preview-options"><label>窗口<select id="preview-size"><option value="640,700">大窗</option><option value="390,660">小窗</option><option value="351,640">手机宽度</option></select></label><label>角色<select id="preview-role"><option value="">主页</option><option value="0">书店里的旅人</option><option value="1">远航者</option></select></label><button id="preview-reopen">打开播放器</button></div></header>
    <div class="preview-host" aria-hidden="true"><small>聊天场景示意</small><div></div><div></div><div></div><div></div></div>
    <script>${bootstrap.replace(/<\/script/gi, '<\\/script')}</script><script>${runtime.replace(/<\/script/gi, '<\\/script')}</script><script>${enhance.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
    await writeFile(join(folder, 'concepts.html'), html);
    console.log('Built self-contained concepts.html from current player modules; production files unchanged.');
} finally { await rm(temp, { recursive: true, force: true }); }
