/** Data only. A design cannot contain CSS, HTML, executable code or remote modules. */
export const UI_VERSION = 1;
export const LAYOUTS = Object.freeze({
    night: { name: '夜航 · 兼容布局', caption: '保留当前的阅读与听音习惯' },
    crystal: { name: 'Crystal Glass', caption: '清透玻璃音乐卡' },
    vinyl: { name: 'Vinyl Atelier', caption: '黑胶唱片机' },
    cassette: { name: 'Cassette Memory', caption: '复古磁带播放器' },
    pure: { name: 'Pure Form', caption: '现代极简' },
});
export const LAUNCHERS = Object.freeze({ vinyl: '黑胶唱片', cd: '透明 CD', cassette: '迷你磁带', capsule: '音乐胶囊', custom: '自定义图标' });
export const DESIGN_THEMES = Object.freeze({
    inherit: { name: '沿用当前配色' },
    'mist-blue': { name: '雾蓝', background: '#192b36', surface: '#29434f', text: '#eff5f5', muted: '#a5c0c8', accent: '#9cccd9', border: '#54747e' },
    walnut: { name: '胡桃与暖金', background: '#2b211b', surface: '#433126', text: '#f3e6d0', muted: '#c4ad91', accent: '#d6b578', border: '#705439' },
    cream: { name: '奶油陶瓷', background: '#eee8dc', surface: '#faf6ed', text: '#35332f', muted: '#6e6a61', accent: '#83613e', border: '#c3b6a3' },
    smoke: { name: '烟灰与橙', background: '#282b2c', surface: '#3a4041', text: '#f4eee4', muted: '#b5bfbe', accent: '#e9aa77', border: '#67716f' },
    ink: { name: '冷灰艺术', background: '#171b20', surface: '#292f36', text: '#eeeef1', muted: '#aeb9c5', accent: '#bacbe0', border: '#57616c' },
    blush: { name: '柔和烟粉', background: '#e8dce0', surface: '#f4ebed', text: '#42343c', muted: '#78616d', accent: '#93586f', border: '#bda1ad' },
});
export const MOTION_LEVELS = ['off', 'light', 'normal', 'rich'];
const color = (value, fallback = null) => /^#[a-f\d]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const number = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const member = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const assetId = value => typeof value === 'string' && /^cover:[a-f0-9-]{36}$/.test(value) ? value : null;
export function normalizeDesign(raw = {}) {
    if (!raw || typeof raw !== 'object' || raw.uiVersion !== undefined && raw.uiVersion !== UI_VERSION) raw = {};
    const input = raw.customization || {};
    const customization = {
        coverSize: number(input.coverSize, .85, .55, 1.15), cornerRadius: number(input.cornerRadius, 18, 0, 36),
        opacity: number(input.opacity, .94, .3, 1), blur: number(input.blur, 16, 0, 24),
        buttonSize: number(input.buttonSize, 54, 40, 68), titleSize: number(input.titleSize, 25, 16, 36),
        launcherSize: number(input.launcherSize, 46, 40, 88), launcherOpacity: number(input.launcherOpacity, 1, .45, 1),
        showArtist: input.showArtist !== false, showLyricsButton: input.showLyricsButton !== false,
        showProgress: input.showProgress !== false, showVolume: input.showVolume !== false,
        showMode: input.showMode !== false, showQueue: input.showQueue !== false, showDecorations: input.showDecorations !== false,
        showBackground: input.showBackground !== false, showNext: input.showNext !== false, showTrackNumber: input.showTrackNumber !== false,
        animationLevel: member(input.animationLevel, MOTION_LEVELS, 'normal'),
        orientation: member(input.orientation, ['horizontal','vertical'], 'horizontal'), focus: input.focus === true,
        material: member(input.material, ['clear','frosted','liquid'], 'frosted'),
        body: member(input.body, ['walnut','metal','ceramic','silver'], 'walnut'),
        grooves: member(input.grooves, ['fine','bold'], 'fine'), launcherShape: member(input.launcherShape, ['circle','rounded','square'], 'circle'),
        iconId: assetId(input.iconId), tonearmColor: color(input.tonearmColor), labelColor: color(input.labelColor),
        colors: Object.fromEntries(['background','surface','text','muted','accent','border'].map(key => [key, color(input.colors?.[key])])),
    };
    return { uiVersion: UI_VERSION, layout: Object.hasOwn(LAYOUTS,raw.layout) ? raw.layout : 'night', theme: Object.hasOwn(DESIGN_THEMES,raw.theme) ? raw.theme : 'inherit', launcher: Object.hasOwn(LAUNCHERS,raw.launcher) ? raw.launcher : 'vinyl', allowRecipientLayout: raw.allowRecipientLayout === true, customization };
}
export function normalizeDesigns(rows) {
    const seen=new Set(),result=[];for(const row of Array.isArray(rows)?rows:[]){if(!row||typeof row.id!=='string'||!/^design:[a-f0-9-]{36}$/.test(row.id)||seen.has(row.id))continue;seen.add(row.id);result.push({id:row.id,name:String(row.name||'我的设计').trim().slice(0,80)||'我的设计',config:normalizeDesign(row.config)});if(result.length===30)break;}return result;
}
export function normalizeRoleDesigns(rows) {
    const seen=new Set(),result=[];for(const row of Array.isArray(rows)?rows:[]){if(!row||typeof row.avatar!=='string'||!row.avatar.length||row.avatar.length>300||seen.has(row.avatar))continue;seen.add(row.avatar);result.push({avatar:row.avatar,config:normalizeDesign(row.config)});if(result.length===1000)break;}return result;
}
export function designReferences(settings) {
    return new Set([settings?.uiDesign,settings?.personalDesign,...(settings?.designs||[]).map(row=>row.config),...(settings?.roleDesigns||[]).map(row=>row.config)].map(config=>config?.customization?.iconId).filter(Boolean));
}
export function validateTemplate(raw) {
    if (!raw || raw.format !== 'riserein-player-design' || raw.version !== UI_VERSION || !raw.config || raw.config.uiVersion !== UI_VERSION) throw new Error('不支持此设计文件或版本；原设计未改变。');
    if (!Object.hasOwn(LAYOUTS,raw.config.layout) || !Object.hasOwn(DESIGN_THEMES,raw.config.theme) || !Object.hasOwn(LAUNCHERS,raw.config.launcher)) throw new Error('设计包含尚未支持的布局、主题或悬浮组件。');
    const c=raw.config.customization;
    if(!c||typeof c!=='object'||Array.isArray(c))throw new Error('设计属性无效。');
    const normalized=normalizeDesign(raw.config);
    for(const key of ['coverSize','cornerRadius','opacity','blur','buttonSize','titleSize','launcherSize','launcherOpacity'])if(Object.hasOwn(c,key)&&(!Number.isFinite(c[key])||normalized.customization[key]!==c[key]))throw new Error(`设计的 ${key} 超出允许范围。`);
    for(const key of ['background','surface','text','muted','accent','border'])if(c.colors?.[key]!==undefined&&c.colors[key]!==null&&!color(c.colors[key]))throw new Error('设计颜色需要是六位十六进制颜色。');
    if(raw.icon!==undefined&&(typeof raw.icon!=='string'||raw.icon.length>1500000||!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw.icon)))throw new Error('设计图标格式或体积无效。');
    return {name:String(raw.name||'导入的设计').trim().slice(0,80)||'导入的设计',config:normalized,icon:raw.icon||null};
}
export function randomColors(current, locked = new Set(), random = Math.random) {
    const entries=Object.entries(DESIGN_THEMES).filter(([id])=>id!=='inherit'),palette=entries[Math.min(entries.length-1,Math.floor(random()*entries.length))][1];
    return Object.fromEntries(['background','surface','text','muted','accent','border'].map(key=>[key,locked.has(key)&&current[key]?current[key]:palette[key]]));
}
export function createDesignHistory(initial) {
    let states=[normalizeDesign(initial)],index=0;
    const read=()=>structuredClone(states[index]);
    return {read,push(value){const next=normalizeDesign(value);if(JSON.stringify(next)===JSON.stringify(states[index]))return read();states=states.slice(0,index+1);states.push(next);if(states.length>50)states.shift();index=states.length-1;return read();},undo(){index=Math.max(0,index-1);return read();},redo(){index=Math.min(states.length-1,index+1);return read();},get canUndo(){return index>0;},get canRedo(){return index<states.length-1;}};
}
