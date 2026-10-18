import {LAYOUTS,DESIGN_THEMES,MOTION_LEVELS,normalizeDesign} from './config.js';
/** Shared settings; author tools are attached separately and never enter recipient code. */
export function createDesignControls({panel,settings,getDesign,onChange,onAccessibility,isPortable=false}) {
 const doc=panel.ownerDocument,group=doc.createElement('details');group.className='stm-settings-group stm-design-settings';group.open=true;
 group.innerHTML='<summary>播放器形态</summary><div data-design-choices><label for="stm-design-layout">播放器布局</label><select id="stm-design-layout"></select><label for="stm-design-theme">视觉主题</label><select id="stm-design-theme"></select></div><label for="stm-design-motion">动画等级</label><select id="stm-design-motion"></select><label class="stm-check-label"><input type="checkbox" id="stm-design-accessible">显示全部控制与提示</label><label class="stm-check-label" data-design-permission><input type="checkbox" id="stm-design-allow">允许随卡接收者调整布局</label><p class="stm-hint">切换形态不重新加载音乐；原外观配色、字体与背景继续保留。选择“沿用当前配色”可使用原外观设置。</p>';
 panel.querySelector('#stm-appearance').prepend(group);const q=selector=>group.querySelector(selector),abort=new AbortController();
 for(const [id,entry]of Object.entries(LAYOUTS))q('#stm-design-layout').append(new Option(entry.name+' · '+entry.caption,id));
 for(const [id,entry]of Object.entries(DESIGN_THEMES))q('#stm-design-theme').append(new Option(entry.name,id));
 if(isPortable)q('#stm-design-motion').append(new Option('使用作者预设',''));
 for(const [i,id]of MOTION_LEVELS.entries())q('#stm-design-motion').append(new Option(['关闭','轻量','标准','丰富'][i],id));
 for(const [selector,field]of [['#stm-design-layout','layout'],['#stm-design-theme','theme']])q(selector).addEventListener('change',event=>{const next=normalizeDesign(getDesign());next[field]=event.target.value;onChange(next);},{signal:abort.signal});
 q('#stm-design-motion').addEventListener('change',event=>{if(isPortable){settings.visualMotion=event.target.value||null;onAccessibility();}else{const next=normalizeDesign(getDesign());next.customization.animationLevel=event.target.value;onChange(next);}},{signal:abort.signal});
 q('#stm-design-accessible').addEventListener('change',event=>{settings.accessibleControls=event.target.checked;onAccessibility();},{signal:abort.signal});
 q('#stm-design-allow').addEventListener('change',event=>{const next=normalizeDesign(getDesign());next.allowRecipientLayout=event.target.checked;onChange(next);},{signal:abort.signal});
 function refresh(){const config=normalizeDesign(getDesign());q('#stm-design-layout').value=config.layout;q('#stm-design-theme').value=config.theme;q('#stm-design-motion').value=isPortable?(settings.visualMotion||''):config.customization.animationLevel;q('#stm-design-accessible').checked=settings.accessibleControls;q('#stm-design-allow').checked=config.allowRecipientLayout;q('[data-design-permission]').hidden=isPortable;q('[data-design-choices]').hidden=isPortable&&!settings.uiDesign.allowRecipientLayout;}
 refresh();return {refresh,group,dispose(){abort.abort();group.remove();}};
}
