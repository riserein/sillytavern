/** Geometry only: no chat contents are read. Keep every launcher above a mobile input/keyboard. */
export function createLauncherAvoidance(launcher,{getInput=()=>launcher.ownerDocument.querySelector('#send_form'),onMove=()=>{}}={}) {
 const doc=launcher.ownerDocument,win=doc.defaultView,abort=new AbortController();let frame=null,observed=null,disposed=false;
 function refresh(){
  if(disposed||launcher.hidden||launcher.classList.contains('stm-dragging'))return;
  const input=getInput();if(input!==observed){if(observed)observer.unobserve(observed);observed=input;if(input)observer.observe(input);}
  const bounds=launcher.getBoundingClientRect(),visible=win.visualViewport;
  const left=(visible?.offsetLeft||0)+8,top=(visible?.offsetTop||0)+8,right=(visible?.offsetLeft||0)+(visible?.width||win.innerWidth)-8,bottom=(visible?.offsetTop||0)+(visible?.height||win.innerHeight)-8;
  let x=Math.max(left,Math.min(bounds.x,right-bounds.width)),y=Math.max(top,Math.min(bounds.y,bottom-bounds.height));
  const avoid=win.innerWidth<=600?input?.getBoundingClientRect():null;
  if(avoid?.width&&avoid.height&&x<avoid.right&&x+bounds.width>avoid.left&&y<avoid.bottom&&y+bounds.height>avoid.top)y=Math.max(top,avoid.top-bounds.height-8);
  if(Math.abs(x-bounds.x)<.5&&Math.abs(y-bounds.y)<.5)return;
  Object.assign(launcher.style,{left:x+'px',top:y+'px',right:'auto',transform:'none'});onMove({x:x/Math.max(1,win.innerWidth),y:y/Math.max(1,win.innerHeight)});
 }
 const observer=new ResizeObserver(()=>queue());
 function queue(){if(frame!==null)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=null;refresh();});}
 observer.observe(launcher);
 for(const event of ['pointerup','pointercancel'])launcher.addEventListener(event,queue,{signal:abort.signal});
 win.addEventListener('resize',queue,{signal:abort.signal});win.visualViewport?.addEventListener('resize',queue,{signal:abort.signal});win.visualViewport?.addEventListener('scroll',queue,{signal:abort.signal});queue();
 return {refresh,dispose(){disposed=true;abort.abort();observer.disconnect();if(frame!==null)cancelAnimationFrame(frame);observed=null;}};
}
