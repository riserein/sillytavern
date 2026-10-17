import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=['bounded-response.js',...(await readdir(new URL('../data/',import.meta.url))).filter(name=>name.endsWith('.js')).map(name=>'data/'+name)];
for(const path of files){const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit',cwd:new URL('../',import.meta.url)});if(result.status!==0)process.exit(result.status||1);}
