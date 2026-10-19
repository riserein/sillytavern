// Controlled shared-runtime rendering. Role callbacks are fixtures, not Helper acceptance.
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.env.ST_READING_BASELINE || 'e3d5c4e';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
const page = await browser.newPage();
const image = 'data:image/png;base64,' + (await readFile(join(root, 'assets/covers/moon.png'))).toString('base64');
const audio = 'data:audio/mpeg;base64,' + (await readFile(join(root, 'card-player/demo-assets/test-tone-a.mp3'))).toString('base64');
const metrics = [];
try {
    for (const phase of ['before', 'after']) {
        const runtime = phase === 'before' ? execFileSync('git', ['show', baseline + ':card-player/dist/native-runtime.js'], { cwd: root, maxBuffer: 2 * 1024 * 1024 }).toString() : await readFile(join(root, 'card-player/dist/native-runtime.js'), 'utf8');
        const dir = join(root, 'docs/readability/playback', phase); await mkdir(dir, { recursive: true });
        await page.route('**/reading-render', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:repeating-conic-gradient(#fff 0 25%,#111 0 50%) 0/100px 100px}*,*::before,*::after{animation:none!important;transition:none!important}</style><body></body>' }));
        await page.goto((process.env.ST_BASE_URL || 'http://127.0.0.1:8000') + '/reading-render'); await page.addScriptTag({ content: runtime });
        for (const mobile of [false, true]) for (const theme of ['night', 'amber', 'ocean', 'forest', 'rose', 'lavender', 'pearl', 'crystal', 'vinyl', 'cassette', 'pure', 'custom']) for (const scheme of ['dark', 'light']) {
            await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1000, height: 900 });
            await page.evaluate(({ theme, scheme, image, audio }) => {
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80; const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 80, 80); c.fillStyle = '#111'; c.fillRect(0, 0, 40, 40); c.fillRect(40, 40, 40, 40);
                const novel = { crystal: 'mist-blue', vinyl: 'walnut', cassette: 'smoke', pure: 'cream' }, noop = () => () => {};
                window.renderApi = RisereinNativePlayer.mountNativePlayer({ version: 1, config: { id: 'reading-render', title: '星光与夜行', tracks: [{ id: 'a', title: '听见故事里的风', artist: '旋律与故事 · 阅读辅助信息', src: audio, cover: image }], appearance: { image: canvas.toDataURL() } }, ui: { theme: (novel[theme] || theme === 'custom') ? 'night' : theme, colorScheme: scheme, surface: 'glass', maskOpacity: { glass: .1 }, fontPreset: 'sans', panelSize: { width: 600, height: 740 }, uiDesign: { uiVersion: 1, layout: novel[theme] ? theme : 'night', theme: novel[theme] || 'inherit' }, ...(theme === 'custom' ? { customColors: { enabled: true, background: '#858585', text: '#939393', accent: '#898989' } } : {}) }, playlist: { id: 'reading-list', name: '阅读测试歌单' }, assets: Object.fromEntries(['forest', 'moon', 'sunroom'].map(name => ['assets/covers/' + name + '.png', image])) }, { hostWindow: window, hostDocument: document, roleId: 'render', scriptId: 'render', preferences: { getItem: () => null, setItem() {} }, currentRole: () => 'render', onRoleChange: noop, onScriptExit: noop, onHostExit: noop, onFrameRemoved: noop });
            }, { theme, scheme, image, audio });
            await page.waitForFunction(() => document.querySelector('#stm-player')?.dataset.hasBackground === 'true' && document.querySelector('.stm-cover-image')?.complete);
            await page.locator('#stm-player').screenshot({ path: join(dir, `${theme}-${scheme}-${mobile ? 'mobile' : 'desktop'}.jpg`), type: 'jpeg', quality: 65 });
            metrics.push({ phase, theme, scheme, mobile, runtimeBytes: Buffer.byteLength(runtime) });
            await page.evaluate(() => renderApi.dispose());
        }
        await page.unroute('**/reading-render');
    }
    await writeFile(join(root, 'docs/readability/playback/record.json'), JSON.stringify({ baseline, metrics }, null, 2));
    console.log(`Captured ${metrics.length} controlled playback views.`);
} finally { await browser.close(); }
