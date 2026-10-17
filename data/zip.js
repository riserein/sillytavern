// Standard ZIP STORE + ZIP64 archive offsets. Binary files remain independent Blob slices.
// Intentionally refuses encrypted/compressed/unknown paths instead of unpacking untrusted ZIPs.
const U32=0xffffffff,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const view=length=>{const bytes=new Uint8Array(length);return [bytes,new DataView(bytes.buffer)];};
const safe64=(v,offset)=>{const n=Number(v.getBigUint64(offset,true));if(!Number.isSafeInteger(n)||n<0)throw new Error('ZIP 大小或偏移无效。');return n;};
const validName=name=>name==='manifest.json'||name==='manifest.sha256'||/^assets\/[a-f0-9]{64}\.bin$/.test(name);
export function zipBlob(entries) {
    const parts=[],central=[];let offset=0;
    const names=new Set();
    for(const {path,blob,crc32} of entries) {
        if(!validName(path)||names.has(path)||blob.size>=U32)throw new Error('ZIP 资源名称重复、无效或单文件过大。');
        names.add(path);const name=encoder.encode(path);
        const [head,h]=view(30);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,2048,true);h.setUint32(14,crc32,true);h.setUint32(18,blob.size,true);h.setUint32(22,blob.size,true);h.setUint16(26,name.length,true);
        parts.push(head,name,blob);
        const wide=offset>=U32,extra=wide?12:0,[tail,t]=view(46+name.length+extra);
        t.setUint32(0,0x02014b50,true);t.setUint16(4,45,true);t.setUint16(6,wide?45:20,true);t.setUint16(8,2048,true);t.setUint32(16,crc32,true);t.setUint32(20,blob.size,true);t.setUint32(24,blob.size,true);t.setUint16(28,name.length,true);t.setUint16(30,extra,true);t.setUint32(42,wide?U32:offset,true);tail.set(name,46);
        if(wide){const p=46+name.length;t.setUint16(p,1,true);t.setUint16(p+2,8,true);t.setBigUint64(p+4,BigInt(offset),true);}
        central.push(tail);offset+=30+name.length+blob.size;
        if(!Number.isSafeInteger(offset))throw new Error('备份超过浏览器可精确处理的大小。');
    }
    const start=offset,size=central.reduce((sum,row)=>sum+row.length,0),wide=start+size>=U32||entries.length>=65535;
    parts.push(...central);
    if(wide) {
        const [end,e]=view(56);e.setUint32(0,0x06064b50,true);e.setBigUint64(4,44n,true);e.setUint16(12,45,true);e.setUint16(14,45,true);e.setBigUint64(24,BigInt(entries.length),true);e.setBigUint64(32,BigInt(entries.length),true);e.setBigUint64(40,BigInt(size),true);e.setBigUint64(48,BigInt(start),true);
        const [loc,l]=view(20);l.setUint32(0,0x07064b50,true);l.setBigUint64(8,BigInt(start+size),true);l.setUint32(16,1,true);parts.push(end,loc);
    }
    const [end,e]=view(22);e.setUint32(0,0x06054b50,true);e.setUint16(8,wide?65535:entries.length,true);e.setUint16(10,wide?65535:entries.length,true);e.setUint32(12,wide?U32:size,true);e.setUint32(16,wide?U32:start,true);parts.push(end);
    return new Blob(parts,{type:'application/zip'});
}
export async function readZip(file,{signal}={}) {
    signal?.throwIfAborted();if(file.size<22)throw new Error('备份 ZIP 不完整。');
    const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65557)).arrayBuffer()),v=new DataView(tail.buffer);let end=-1;
    for(let i=tail.length-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50 && i+22+v.getUint16(i+20,true)===tail.length){end=i;break;}
    if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))throw new Error('备份 ZIP 尾部或分卷格式不受支持。');
    let count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),offset=v.getUint32(end+16,true);
    if(count===65535||size===U32||offset===U32){
        const at=file.size-tail.length+end-20,loc=new DataView(await file.slice(at,at+20).arrayBuffer());
        if(at<0||loc.byteLength!==20||loc.getUint32(0,true)!==0x07064b50||loc.getUint32(4,true)||loc.getUint32(16,true)!==1)throw new Error('ZIP64 定位记录无效。');
        const start=safe64(loc,8),z=new DataView(await file.slice(start,start+56).arrayBuffer());
        if(z.byteLength!==56||z.getUint32(0,true)!==0x06064b50||z.getUint32(16,true)||z.getUint32(20,true))throw new Error('ZIP64 目录无效。');
        count=safe64(z,32);size=safe64(z,40);offset=safe64(z,48);
    }
    if(count>100000||size>64*1024*1024||offset+size>file.size-22)throw new Error('ZIP 目录超限或偏移无效。');
    const bytes=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer()),d=new DataView(bytes.buffer),entries=new Map(),ranges=[];let at=0;
    for(let i=0;i<count;i++) {
        signal?.throwIfAborted();
        if(at+46>bytes.length||d.getUint32(at,true)!==0x02014b50)throw new Error('ZIP 目录损坏。');
        const flags=d.getUint16(at+8,true),method=d.getUint16(at+10,true),crc32=d.getUint32(at+16,true),packed=d.getUint32(at+20,true),unpacked=d.getUint32(at+24,true),n=d.getUint16(at+28,true),x=d.getUint16(at+30,true),comment=d.getUint16(at+32,true);
        if(at+46+n+x+comment>bytes.length||flags&~2048||method!==0||packed!==unpacked||unpacked>128*1024*1024||d.getUint16(at+34,true))throw new Error('ZIP 包含不受支持的压缩/加密/超限资源，请使用插件原始备份文件。');
        const name=decoder.decode(bytes.subarray(at+46,at+46+n));let local=d.getUint32(at+42,true);
        if(!validName(name)||entries.has(name))throw new Error('ZIP 包含重复或不安全的资源路径。');
        if(local===U32){let e=at+46+n,found=false;while(e+4<=at+46+n+x){const type=d.getUint16(e,true),len=d.getUint16(e+2,true);if(e+4+len>at+46+n+x)throw new Error('ZIP64 附加字段损坏。');if(type===1&&len>=8){local=safe64(d,e+4);found=true;break;}e+=4+len;}if(!found)throw new Error('ZIP64 缺少资源偏移。');}
        if(local+30>offset)throw new Error('ZIP 资源偏移越界。');
        const h=new DataView(await file.slice(local,local+30).arrayBuffer());
        if(h.getUint32(0,true)!==0x04034b50||h.getUint16(6,true)!==flags||h.getUint16(8,true)!==method||h.getUint32(14,true)!==crc32||h.getUint32(18,true)!==packed||h.getUint32(22,true)!==unpacked)throw new Error('ZIP 资源头与目录不一致。');
        const ns=h.getUint16(26,true),extra=h.getUint16(28,true),start=local+30+ns+extra;
        if(start+packed>offset||decoder.decode(new Uint8Array(await file.slice(local+30,local+30+ns).arrayBuffer()))!==name)throw new Error('ZIP 文件名或范围不一致。');
        entries.set(name,{blob:file.slice(start,start+packed),bytes:unpacked,crc32});ranges.push([local,start+packed]);at+=46+n+x+comment;
    }
    ranges.sort((a,b)=>a[0]-b[0]);
    if(at!==size||ranges.some((row,i)=>i&&row[0]<ranges[i-1][1]))throw new Error('ZIP 资源重叠或目录长度异常。');
    return entries;
}
