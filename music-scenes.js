import {normalizeSceneAmbient} from './ambient.js';
import { DESIGN_THEMES } from './ui/config.js';

export const MAX_SCENES = 12;
export const MAX_SCENE_ROLES = 200;
export const MAX_SCENE_TRACKS = 200;
export const MAX_SCENE_DESCRIPTION = 300;
export const MAX_TRACK_NOTE = 500;
export const textLength = value => Array.from(String(value ?? '')).length;
const text = (value, max) => Array.from(typeof value === 'string' ? value : '').slice(0, max).join('');
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value);
const asset = (value, type) => typeof value === 'string' && new RegExp('^' + type + ':[a-f0-9-]{36}$').test(value) ? value : null;

/** Metadata only. Missing references stay visible as draft errors, never silently
 * removed to make an incomplete scene look exportable. Role keys are avatars. */
export function normalizeSceneSet(raw = {}) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const ids = new Set(), scenes = [];
    for (const row of Array.isArray(raw.scenes) ? raw.scenes : []) {
        if (!row || !identifier(row.id) || ids.has(row.id)) continue;
        ids.add(row.id);
        scenes.push({
            id: row.id, name: text(row.name, 80).trim() || '新场景',
            description: text(row.description, MAX_SCENE_DESCRIPTION),
            trackIds: [...new Set(Array.isArray(row.trackIds) ? row.trackIds.filter(identifier) : [])].slice(0, MAX_SCENE_TRACKS),
            coverId: asset(row.coverId, 'cover'), backgroundId: asset(row.backgroundId, 'background'),
            themeId: Object.hasOwn(DESIGN_THEMES, row.themeId) ? row.themeId : 'inherit',
            ...(row.ambient&&typeof row.ambient==='object'?{ambient:normalizeSceneAmbient(row.ambient)}:{}),
            included: row.included !== false, order: scenes.length,
        });
        if (scenes.length === MAX_SCENES) break;
    }
    const noteIds = new Set(), notes = [];
    for (const note of Array.isArray(raw.notes) ? raw.notes : []) {
        if (!note || !identifier(note.trackId) || noteIds.has(note.trackId) || typeof note.text !== 'string') continue;
        noteIds.add(note.trackId); const value = text(note.text, MAX_TRACK_NOTE);
        if (value.trim()) notes.push({ trackId: note.trackId, text: value });
        if (notes.length === MAX_SCENE_TRACKS) break;
    }
    return { version: 1, defaultSceneId: scenes.some(s => s.id === raw.defaultSceneId) ? raw.defaultSceneId : scenes[0]?.id || null,
        scenes, notes, showNotes: raw.showNotes !== false, keepCurrent: raw.keepCurrent !== false };
}

export function normalizeRoleScenes(rows) {
    const avatars = new Set(), groups = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || !identifier(row.avatar) || avatars.has(row.avatar)) continue;
        avatars.add(row.avatar); groups.push({ avatar: row.avatar, ...normalizeSceneSet(row) });
        if (groups.length === MAX_SCENE_ROLES) break;
    }
    return groups;
}

export function normalizeScenePreferences(rows) {
    const seen = new Set(), result = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || !identifier(row.avatar) || !identifier(row.sceneId) || seen.has(row.avatar)) continue;
        seen.add(row.avatar); result.push({ avatar: row.avatar, sceneId: row.sceneId });
        if (result.length === MAX_SCENE_ROLES) break;
    }
    return result;
}

export function sceneIssues(scene, tracks, ambientLibrary) {
    const known = new Map(tracks.map(t => [t.id, t])), errors = [];
    if (!scene?.trackIds?.length) errors.push('尚未选择歌曲');
    for (const id of scene?.trackIds || []) {
        const track = known.get(id);
        if (!track) errors.push('缺少歌曲：' + id);
        else if (track.kind === 'platform' && !['full', 'preview'].includes(track.playback)) errors.push('歌曲仅为来源记录，不能直接播放：' + track.title);
    }
    if(scene?.ambient?.id&&ambientLibrary&&!ambientLibrary.some(r=>r.id===scene.ambient.id))errors.push('缺少环境音：'+scene.ambient.id);
    return errors;
}

export function roleSceneGroup(settings, avatar) {
    return avatar ? (settings.roleScenes || []).find(g => g.avatar === avatar) || null : null;
}

/** A draft never suppresses the legacy bound playlist. Selection is role-scoped
 * and personal choice wins only while its target is still a valid scene. */
export function selectedScene(settings, avatar, tracks) {
    const group = roleSceneGroup(settings, avatar);
    if (!group) return null;
    const valid = group.scenes.filter(s => !sceneIssues(s, tracks, settings.ambientLibrary||[]).length);
    const remembered = (settings.scenePreferences || []).find(p => p.avatar === avatar)?.sceneId;
    return valid.find(s => s.id === remembered) || valid.find(s => s.id === group.defaultSceneId) || valid[0] || null;
}

export function saveRoleScenes(settings, avatar, value) {
    if (!identifier(avatar)) throw new Error('请选择一个有效的单人角色。');
    if (!Array.isArray(value?.scenes) || value.scenes.length > MAX_SCENES) throw new Error('每个角色最多 12 个音乐场景。');
    const ids = new Set();
    for (const scene of value.scenes) {
        if (!identifier(scene.id) || ids.has(scene.id)) throw new Error('场景标识缺失或重复。');
        ids.add(scene.id);
        if (!scene.name?.trim() || textLength(scene.name) > 80) throw new Error('场景名称需要 1 至 80 字。');
        if (textLength(scene.description) > MAX_SCENE_DESCRIPTION) throw new Error('场景介绍最多 300 字。');
        if (!Array.isArray(scene.trackIds) || scene.trackIds.length > MAX_SCENE_TRACKS) throw new Error('场景最多引用 200 首歌曲。');
    }
    if ((value.notes || []).length > MAX_SCENE_TRACKS) throw new Error('每个角色最多保存 200 首歌曲手记。');
    for (const note of value.notes || []) if (textLength(note.text) > MAX_TRACK_NOTE) throw new Error('歌曲手记最多 500 字。');
    const groups = settings.roleScenes ||= [], existing = groups.find(g => g.avatar === avatar);
    if (!existing && groups.length >= MAX_SCENE_ROLES) throw new Error('角色场景配置已达 200 个，请先备份并整理。');
    const next = { avatar, ...normalizeSceneSet(value) };
    if (existing) groups.splice(groups.indexOf(existing), 1, next); else groups.push(next);
    return next;
}

export function rememberScene(settings, avatar, sceneId, tracks) {
    const group = roleSceneGroup(settings, avatar), scene = group?.scenes.find(s => s.id === sceneId);
    if (!scene || sceneIssues(scene, tracks, settings.ambientLibrary||[]).length) throw new Error('这个场景尚未完成，请先检查歌曲资源。');
    const rows = settings.scenePreferences ||= [], old = rows.find(r => r.avatar === avatar);
    if (old) old.sceneId = sceneId; else rows.push({ avatar, sceneId });
    return scene;
}

export function sceneAssetReferences(groups = []) {
    const refs = new Set();
    for (const group of groups) for (const scene of group.scenes || []) {
        if (scene.coverId) refs.add(scene.coverId);
        if (scene.backgroundId) { refs.add(scene.backgroundId); refs.add(scene.backgroundId + ':original'); }
    }
    return refs;
}

export function sceneNote(group, trackId) {
    return group?.showNotes !== false ? group?.notes?.find(n => n.trackId === trackId)?.text || '' : '';
}

/** Export is an explicit selection, not a partial success. Shared song IDs are
 * resolved once in first-scene order; author arrays and bytes remain untouched. */
export function sceneSelection(group, tracks) {
    if(!group?.scenes?.length)return {tracks,sceneSet:null};
    const checked=saveRoleScenes({roleScenes:[]},'export',group),scenes=checked.scenes.filter(s=>s.included);
    if(!scenes.length)throw new Error('没有选择随卡导出的音乐场景，请至少勾选一个；未改用其他歌曲分发。');
    if(!scenes.some(s=>s.id===checked.defaultSceneId))throw new Error('默认场景未选择随卡导出，请先调整默认场景。');
    for(const scene of scenes){const issues=sceneIssues(scene,tracks);if(issues.length)throw new Error('场景「'+scene.name+'」尚未完成：'+issues.join('；'));}
    const ids=[...new Set(scenes.flatMap(s=>s.trackIds))],byId=new Map(tracks.map(t=>[t.id,t]));
    if(ids.length>MAX_SCENE_TRACKS)throw new Error('所选场景共引用超过 200 首不同歌曲，请拆分场景；没有舍弃歌曲。');
    return {tracks:ids.map(id=>byId.get(id)),sceneSet:normalizeSceneSet({...checked,scenes,notes:checked.notes.filter(n=>ids.includes(n.trackId))})};
}

export function remapSceneSet(value, { trackId = id => id, assetId = id => id, sceneId = id => id, ambientId = id => id } = {}) {
    const copy = normalizeSceneSet(value), ids = new Map(copy.scenes.map(s => [s.id, sceneId(s.id)]));
    copy.defaultSceneId = ids.get(copy.defaultSceneId) || null;
    copy.scenes = copy.scenes.map(s => ({ ...s,...(s.ambient?{ambient:{...s.ambient,id:s.ambient.id?ambientId(s.ambient.id):null}}:{}), id: ids.get(s.id), trackIds: s.trackIds.map(trackId), coverId: s.coverId ? assetId(s.coverId) : null, backgroundId: s.backgroundId ? assetId(s.backgroundId) : null }));
    copy.notes = copy.notes.map(n => ({ ...n, trackId: trackId(n.trackId) }));
    return copy;
}
