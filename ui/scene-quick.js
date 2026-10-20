/** Owns a small popover, never changes panel visibility or creates audio. */
export function createSceneQuick({launcher,panel,getScenes,getCurrent,onChoose,isHidden,getCover,onError}){
 const doc=panel.ownerDocument,win=window,abort=new AbortController(),root=doc.createElement('section');root.className='stm-scene-quick';root.hidden=true;root.setAttribute('aria-label','快速切换音乐场景');root.setAttribute('role','dialog');doc.body.append(root);
 let timer=null,start=null,suppress=false,epoch=0,disposed=false;
 const cancel=()=>{win.clearTimeout(timer);timer=null;start=null;};
 function close(){++epoch;root.hidden=true;root.replaceChildren();}
 function open(){cancel();const rows=getScenes();if(disposed||isHidden()||launcher.classList.contains('stm-dragging')||rows.length<2)return false;
  close();const stamp=epoch;const css=win.getComputedStyle(panel);for(const [key,token]of [['surface','--read-surface'],['text','--read-body'],['border','--stm-line']])root.style.setProperty('--quick-'+key,css.getPropertyValue(token));root.style.fontFamily=css.fontFamily;root.style.fontSize=css.fontSize;root.hidden=false;const heading=doc.createElement('strong');heading.textContent='音乐场景';root.append(heading);
  for(const row of rows){const b=doc.createElement('button');b.type='button';b.dataset.quickScene=row.id;b.setAttribute('aria-pressed',String(row.id===getCurrent()));
   const img=doc.createElement('img');img.alt='';img.hidden=true;const label=doc.createElement('span');label.textContent=row.name+' · '+row.trackIds.length+' 首';b.append(img,label);root.append(b);
   if(row.coverId)void getCover(row.coverId).then(url=>{if(!disposed&&stamp===epoch&&url){img.src=url;img.hidden=false;}}).catch(()=>{});
  }
  const rect=launcher.getBoundingClientRect(),view=win.visualViewport,vw=view?.width||win.innerWidth,vh=view?.height||win.innerHeight,left=view?.offsetLeft||0,top=view?.offsetTop||0,width=Math.min(300,vw-24);root.style.maxHeight=Math.min(520,vh*.65)+'px';root.style.width=width+'px';root.style.left=Math.max(left+12,Math.min(left+vw-width-12,rect.left))+'px';root.style.top=Math.max(top+12,Math.min(top+vh-root.offsetHeight-12,rect.top-root.offsetHeight-8))+'px';(root.querySelector('[aria-pressed=true]')||root.querySelector('button'))?.focus({preventScroll:true});return true;
 }
 const on=(node,type,fn,extra={})=>node.addEventListener(type,fn,{signal:abort.signal,...extra});
 on(launcher,'contextmenu',e=>{if(open()){e.preventDefault();e.stopPropagation();}});
 on(launcher,'pointerdown',e=>{if(e.button!==0||e.target.closest('button')&&e.target.closest('button')!==launcher)return;suppress=false;cancel();start={x:e.clientX,y:e.clientY};timer=win.setTimeout(()=>{if(open())suppress=true;},550);},{capture:true});
 on(launcher,'pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)cancel();},{capture:true});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])on(launcher,type,cancel,{capture:true});
 on(launcher,'click',e=>{if(suppress){suppress=false;e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
 on(root,'click',async e=>{const b=e.target.closest('[data-quick-scene]');if(!b)return;const id=b.dataset.quickScene;close();try{if(!isHidden())await onChoose(id);}catch(error){onError(error);}});
 on(root,'keydown',e=>{const buttons=[...root.querySelectorAll('button')],at=buttons.indexOf(doc.activeElement);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();launcher.focus({preventScroll:true});return;}if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[i]?.focus();}});
 on(win,'resize',close);
 on(document,'pointerdown',e=>{if(!root.hidden&&!root.contains(e.target)&&!launcher.contains(e.target))close();},{capture:true});
 on(document,'keydown',e=>{if(e.key==='Escape'&&!root.hidden){e.stopPropagation();close();launcher.focus({preventScroll:true});}});
 return {open,close,dispose(){disposed=true;cancel();close();abort.abort();root.remove();}};
}
