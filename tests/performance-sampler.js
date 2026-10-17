import {readFile} from 'node:fs/promises';
/** Samples, not a memory-peak measurement. RSS includes shared pages in each process. */
export async function performanceSampler(browser,context,page,label,records){
 const processSession=await browser.newBrowserCDPSession(),renderer=await context.newCDPSession(page);
 const record={label,samplingMilliseconds:500,scope:'whole test browser/host including official Helper; not attributable solely to player',samples:[],events:[]};records.push(record);
 let closed=false,timer,inflight=Promise.resolve(),stopping;
 await page.addInitScript(()=>{
  window.__stmPerformance={longTasks:[],roles:[]};
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(__stmPerformance.longTasks.length<5000)__stmPerformance.longTasks.push({start:e.startTime,duration:e.duration});}).observe({entryTypes:['longtask']});}catch{}
  new MutationObserver(()=>{const root=document.querySelector('[data-riserein-card-player]'),row=__stmPerformance.roles.at(-1);if(root&&row&&!row.firstDisplay)row.firstDisplay=performance.now();}).observe(document,{subtree:true,childList:true});
  document.addEventListener('loadeddata',e=>{if(e.target.tagName==='AUDIO'&&e.target.closest('[data-riserein-card-player]')){const row=__stmPerformance.roles.at(-1);if(row&&!row.firstPlayable)row.firstPlayable=performance.now();}},true);
 });
 const sample=async()=>{
  try{
   const [processes,heap,events]=await Promise.all([processSession.send('SystemInfo.getProcessInfo'),renderer.send('Runtime.getHeapUsage'),page.evaluate(()=>window.__stmPerformance)]);
   const rss=[];for(const p of processes.processInfo){try{const stat=await readFile(`/proc/${p.id}/status`,'utf8'),match=stat.match(/^VmRSS:\s+(\d+) kB/m);if(match)rss.push({type:p.type,pid:p.id,bytes:Number(match[1])*1024});}catch{}}
   record.samples.push({at:new Date().toISOString(),usedJSHeapBytes:heap.usedSize,rss});if(events)record.events=events;
  }catch{/* Page may be navigating or closing; missing samples remain gaps. */}
  if(!closed)timer=setTimeout(()=>{inflight=sample();},500);
 };
 inflight=sample();
 return ()=>stopping||=(async()=>{closed=true;clearTimeout(timer);await inflight;await processSession.detach().catch(()=>{});await renderer.detach().catch(()=>{});record.maximumObservedJSHeapBytes=Math.max(0,...record.samples.map(s=>s.usedJSHeapBytes));record.maximumObservedSummedRssBytes=Math.max(0,...record.samples.map(s=>s.rss.reduce((n,p)=>n+p.bytes,0)));})();
}
