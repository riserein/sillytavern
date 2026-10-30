import {parseLyrics,MAX_LYRICS} from './media.js';
import {lyricDocument} from './lyric-document.js';
import {hashText} from './data/checksum.js';
export const MAX_EXPANDED_LYRICS=200000;
const short=(value,max)=>typeof value==='string'&&Array.from(value).length<=max?value:null;
/** Associations belong to physical source lines, not a guessed array offset. */
export function normalizeTranslation(raw){
 if(!raw||raw.version!==1||!Array.isArray(raw.bindings)||!raw.bindings.length||raw.bindings.length>1200)return null;
 if(raw.sourceLyrics!==undefined&&(typeof raw.sourceLyrics!=='string'||raw.sourceLyrics.length>MAX_LYRICS))return null;
 const seen=new Set(),bindings=[];let total=0;
 for(const row of raw.bindings){if(!row||!/^\d{1,6}:\d{1,4}$/.test(row.lineId)||seen.has(row.lineId)||!/^[a-f0-9]{64}$/.test(row.originalHash)||short(row.text,2000)===null||!row.text.trim())return null;seen.add(row.lineId);total+=row.text.length;if(total>MAX_LYRICS)return null;
  bindings.push({lineId:row.lineId,originalHash:row.originalHash,text:row.text,...(Number.isFinite(row.sourceTime)&&row.sourceTime>=0&&row.sourceTime<60000?{sourceTime:row.sourceTime}:{}),...(typeof row.sourceLineId==='string'&&/^\d{1,6}:\d{1,4}$/.test(row.sourceLineId)?{sourceLineId:row.sourceLineId}:{})});
 }
 for(const key of ['sourceLanguage','language'])if(raw[key]!==undefined&&short(raw[key],40)===null)return null;
 if(raw.source!==undefined&&short(raw.source,500)===null)return null;
 return {version:1,sourceLanguage:raw.sourceLanguage||'',language:raw.language||'',source:raw.source||'',sourceLyrics:raw.sourceLyrics||'',confirmed:raw.confirmed===true,distribute:raw.distribute===true,rightsConfirmed:raw.rightsConfirmed===true,bindings};
}
export function lyricAnchors(text){const doc=lyricDocument(text),hashes=new Map();return {doc,rows:doc.rows.map(row=>{const words=row.text||'♪';if(!hashes.has(words))hashes.set(words,hashText(words));return {...row,originalHash:hashes.get(words),effectiveTime:row.time===null?null:Math.max(0,row.time-doc.offset/1000)};})};}
const key=(time,text)=>String(time===null?'plain':Math.round(time*1000))+'\0'+text;
/** The playback parser and timeline remain authoritative. Only attach extra text. */
export function translationTimeline(track){
 const data=parseLyrics(track?.lyrics||'');
 if(data.lines.reduce((n,row)=>n+row.text.length,0)>MAX_EXPANDED_LYRICS)return {synced:false,lines:[{time:null,text:track?.lyrics||''}],degraded:true,notice:'重复时间戳展开过长，暂按完整原文阅读；原歌词未删除或改写。'};
 const translation=normalizeTranslation(track?.translation);let anchors;try{anchors=lyricAnchors(track?.lyrics||'');}catch{return {...data,translationAvailable:false};}
 const pool=new Map();for(const row of anchors.rows){const value=key(data.synced?row.effectiveTime:null,row.text||'♪');if(!pool.has(value))pool.set(value,[]);pool.get(value).push(row);}
 const bindings=new Map((translation?.confirmed?translation.bindings:[]).map(row=>[row.lineId,row]));let available=0;
 const lines=data.lines.map(line=>{const anchor=pool.get(key(line.time,line.text))?.shift(),binding=anchor&&bindings.get(anchor.id),text=binding&&anchor&&binding.originalHash===anchor.originalHash?binding.text:'';if(text)available++;return {...line,...(anchor?{lineId:anchor.id}:{}),...(text?{translation:text}:{})};});
 return {...data,lines,translationAvailable:available>0,translationMissing:available>0&&available<lines.length,translationSource:translation?.source||'',unmatchedBindings:translation?.bindings.length?translation.bindings.length-available:0};
}
export function translationCandidates(original,source){
 const main=lyricAnchors(original),other=lyricAnchors(source),used=new Set();return {main,other,rows:main.rows.map(row=>{
  const choices=other.rows.filter(candidate=>candidate.time!==null&&!used.has(candidate.id)).map(candidate=>({candidate,distance:row.time===null?Infinity:Math.abs(candidate.effectiveTime-row.effectiveTime)})).sort((a,b)=>a.distance-b.distance);
  const match=choices[0]?.distance<=.25?choices[0].candidate:null;if(match)used.add(match.id);return {lineId:row.id,originalHash:row.originalHash,text:match?.text||'',...(match?{sourceLineId:match.id,sourceTime:match.time}:{})};
 })};
}
export function translationForRow(track,row){const translation=normalizeTranslation(track?.translation);if(!translation?.confirmed)return '';const binding=translation.bindings.find(item=>item.lineId===row.id);return binding?.originalHash===hashText(row.text||'♪')?binding.text:'';}
export function portableTranslation(value){
 if(value===undefined||value===null)return undefined;const translation=normalizeTranslation(value);if(!translation)throw new Error('译文数据无效，未生成不完整播放器。');
 if(!translation.distribute)return undefined;if(!translation.confirmed||!translation.rightsConfirmed||!translation.source.trim())throw new Error('请确认译文对应关系及分发授权，并填写署名或来源。');return translation;
}

export function translationBindingIssues(track){const translation=normalizeTranslation(track?.translation);if(!translation)return [];let anchors;try{anchors=lyricAnchors(track.lyrics||'');}catch{return translation.bindings;}const known=new Map(anchors.rows.map(row=>[row.id,row.originalHash]));return translation.bindings.filter(row=>known.get(row.lineId)!==row.originalHash);}
export function portableTrackTranslation(track){const translated=portableTranslation(track.translation);if(translated&&translationBindingIssues(track).length)throw new Error('译文与当前原文已不对应，请重新核对匹配或关闭携带译文。');return translated;}
