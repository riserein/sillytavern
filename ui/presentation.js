import { normalizeDesign, designPalette } from './config.js';
import { playSymbol } from '../player-components.js';

/** Reuses the existing DOM and Audio. Applying a design never issues an audio command. */
export function createDesignPresentation({ panel, launcher, audio, readIcon, onPlay, onNext, getTrackNumber = () => 0 }) {
    const doc=panel.ownerDocument,abort=new AbortController();
    let disposed=false,revision=0,iconUrl=null,iconId=null,current=normalizeDesign();
    const underlying=new WeakMap();
    const aliases={'--stm-solid':'background','--stm-body':'text','--stm-muted':'muted','--stm-accent':'accent','--stm-line':'border','--stm-subtle':'surface','--stm-glass':'glass','--stm-matte':'background','--stm-active':'selected','--stm-hover':'hover','--stm-on-accent':'on-accent'};
    const stage=panel.querySelector('.stm-cover-stage'),image=panel.querySelector('.stm-cover-image');
    const art=doc.createElement('span');art.className='stm-design-disc-art';image.before(art);art.append(image);
    const reels=doc.createElement('span');reels.className='stm-design-reels';reels.setAttribute('aria-hidden','true');
    reels.innerHTML='<i></i><i></i>';const caption=doc.createElement('span');caption.className='stm-design-tape-caption';caption.setAttribute('aria-hidden','true');stage.append(reels,caption);
    const arm=doc.createElement('span');arm.className='stm-design-tonearm';arm.setAttribute('aria-hidden','true');stage.after(arm);
    const cassette=doc.createElement('span');cassette.className='stm-launch-cassette';cassette.setAttribute('aria-hidden','true');cassette.innerHTML='<i></i><i></i>';
    const custom=doc.createElement('img');custom.className='stm-launch-custom';custom.alt='';custom.hidden=true;
    const title=doc.createElement('span');title.className='stm-launch-title';
    const play=doc.createElement('button');play.type='button';play.className='stm-launch-play';
    const next=doc.createElement('button');next.type='button';next.className='stm-launch-next';next.textContent='›';next.setAttribute('aria-label','悬浮组件下一首');
    play.addEventListener('click',event=>{event.stopPropagation();onPlay();},{signal:abort.signal});
    next.addEventListener('click',event=>{event.stopPropagation();onNext();},{signal:abort.signal});
    for(const button of [play,next])button.addEventListener('keydown',event=>event.stopPropagation(),{signal:abort.signal});
    launcher.append(cassette,custom,title,play,next);
    function sync() {
        if(disposed)return;
        const text=panel.querySelector('[data-role=title]').textContent;
        title.textContent=text;caption.textContent=text;title.title=text;
        caption.dataset.number=getTrackNumber()?String(getTrackNumber()).padStart(2,'0'):'—';
        const playing=!audio.paused&&!audio.ended;play.innerHTML=playSymbol(playing);play.setAttribute('aria-label',playing?'暂停音乐':'播放音乐');
        play.disabled=panel.querySelector('[data-action=play]').disabled;next.disabled=panel.querySelector('[data-action=next]').disabled;
    }
    const observer=new MutationObserver(sync);observer.observe(panel.querySelector('[data-role=title]'),{childList:true,characterData:true,subtree:true});
    for(const event of ['play','playing','pause','ended','emptied'])audio.addEventListener(event,sync,{signal:abort.signal});
    const visibility=()=>{for(const root of [panel,launcher])root.dataset.visualHidden=String(doc.hidden);};
    doc.addEventListener('visibilitychange',visibility,{signal:abort.signal});visibility();
    async function loadIcon(id) {
        if(iconId===id)return;iconId=id;const stamp=++revision;
        custom.hidden=true;custom.removeAttribute('src');if(iconUrl)URL.revokeObjectURL(iconUrl);iconUrl=null;
        if(!id)return;
        try{const blob=await readIcon(id);if(disposed||stamp!==revision)return;if(!blob)throw new Error('图标缺失');iconUrl=URL.createObjectURL(blob);custom.src=iconUrl;custom.hidden=false;}
        catch{if(!disposed&&stamp===revision){custom.hidden=true;launcher.dataset.iconMissing='true';}}
    }
    function apply(input,{motion=null,accessible=false}={}) {
        current=normalizeDesign(input);const c=current.customization;
        stage.setAttribute('aria-label',accessible||c.showLyricsButton?'显示歌词':'当前歌曲封面');stage.tabIndex=accessible||c.showLyricsButton?0:-1;
        for(const root of [panel,launcher]) {
            let base=underlying.get(root);if(!base){base=new Map();underlying.set(root,base);}
            // Existing appearance controls own their original inline tokens. Keep
            // them underneath this layer so going back to night is lossless.
            root.dataset.designColors='false';
            for(const key of Object.keys(aliases)){
                const value=root.style.getPropertyValue(key);
                if(!value.includes('var(--design-'))base.set(key,value);
                if(base.get(key))root.style.setProperty(key,base.get(key));else root.style.removeProperty(key);
            }
            const computed=getComputedStyle(root);
            const fallbacks={background:'--stm-solid',surface:'--stm-subtle',text:'--stm-body',muted:'--stm-muted',accent:'--stm-accent',border:'--stm-line'};
            const theme=designPalette(current.theme,root.dataset.colorScheme);
            const palette=Object.fromEntries(Object.entries(fallbacks).map(([key,token])=>[key,c.colors[key]||theme[key]||computed.getPropertyValue(token).trim()]));
            root.dataset.layout=current.layout;root.dataset.designTheme=current.theme;root.dataset.launcher=current.launcher;
            root.dataset.accessibleControls=String(accessible);
            root.dataset.motion=motion||c.animationLevel;root.dataset.designMaterial=c.material;root.dataset.designBody=c.body;root.dataset.grooves=c.grooves;root.dataset.launcherShape=c.launcherShape;
            root.dataset.designFocus=String(!accessible&&c.focus);root.dataset.designDecorations=String(c.showDecorations);
            for(const name of ['Artist','LyricsButton','Progress','Volume','Mode','Queue','Background','Next','TrackNumber'])root.dataset['hide'+name]=String(!accessible&&!c['show'+name]);
            const numbers={coverSize:c.coverSize,radius:c.cornerRadius+'px',opacity:c.opacity,blur:c.blur+'px',buttonSize:c.buttonSize+'px',titleSize:c.titleSize+'px',launcherSize:c.launcherSize+'px',launcherOpacity:c.launcherOpacity};
            for(const [key,value]of Object.entries(numbers))root.style.setProperty('--design-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),String(value));
            root.dataset.orientation=c.orientation;
            for(const key of ['background','surface','text','muted','accent','border']){
                const value=palette[key];
                if(value)root.style.setProperty('--design-'+key,value);else root.style.removeProperty('--design-'+key);
            }
            root.dataset.designColors=String(current.theme!=='inherit'||Object.values(c.colors).some(Boolean));
            if(root.dataset.designColors==='true'){
                root.style.setProperty('--design-glass','color-mix(in srgb,var(--design-background) 80%,transparent)');
                root.style.setProperty('--design-selected','color-mix(in srgb,var(--design-accent) 15%,transparent)');
                root.style.setProperty('--design-hover','color-mix(in srgb,var(--design-accent) 12%,transparent)');
                const hex=palette.accent;const brightness=/^#[a-f\d]{6}$/i.test(hex)?[1,3,5].reduce((sum,start,i)=>sum+parseInt(hex.slice(start,start+2),16)*[.299,.587,.114][i],0):180;
                root.style.setProperty('--design-on-accent',brightness>150?'#182020':'#fffaf5');
                for(const [token,key]of Object.entries(aliases))root.style.setProperty(token,`var(--design-${key})`);
            }
            if(c.tonearmColor)root.style.setProperty('--design-tonearm',c.tonearmColor);else root.style.removeProperty('--design-tonearm');
            if(c.labelColor)root.style.setProperty('--design-label',c.labelColor);else root.style.removeProperty('--design-label');
        }
        launcher.setAttribute('role',current.launcher==='capsule'?'group':'button');
        delete launcher.dataset.iconMissing;void loadIcon(current.launcher==='custom'?c.iconId:null);sync();
    }
    apply(current);
    return {apply,sync,get config(){return structuredClone(current);},dispose(){disposed=true;revision++;abort.abort();observer.disconnect();if(iconUrl)URL.revokeObjectURL(iconUrl);iconUrl=null;}};
}
