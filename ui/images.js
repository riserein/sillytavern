import {inspectStaticRaster} from './raster.js';
/** Static raster icons only. Decode and re-encode, discarding metadata and active content. */
export async function prepareDesignIcon(file,{signal,reencode=true,maxBytes=1024*1024}={}) {
    if(!file?.size||file.size>maxBytes||!['image/png','image/webp'].includes(file.type))throw new Error('请选择 1 MiB 以内的静态 PNG 或 WebP 图标。');
    const bytes=new Uint8Array(await file.arrayBuffer());signal?.throwIfAborted();inspectStaticRaster(bytes,file.type);
    const bitmap=await createImageBitmap(file);
    try{
        signal?.throwIfAborted();if(bitmap.width>2048||bitmap.height>2048||!bitmap.width||!bitmap.height)throw new Error('图标尺寸不能超过 2048 × 2048。');
        if(!reencode)return file;
        const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9));signal?.throwIfAborted();if(!result?.size)throw new Error('图标处理失败。');return result;
    }finally{bitmap.close();}
}
/** Full-size static collage art. Validate headers before browser decoding; no SVG,
 * GIF, APNG or animated WebP, and never transcode any audio. */
export async function prepareCollageImage(file,{signal,optimize=false}={}){
 if(!file?.size||file.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 2 MiB 以内的静态 PNG、JPEG 或 WebP 图片。');
 inspectStaticRaster(new Uint8Array(await file.arrayBuffer()),file.type);
 signal?.throwIfAborted();const bitmap=await createImageBitmap(file);try{if(!bitmap.width||!bitmap.height||bitmap.width>2048||bitmap.height>2048)throw new Error('图片尺寸不能超过 2048 × 2048。');signal?.throwIfAborted();if(!optimize)return file;const canvas=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9));if(!result)throw new Error('图片优化失败，原资源未替换。');signal?.throwIfAborted();return result;}finally{bitmap.close();}
}
