import { readFile, writeFile, mkdtemp, rm, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..'),
    dist = join(root, 'card-player/dist');
const temporary = await mkdtemp(join(root, 'card-player/.native-build-'));
function build(entry, name, args = []) {
    const result = spawnSync(
        'npm',
        [
            'exec',
            '--yes',
            '--package',
            'esbuild@0.25.10',
            '--',
            'esbuild',
            entry,
            '--bundle',
            '--format=iife',
            '--target=es2022',
            '--tree-shaking=true',
            '--minify',
            '--legal-comments=none',
            `--outfile=${join(temporary, name)}`,
            ...args,
        ],
        {
            cwd: root,
            encoding: 'utf8',
            env: {
                ...process.env,
                npm_config_cache: process.env.npm_config_cache || '/tmp/stm-ui-build-cache',
            },
        },
    );
    if (result.status !== 0) throw new Error(result.stderr || 'Shared player build failed');
}
try {
    build('index.js', 'shared.js', [
        '--global-name=SharedMusicPlayer',
        '--define:__STM_PORTABLE__=true',
        '--define:import.meta.url="https://rscp.invalid/index.js"',
    ]);
    const compiled = await readFile(join(temporary, 'shared.js'), 'utf8');
    if (/indexedDB\.open|api\/extensions|createNativeCardExport/.test(compiled))
        throw new Error('Portable target still contains full-plugin storage or authoring entry');
    const css =
        (await readFile(join(root, 'style.css'), 'utf8')) +
        '\n' +
        (await readFile(join(root, 'night-ui.css'), 'utf8')).replace(/@import\s+url\("\.\/style.css"\);/, '');
    const bindings =
        'document,window,globalThis,URL,ResizeObserver,MutationObserver,setTimeout,setInterval,clearTimeout,clearInterval,requestAnimationFrame,cancelAnimationFrame,getComputedStyle,matchMedia,Image,FontFace,fetch,location';
    const shared = `// Generated from the SAME index.js, components and CSS as the full plugin.\nexport const SHARED_CSS=${JSON.stringify(css)};\nexport function mountSharedPlayer(environment,options){const {${bindings}}=environment;\n${compiled}\nreturn SharedMusicPlayer.initialize(options);}\n`;
    await writeFile(join(dist, 'shared-ui.js'), shared);
    build('card-player/native-entry.js', 'native-runtime.js', ['--global-name=RisereinNativePlayer']);
    const license = await readFile(join(root, 'LICENSE'), 'utf8');
    const output = `/*\n${license}*/\n` + (await readFile(join(temporary, 'native-runtime.js'), 'utf8'));
    if (output.includes('//# sourceMappingURL') || /indexedDB\.open|import\(/.test(output))
        throw new Error('Unexpected external runtime dependency');
    await writeFile(join(temporary, 'native.ready'), output);
    await rename(join(temporary, 'native.ready'), join(dist, 'native-runtime.js'));
    console.log(
        `Built shared-UI native card player (${Buffer.byteLength(output)} bytes). No full plugin, API search or IndexedDB dependency.`,
    );
} finally {
    await rm(temporary, { recursive: true, force: true });
}
