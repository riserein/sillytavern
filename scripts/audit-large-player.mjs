import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const label=process.argv[2]||'fixed';
const layout=process.env.ST_DESIGN_LAYOUT||'night';if(!['night','crystal','vinyl','cassette','pure'].includes(layout))throw new Error('Invalid stress layout');
if(!/^[a-zA-Z0-9_-]{1,40}$/.test(label)) throw new Error('Invalid report label');
const baseURL=process.env.ST_BASE_URL||'http://127.0.0.1:8000';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--js-flags=--max-old-space-size=384','--enable-precise-memory-info']});
const context=await browser.newContext(); const page=await context.newPage();
const report={label,layout,environment:'isolated desktop Chromium renderer with a 384 MiB V8 old-space limit (not a process-memory limit), not a physical phone',browser:browser.version(),embeddedAudioBytes:29*1024*1024};
const runtimeBytes=await readFile(process.env.ST_RUNTIME_FILE||new URL('../card-player/dist/native-runtime.js',import.meta.url));
report.runtimeSha256=createHash('sha256').update(runtimeBytes).digest('hex');
let timer;
try {
 await page.route('**/stress-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body></body>'}));
 await page.goto(baseURL+'/stress-fixture');
 await page.addScriptTag({content:runtimeBytes.toString()});
 const started=Date.now();
 report.result=await Promise.race([page.evaluate(async(layout)=>{
  function wav(size){const bytes=new Uint8Array(size),v=new DataView(bytes.buffer); const word=(i,s)=>{for(let n=0;n<s.length;n++)bytes[i+n]=s.charCodeAt(n)};
   word(0,'RIFF');v.setUint32(4,size-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,size-44,true);
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return 'data:audio/wav;base64,'+btoa(binary);}
  const cover='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
  const config={id:'audit-large',title:'Synthetic 29 MiB boundary fixture',tracks:[20,9].map((n,i)=>({id:'tone'+i,title:'Original synthetic silence '+i,src:wav(n*1024*1024),cover})),appearance:{},volume:0};
  const payload={version:1,config,ui:{fontPreset:'inherit',uiDesign:{uiVersion:1,layout}},playlist:{id:'audit-list',name:'Boundary fixture'},assets:Object.fromEntries(['forest','moon','sunroom'].map(n=>['assets/covers/'+n+'.png',cover]))};
  const before=performance.memory?.usedJSHeapSize; const started=performance.now();const noop=()=>()=>{};let last=started,maxHeartbeatGap=0;
  const heartbeat=setInterval(()=>{const now=performance.now();maxHeartbeatGap=Math.max(maxHeartbeatGap,now-last);last=now;},16);
  const api=RisereinNativePlayer.mountNativePlayer(payload,{hostWindow:window,hostDocument:document,roleId:'audit',scriptId:'audit',currentRole:()=> 'audit',onRoleChange:noop,onScriptExit:noop,onHostExit:noop,onFrameRemoved:noop});
  const mountMilliseconds=performance.now()-started,after=performance.memory?.usedJSHeapSize;
  await new Promise((resolve,reject)=>{const audio=api.audio;const check=()=>{if(audio.readyState>=2 && audio.getAttribute('src'))resolve()};audio.addEventListener('loadeddata',check);audio.addEventListener('error',()=>reject(new Error('synthetic WAV decode failed')),{once:true});check();});
  const firstCanPlayMilliseconds=performance.now()-started;await api.audio.play(); await new Promise(r=>setTimeout(r,400)); const progress=api.audio.currentTime;clearInterval(heartbeat);
  api.dispose(); return {beforeHeapBytes:before,afterHeapBytes:after,mountMilliseconds,firstCanPlayMilliseconds,maxHeartbeatGapMilliseconds:maxHeartbeatGap,progress,resourceCounts:api.resourceCounts,remainingRoots:document.querySelectorAll('[data-riserein-card-player]').length};
 },layout),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('stress timeout')),90000))]);
 report.milliseconds=Date.now()-started;report.status='completed';
} catch(error){report.status='failed-or-renderer-crashed';report.error=String(error.message).slice(0,500);}
finally{clearTimeout(timer);await context.close().catch(()=>{});await browser.close().catch(()=>{});await writeFile(process.env.ST_LARGE_REPORT||new URL('../docs/card-player/audit-stress-'+label+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));

if(report.status!=='completed'||!(report.result.progress>0)||report.result.remainingRoots!==0||Object.values(report.result.resourceCounts).some(value=>value!==0))process.exitCode=1;
