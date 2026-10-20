import {MAX_LYRICS,parseLyrics} from './media.js';
export const MAX_LYRIC_ROWS=1200;
export function stampTime(value){
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?Math.round(value*1000)/1000:null;
 const m=String(value).trim().match(/^(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?$/);
 return m?Number(m[1])*60+Number(m[2])+Number('0.'+(m[3]||0)):null;
}
export function formatStamp(time){const ms=Math.round(time*1000),minutes=Math.floor(ms/60000);return String(minutes).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');}
/** A lossless source document, separate from the sorted playback parser. */
export function lyricDocument(text){
 if(typeof text!=='string'||text.length>MAX_LYRICS)throw new Error('歌词超过 50,000 字符或格式无效；未截短原文。');
 const newline=text.includes('\r\n')?'\r\n':'\n',source=text.split(/\r?\n/),rows=[],issues=[];
 source.forEach((raw,index)=>{
  const matches=[...raw.matchAll(/\[([-+]?\d{1,3}:[^\]]+)\]/g)],meta=/^\s*(?:\uFEFF)?(?:\[(?:ar|ti|al|by|offset|length|re|ve|au):[^\]]*\]\s*)+$/i.test(raw);
  if(meta||!raw.trim())return;
  const text=raw.replace(/\[[^\]]*\]/g,'').trim();
  if(matches.length>1)issues.push({line:index+1,kind:'warning',message:'同一行含多个时间戳；分别编辑，保留共享原文'});
  if(matches.length)for(const [at,m] of matches.entries())rows.push({id:index+':'+at,line:index,at,start:m.index,end:m.index+m[0].length,text,time:stampTime(m[1]),original:m[0]});
  else rows.push({id:index+':0',line:index,at:0,start:0,end:0,text:raw.replace(/^\uFEFF/,''),time:null,original:''});
  if(/\[(?:-\d|\d+:)/.test(raw)&&!matches.length)issues.push({line:index+1,kind:'error',message:'无效或负数时间戳'});
 });
 if(rows.length>MAX_LYRIC_ROWS)throw new Error('歌词时间轴超过 1,200 行，未丢弃任何行。');
 const offsets=[...text.matchAll(/\[offset:([^\]]*)\]/gi)];
 if(offsets.length>1||offsets.some(m=>!/^[-+]?\d+$/.test(m[1])))issues.push({line:0,kind:'error',message:'offset 格式无效或有多个值'});
 return {version:1,source,newline,rows,issues,offset:Number(offsets[0]?.[1]||0),original:text};
}
export function documentIssues(doc,{duration=Infinity,offsetMs=0}={}){
 const result=[...doc.issues],times=new Set();let previous=-Infinity;
 if(!doc.rows.length)result.push({line:0,kind:'error',message:'没有可编辑歌词'});
 for(const row of doc.rows){const line=row.line+1;
  if(row.time===null||!Number.isFinite(row.time)||row.time<0)result.push({line,kind:'error',message:'此句尚未标记有效时间'});
  else {if(row.time>=60000)result.push({line,kind:'error',message:'超出当前 LRC 解析器支持的 999 分钟范围'});const effective=row.time-doc.offset/1000+offsetMs/1000;
   if(effective<0||effective>duration)result.push({line,kind:'error',message:'时间在歌曲可播放范围之外（含两种校准）'});
   if(row.time<previous)result.push({line,kind:'warning',message:'时间乱序；原文顺序保持不变'});
   if(times.has(row.time))result.push({line,kind:'warning',message:'重复时间戳'});times.add(row.time);previous=row.time;
  }
  if(!row.text.trim())result.push({line,kind:'warning',message:'空歌词'});
 }
 return result;
}
export function serializeLyrics(doc){
 const lines=doc.source.slice();
 for(let i=0;i<lines.length;i++)for(const row of doc.rows.filter(r=>r.line===i).toReversed()){
  if(row.time===null)continue;const value=row.original&&row.time===stampTime(row.original.slice(1,-1))?row.original:'['+formatStamp(row.time)+']';lines[i]=lines[i].slice(0,row.start)+value+lines[i].slice(row.end);
 }
 const text=lines.join(doc.newline);if(text.length>MAX_LYRICS)throw new Error('编辑后歌词超过 50,000 字符，未保存。');return text;
}
export const stampAtPlayback=(seconds,doc,offsetMs=0)=>Math.round((seconds+doc.offset/1000-offsetMs/1000)*1000)/1000;
export function playbackAtStamp(time,doc,offsetMs=0){return time-doc.offset/1000+offsetMs/1000;}
export function normalizeLyricOverrides(rows){
 const seen=new Set();return (Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r.trackId==='string'&&r.trackId.length<=512&&typeof r.lyrics==='string'&&r.lyrics.length<=MAX_LYRICS&&!seen.has(r.trackId)&&seen.add(r.trackId)).slice(0,200).map(r=>({trackId:r.trackId,lyrics:r.lyrics,...(typeof r.original==='string'&&r.original.length<=MAX_LYRICS?{original:r.original}:{})}));
}
export function effectiveLyricsTrack(track,overrides){const row=overrides?.find(r=>r.trackId===track?.id);return row?{...track,lyrics:row.lyrics}:track;}
export function lyricHistory(doc,limit=40){let states=[structuredClone(doc)],cursor=0;return {push(next){states.splice(cursor+1);states.push(structuredClone(next));if(states.length>limit+1)states.shift();cursor=states.length-1;},undo(){if(cursor>0)cursor--;return structuredClone(states[cursor]);},redo(){if(cursor<states.length-1)cursor++;return structuredClone(states[cursor]);},get canUndo(){return cursor>0;},get canRedo(){return cursor<states.length-1;}};}
// Reuse the actual playback parser for the editor's highlight, never a second Audio.
export const editorPlayback=doc=>parseLyrics(serializeLyrics(doc));
