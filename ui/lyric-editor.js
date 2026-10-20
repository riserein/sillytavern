import {currentLyricIndex} from '../media.js';
import {lyricDocument,documentIssues,serializeLyrics,formatStamp,stampTime,stampAtPlayback,playbackAtStamp,lyricHistory,editorPlayback} from '../lyric-document.js';
/** Author or recipient draft. Playback controls operate only the owner's Audio. */
export function createLyricEditor({panel,audio,getTrack,getOffset,onSelect,onPlay,onSave,onRestore,onDisplay,onError}){
 const doc=panel.ownerDocument,abort=new AbortController(),root=doc.createElement('section');root.id='stm-lyric-editor';root.className='stm-queue-overlay stm-lyric-editor';root.hidden=true;root.setAttribute('aria-label','逐句歌词时间轴');root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
 root.innerHTML='<div class="stm-tool-scroll"><header><h3>逐句歌词时间轴</h3><button type="button" data-axis="close" class="stm-secondary">取消 / 关闭</button></header><div class="stm-axis-workspace"><aside><img alt="歌曲封面" class="stm-axis-cover"><h4 data-axis-title></h4><p class="stm-hint" data-axis-offset></p><button type="button" data-axis="play" class="stm-primary">播放 / 暂停</button><input type="range" min="0" max="100" step="0.01" data-axis-seek aria-label="编辑试听进度"><output data-axis-time></output><button type="button" data-axis="mark" class="stm-secondary">标记当前时间 · 下一句</button><p class="stm-hint">先播放，听到每句开始时点击标记。歌词和整曲校准会共同计入；不改变音频。</p></aside><main><div class="stm-axis-tools"><button type="button" data-axis="undo" class="stm-secondary">撤销</button><button type="button" data-axis="redo" class="stm-secondary">重做</button><button type="button" data-axis="import" class="stm-secondary">导入 LRC / TXT</button><button type="button" data-axis="export" class="stm-secondary">导出 LRC</button><input type="file" accept=".lrc,.txt,text/plain" hidden data-axis-file></div><ol class="stm-axis-lines"></ol></main></div><p class="stm-hint" data-axis-issues aria-live="polite"></p><button type="button" class="stm-primary" data-axis="save">确认保存歌词</button><button type="button" class="stm-secondary" data-axis="restore">恢复编辑前原版</button></div>';
 panel.append(root);const q=s=>root.querySelector(s);let target=null,working=null,history=null,baseline='',cursor=0,dirty=false,generation=0,disposed=false,timeline=null,timedRows=[];
 function close(force=false){if(!force&&dirty&&!doc.defaultView.confirm('放弃未保存的歌词修改？'))return;generation++;onDisplay(false);target=null;working=null;history=null;dirty=false;}
 async function open(id){const token=++generation;const track=getTrack(id);if(!track)throw new Error('歌曲已不存在。');await onSelect(id);if(disposed||token!==generation)return;
  target=id;baseline=track.lyrics||'';working=lyricDocument(baseline);history=lyricHistory(working);cursor=0;dirty=false;q('[data-axis-title]').textContent=track.title;q('img').src=panel.querySelector('.stm-cover-image').src;onDisplay(true);render();
 }
 function issues(){const result=documentIssues(working,{duration:Number.isFinite(audio.duration)?audio.duration:Infinity,offsetMs:getOffset(target)});if(!Number.isFinite(audio.duration)||audio.duration<=0)result.push({line:0,kind:'warning',message:'尚未读取歌曲时长，无法校验超出结尾；请先试听'});return result;}
 function render(){if(!working)return;timeline=editorPlayback(working);timedRows=working.rows.filter(r=>r.time!==null).map(r=>({id:r.id,time:Math.max(0,r.time-working.offset/1000)})).sort((a,b)=>a.time-b.time);q('.stm-axis-lines').replaceChildren();
  for(const [index,row]of working.rows.entries()){
   const li=doc.createElement('li');li.dataset.axisRow=row.id;const text=doc.createElement('button');text.type='button';text.dataset.axis='seek';text.dataset.index=index;text.className='stm-axis-words';text.textContent=row.text||'（空句）';
   const input=doc.createElement('input');input.dataset.axisTime=String(index);input.value=row.time===null?'':formatStamp(row.time);input.placeholder='00:00.000';input.setAttribute('aria-label','第 '+(index+1)+' 句时间');
   const tools=doc.createElement('div');tools.className='stm-axis-tools';for(const [name,delta]of [['−0.1',-.1],['+0.1',.1],['−0.5',-.5],['+0.5',.5],['当前时间','now'],['试听','listen']]){const b=doc.createElement('button');b.type='button';b.className='stm-secondary';b.dataset.axis=String(delta);b.dataset.index=index;b.textContent=name;tools.append(b);}li.append(text,input,tools);q('ol').append(li);
  }
  q('[data-axis=undo]').disabled=!history.canUndo;q('[data-axis=redo]').disabled=!history.canRedo;
  q('[data-axis-issues]').textContent=issues().map(e=>`${e.line?'第 '+e.line+' 行：':''}${e.message}`).join('；')||'校验通过；保存前仍可试听。';sync();
 }
 function change(index,time){if(time===null||!Number.isFinite(time)||time<0)throw new Error('请输入非负时间，格式为 分:秒.毫秒。');working.rows[index].time=Math.round(time*1000)/1000;history.push(working);dirty=true;render();}
 function sync(){if(!working||root.hidden)return;const time=audio.currentTime||0,duration=audio.duration;q('[data-axis-seek]').value=String(Number.isFinite(duration)&&duration?time/duration*100:0);q('[data-axis-time]').textContent=time.toFixed(2)+' / '+(Number.isFinite(duration)?duration.toFixed(2):'—')+' 秒';q('[data-axis-offset]').textContent=`LRC offset：${working.offset} ms · 歌曲校准：${getOffset(target)} ms`;
  const at=timeline?.synced?currentLyricIndex(timeline.lines,time-getOffset(target)/1000):-1,current=timedRows[at]?.id;[...q('ol').children].forEach((li,i)=>{li.classList.toggle('stm-axis-current',li.dataset.axisRow===current);li.classList.toggle('stm-axis-next',i===cursor);});
 }
 const on=(node,type,fn)=>node.addEventListener(type,fn,{signal:abort.signal});
 on(root,'click',async e=>{const b=e.target.closest('[data-axis]');if(!b||!working)return;try{
  const action=b.dataset.axis,index=Number(b.dataset.index);
  if(action==='close')return close();if(action==='play'){await onPlay();return;}
  if(action==='undo'||action==='redo'){working=history[action]();dirty=true;render();return;}
  if(action==='import'){q('[data-axis-file]').click();return;}
  if(action==='mark'){if(cursor>=working.rows.length)throw new Error('所有句子已标记，可检查后保存。');change(cursor,stampAtPlayback(audio.currentTime,working,getOffset(target)));cursor++;sync();return;}
  if(action==='seek'||action==='listen'){const row=working.rows[index];if(row.time===null)throw new Error('这句尚未标记时间。');audio.currentTime=Math.max(0,playbackAtStamp(row.time,working,getOffset(target)));if(audio.paused)await onPlay();cursor=index;sync();return;}
  if(action==='save'||action==='export'){
   if([...root.querySelectorAll('[data-axis-time]')].some(input=>!input.reportValidity()))return;
   const all=issues();if(all.some(i=>i.kind==='error'))throw new Error('请先处理时间轴问题：'+all.filter(i=>i.kind==='error').slice(0,6).map(i=>'第 '+i.line+' 行 '+i.message).join('；'));
   if(all.length&&!doc.defaultView.confirm('存在乱序、重复或空句等提示，保留原文结构继续？'))return;
   const text=serializeLyrics(working);
   if(action==='save'){if((getTrack(target)?.lyrics||'')!==baseline)throw new Error('编辑期间正式歌词已改变，请先关闭并重新读取；未覆盖新内容。');await onSave(target,text);baseline=text;dirty=false;q('[data-axis-issues]').textContent='已保存；原版仍可恢复。';}
   else {const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));try{const a=doc.createElement('a');a.href=url;a.download=(getTrack(target).title||'lyrics')+'.lrc';a.click();}finally{URL.revokeObjectURL(url);}}
   return;
  }
  if(action==='restore'){if(!doc.defaultView.confirm('恢复首次编辑前的原版歌词？当前未保存编辑将丢弃。'))return;await onRestore(target);baseline=getTrack(target)?.lyrics||'';working=lyricDocument(baseline);history=lyricHistory(working);dirty=false;render();return;}
  change(index,action==='now'?stampAtPlayback(audio.currentTime,working,getOffset(target)):working.rows[index].time===null?null:working.rows[index].time+Number(action));
 }catch(error){onError(error);q('[data-axis-issues]').textContent=error.message;}});
 on(root,'change',async e=>{try{if(e.target.dataset.axisTime!==undefined){const n=Number(e.target.dataset.axisTime);const time=stampTime(e.target.value);e.target.setCustomValidity(time===null?'请输入有效的 分:秒.毫秒':'');change(n,time);}if(e.target.matches('[data-axis-file]')){const file=e.target.files[0],token=generation;e.target.value='';if(!file)return;if(file.size>200000)throw new Error('歌词文件超过 200 KB，未读取。');const text=await file.text();if(token!==generation||root.hidden)return;working=lyricDocument(text);history.push(working);dirty=true;cursor=0;render();}}catch(error){onError(error);q('[data-axis-issues]').textContent=error.message;}});
 on(q('[data-axis-seek]'),'input',()=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(q('[data-axis-seek]').value)/100;});
 for(const type of ['timeupdate','durationchange','playing','pause','seeked'])on(audio,type,sync);
 on(root,'keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}});
 return {open,close,get opened(){return !root.hidden;},dispose(){disposed=true;generation++;abort.abort();root.remove();working=null;history=null;}};
}
