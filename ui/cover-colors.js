import {colorHex,mixColor,readableColor,luminance,colorChannels} from './contrast.js';
/** Bounded quantization of one small, origin-clean image. No network request. */
export function dominantColors(pixels){
 const bins=new Map();for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<180)continue;const rgb=[pixels[i],pixels[i+1],pixels[i+2]],key=rgb.map(n=>n>>5).join(',');const row=bins.get(key)||{count:0,sum:[0,0,0]};row.count++;rgb.forEach((n,j)=>row.sum[j]+=n);bins.set(key,row);}
 const ranked=[...bins.values()].sort((a,b)=>b.count-a.count);return ranked.slice(0,6).map(row=>colorHex(row.sum.map(n=>n/row.count)));
}
export function coverPalette(base,colors,mode='off',locked={}){
 if(!colors?.length||!['soft','strong'].includes(mode))return {...base};
 if(!colorChannels(base.background))return {...base};
 base={...base,surface:colorChannels(base.surface)?base.surface:base.background,text:colorChannels(base.text)?base.text:'#f5f5f0',muted:colorChannels(base.muted)?base.muted:'#b6bfb9',border:colorChannels(base.border)?base.border:base.background};
 const ratio=mode==='soft'?.16:.38,background=locked.background||mixColor(base.background,colors[0],ratio);
 const accent=colors.find(c=>luminance(c)>.1&&luminance(c)<.8)||colors[1]||colors[0];
 return {...base,background,surface:locked.surface||mixColor(base.surface,colors[1]||colors[0],ratio),
  text:locked.text||readableColor(base.text,[background],7),muted:locked.muted||readableColor(base.muted,[background],4.5),
  accent:locked.accent||readableColor(accent,[background],4.5),border:locked.border||mixColor(base.border,accent,ratio)};
}
export function createCoverSampler(doc){
 const cache=new Map();return {sample(image){const key=image.currentSrc||image.src;if(!image.complete||!image.naturalWidth)return null;
  if(cache.has(key))return cache.get(key);let result=null;
  try{const canvas=doc.createElement('canvas');canvas.width=canvas.height=48;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,48,48);result=dominantColors(context.getImageData(0,0,48,48).data);}catch{/* A remote image without CORS keeps the original palette. */}
  if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
 },clear(){cache.clear();}};
}
