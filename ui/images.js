/** Static raster icons only. Decode and re-encode, discarding metadata and active content. */
export async function prepareDesignIcon(file,{signal}={}) {
    if(!file?.size||file.size>1024*1024||!['image/png','image/webp'].includes(file.type))throw new Error('请选择 1 MiB 以内的静态 PNG 或 WebP 图标。');
    const bytes=new Uint8Array(await file.arrayBuffer());signal?.throwIfAborted();
    const dimensions=(width,height)=>{if(!width||!height||width>2048||height>2048)throw new Error('图标尺寸不能超过 2048 × 2048。');};
    if(file.type==='image/png'){
        if(bytes.length<33||![137,80,78,71,13,10,26,10].every((byte,i)=>bytes[i]===byte))throw new Error('PNG 文件内容不正确。');
        const view=new DataView(bytes.buffer);if(view.getUint32(8)!==13||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')throw new Error('PNG 图片头无效。');dimensions(view.getUint32(16),view.getUint32(20));for(let at=8;at+12<=bytes.length;){const size=view.getUint32(at),kind=String.fromCharCode(...bytes.subarray(at+4,at+8));if(size>bytes.length-at-12)throw new Error('PNG 文件不完整。');if(kind==='acTL')throw new Error('请使用静态图片，不支持动画 PNG。');at+=size+12;}
    }else{
        if(String.fromCharCode(...bytes.subarray(0,4))!=='RIFF'||String.fromCharCode(...bytes.subarray(8,12))!=='WEBP')throw new Error('WebP 文件内容不正确。');
        const view=new DataView(bytes.buffer);for(let at=12;at+8<=bytes.length;){const kind=String.fromCharCode(...bytes.subarray(at,at+4)),size=view.getUint32(at+4,true),start=at+8;if(size>bytes.length-at-8)throw new Error('WebP 文件不完整。');if(kind==='ANIM'||kind==='ANMF'||kind==='VP8X'&&(bytes[start]&2))throw new Error('请使用静态 WebP 图片。');
            if(kind==='VP8X'&&size>=10)dimensions(1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16),1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16));
            if(kind==='VP8 '&&size>=10)dimensions(view.getUint16(start+6,true)&0x3fff,view.getUint16(start+8,true)&0x3fff);
            if(kind==='VP8L'&&size>=5){const bits=view.getUint32(start+1,true);dimensions((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);}at+=8+size+(size%2);}
    }
    const bitmap=await createImageBitmap(file);
    try{
        signal?.throwIfAborted();if(bitmap.width>2048||bitmap.height>2048||!bitmap.width||!bitmap.height)throw new Error('图标尺寸不能超过 2048 × 2048。');
        const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9));signal?.throwIfAborted();if(!result?.size)throw new Error('图标处理失败。');return result;
    }finally{bitmap.close();}
}
