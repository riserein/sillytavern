import {normalizeSettings} from '../core.js';
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
export function fixture(){
 const local=uuid(1),cover='cover:'+uuid(2),background='background:'+uuid(3),font='font:'+uuid(4);
 const audio=new Blob([Uint8Array.of(0,255,21,128,3)],{type:'audio/mpeg'}),image=new Blob(['picture'],{type:'image/png'}),typeface=new Blob(['font'],{type:'font/woff2'});
 const settings=normalizeSettings({tracks:[{id:local,kind:'local',title:'测试音乐',coverId:cover,lyrics:'[00:01]歌词'},{id:'remote',kind:'url',url:'https://audio.example/music.mp3',title:'在线'}],playlists:[{id:'list',name:'歌单',trackIds:[local,'remote'],characterAvatars:['a.png'],coverId:cover}],backgroundId:background,fonts:[{id:font,name:'自定义'}],fontPreset:'custom',fontId:font,volume:.4,mode:'shuffle',recentPlays:[{trackId:local,at:Date.now()}],playEvents:[{trackId:local,at:Date.now()}]});
 const entries=[[local,audio],[cover,image],[background,image],[background+':original',image],[font,typeface]];
 const projects=[{id:'rscp:one',revision:4,format:1,title:'项目',tracks:[{...settings.tracks[0],exportBlob:audio,exportCover:image}],sourceSettings:{fontPreset:'custom',fontId:font,backgroundId:background},assets:{fontBlob:typeface,imageBlob:image},form:{'stm-maker-title':'项目','font-credit':'已获授权','color:background':'#234567',background:true}}];
 return {settings,entries,projects,store:{entries:async()=>entries}};
}
