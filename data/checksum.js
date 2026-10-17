import {sha256} from '../vendor/sha256.js';
const table=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
export const hex = bytes => [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export const hashText = text => hex(sha256(new TextEncoder().encode(text)));
export async function checksum(blob,{signal,onProgress=()=>{}}={}) {
    const hash=sha256.create();let crc=0xffffffff,offset=0,turn=0;
    while(offset<blob.size) {
        signal?.throwIfAborted();
        const bytes=new Uint8Array(await blob.slice(offset,offset+1024*1024).arrayBuffer());
        hash.update(bytes);for(let i=0;i<bytes.length;i++)crc=(crc>>>8)^table[(crc^bytes[i])&255];
        offset+=bytes.length;onProgress(offset,blob.size);
        if(++turn%4===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    signal?.throwIfAborted();
    return {sha256:hex(hash.digest()),crc32:(crc^0xffffffff)>>>0,bytes:blob.size};
}
