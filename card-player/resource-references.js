import {designReferences} from '../ui/config.js';
import {sceneAssetReferences} from '../music-scenes.js';
/** Recipient resources can be shared by multiple songs; delete only last references. */
export function unreferencedResourceIds(settings,ids){
 const live=new Set([settings.backgroundId,settings.fontId,...(settings.fonts||[]).map(font=>font.id),...(settings.tracks||[]).flatMap(track=>[track.kind==='local'?track.id:null,track.coverId]),...(settings.playlists||[]).map(list=>list.coverId),...designReferences(settings),...sceneAssetReferences(settings.roleScenes)].filter(Boolean));
 return [...new Set(ids)].filter(id=>!live.has(id));
}
