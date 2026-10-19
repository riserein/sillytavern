/** The book reuses the existing cover, controls and lyric reader DOM. It never
 * creates an Audio, parses LRC or writes author/recipient preferences. */
export function createJournal({panel,audio,getTrack,getTracks,getGroup,getScene,onTrack,onLyrics}) {
    const doc=panel.ownerDocument,abort=new AbortController(),playback=panel.querySelector('[data-view=playback]');
    const book=doc.createElement('div');book.className='stm-journal';book.hidden=true;
    book.innerHTML='<section class="stm-journal-left" aria-label="手账音乐页"><div class="stm-journal-edition">PERSONAL MUSIC JOURNAL</div><div data-journal-cover></div><div data-journal-controls></div><p class="stm-hint" data-journal-album></p></section><section class="stm-journal-right" aria-label="手账阅读页"><nav class="stm-journal-tabs" aria-label="手账栏目"><button type="button" data-journal-page="player">Music｜音乐</button><button type="button" data-journal-page="lyrics">Lyrics｜歌词</button><button type="button" data-journal-page="notes">Notes｜角色手记</button><button type="button" data-journal-page="collection">Collection｜曲目目录</button></nav><div class="stm-journal-reading"><section data-journal-pane="lyrics" aria-label="手账歌词"></section><section data-journal-pane="notes" aria-label="角色手记"><h3 data-journal-note-title></h3><h4 data-journal-scene-heading>场景随笔</h4><p data-journal-description></p><h4 data-journal-song-heading>歌曲手记</h4><p data-journal-note></p></section><section data-journal-pane="collection" aria-label="手账曲目目录"><h3 data-journal-collection-title></h3><ol></ol></section></div></section>';
    const sceneBar=playback.querySelector('.stm-scene-bar');if(sceneBar)sceneBar.after(book);else playback.prepend(book);
    const cover=panel.querySelector('.stm-cover-stage'),controls=panel.querySelector('.stm-player-controls'),lyrics=panel.querySelector('.stm-lyrics-view');
    const homes=[cover,controls,lyrics].map(node=>{const anchor=doc.createComment('journal-home');node.before(anchor);return {node,anchor};});
    const q=s=>book.querySelector(s),narrow=()=>{const css=getComputedStyle(panel);return panel.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)<520;},reduced=doc.defaultView.matchMedia('(prefers-reduced-motion:reduce)');
    let active=false,tab='lyrics',config=null,mobile=null,animation=null,disposed=false;
    function show(next,{animate=true}={}){
        if(!active)return;
        if(!['player','lyrics','notes','collection'].includes(next))next='lyrics';
        if(!narrow()&&next==='player')next='lyrics';
        tab=next;book.dataset.journalPage=next;
        for(const b of book.querySelectorAll('[data-journal-page]'))b.setAttribute('aria-pressed',String(b.dataset.journalPage===next));
        for(const p of book.querySelectorAll('[data-journal-pane]'))p.hidden=p.dataset.journalPane!==next;
        lyrics.hidden=next!=='lyrics';panel.dataset.lyricsOpen='false';
        onLyrics(next==='lyrics');
        animation?.cancel();animation=null;
        const target=next==='player'?q('.stm-journal-left'):q('.stm-journal-reading');
        if(animate&&!reduced.matches&&panel.dataset.motion!=='off'&&config?.customization.journalFlip!==false&&target.animate)animation=target.animate([{opacity:.8,transform:'translateX(7px)'},{opacity:1,transform:'none'}],{duration:config?.customization.journalDuration||320,easing:'ease-out'});
        sync();
    }
    function sync(){
        if(!active||disposed)return;
        const track=getTrack(),scene=getScene(),group=getGroup();
        q('[data-journal-album]').textContent=track?.album||'';
        q('[data-journal-note-title]').textContent=track?.title||'';
        q('[data-journal-description]').textContent=scene?.description||'';
        q('[data-journal-scene-heading]').hidden=!scene?.description;
        const note=group?.showNotes!==false?group?.notes?.find(n=>n.trackId===track?.id)?.text||'':'';
        q('[data-journal-note]').textContent=note;q('[data-journal-song-heading]').hidden=!note;
        q('[data-journal-collection-title]').textContent=scene?.name||'当前曲目目录';
        const list=q('[data-journal-pane=collection] ol');list.replaceChildren();
        for(const [i,row] of getTracks().entries()){
            const li=doc.createElement('li'),b=doc.createElement('button');b.type='button';b.dataset.journalTrack=row.id;
            const number=doc.createElement('span'),title=doc.createElement('span');number.textContent=String(i+1).padStart(2,'0');title.textContent=row.title;
            b.append(number,title);b.setAttribute('aria-current',String(row.id===track?.id));b.setAttribute('aria-label',`${row.id===track?.id&&!audio.paused?'暂停':'播放'}：${row.title}`);li.append(b);list.append(li);
        }
    }
    function apply(value){
        config=value;const enabled=value.layout==='journal';
        if(enabled&&!active){active=true;book.hidden=false;q('[data-journal-cover]').append(cover);q('[data-journal-controls]').append(controls);q('[data-journal-pane=lyrics]').append(lyrics);
            mobile=narrow();show(mobile?'player':value.customization.journalTab||'lyrics',{animate:false});
        } else if(!enabled&&active){
            active=false;animation?.cancel();animation=null;for(const {node,anchor} of homes)anchor.after(node);lyrics.hidden=true;panel.dataset.lyricsOpen='false';onLyrics(false);book.hidden=true;
        }
        if(active){book.dataset.binding=value.customization.journalBinding||'stitch';book.dataset.edges=String(value.customization.journalEdges!==false);sync();}
    }
    book.addEventListener('click',e=>{const page=e.target.closest('button[data-journal-page]');if(page){show(page.dataset.journalPage);return;}const track=e.target.closest('[data-journal-track]');if(track)onTrack(track.dataset.journalTrack);},{signal:abort.signal});
    for(const event of ['playing','pause','ended'])audio.addEventListener(event,sync,{signal:abort.signal});
    const resize=new ResizeObserver(()=>{if(!active)return;const next=narrow();if(next!==mobile){mobile=next;show(next?'player':tab==='player'?'lyrics':tab,{animate:false});}});resize.observe(panel);
    return {apply,show,sync,resume(){show(tab,{animate:false});},get active(){return active;},dispose(){disposed=true;abort.abort();resize.disconnect();animation?.cancel();for(const {node,anchor} of homes){anchor.after(node);anchor.remove();}book.remove();}};
}
