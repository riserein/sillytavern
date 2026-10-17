import {readFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('node_modules/@noble/hashes/package.json',root)));
if(manifest.version!=='1.8.0')throw new Error('Review and explicitly update the pinned SHA-256 source before rebuilding.');
const result=spawnSync('npm',['exec','--yes','--package','esbuild@0.25.10','--','esbuild','node_modules/@noble/hashes/esm/sha256.js','--bundle','--format=esm','--target=es2022','--minify','--legal-comments=inline','--outfile=vendor/sha256.js'],{cwd:root,stdio:'inherit',env:{...process.env,npm_config_cache:process.env.npm_config_cache||'/tmp/stm-ui-build-cache'}});
if(result.status!==0)process.exit(result.status||1);
await copyFile(new URL('node_modules/@noble/hashes/LICENSE',root),new URL('vendor/noble-hashes-LICENSE.txt',root));
