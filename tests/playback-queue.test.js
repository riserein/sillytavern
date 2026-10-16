import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackQueue} from '../playback-queue.js';
import {normalizeSettings, createPlaylist, getQueue, addTrackToPlaylist, nextTrackId, deleteTrackFromLibrary} from '../core.js';

const fixture = () => normalizeSettings({tracks:['a','b','c'].map(id=>({id,kind:'local',title:id}))});
test('temporary queue order/removal controls next playback without changing permanent songs or memberships', () => {
    const settings=fixture(), playlist=createPlaylist(settings,'场景','p');
    for(const track of settings.tracks) addTrackToPlaylist(settings,playlist.id,track.id);
    const queue=createPlaybackQueue(id=>getQueue(settings,id));queue.reset('p');
    queue.move('c',-1);queue.remove('b','a');
    assert.deepEqual(queue.tracks().map(track=>track.id),['a','c']);
    assert.equal(nextTrackId(queue.tracks(),'a','list'),'c');
    assert.deepEqual(playlist.trackIds,['a','b','c']);assert.equal(settings.tracks.length,3);
    assert.equal(queue.remove('a','a'),false);
    queue.reset('p');assert.deepEqual(queue.tracks().map(track=>track.id),['a','b','c']);
});
test('queue reconciles imports and global deletion but does not resurrect temporarily removed songs', () => {
    const settings=fixture(),queue=createPlaybackQueue(id=>getQueue(settings,id));queue.reset(null);
    queue.remove('b','a');settings.tracks.push({id:'d',kind:'local',title:'d'});deleteTrackFromLibrary(settings,'c');
    assert.deepEqual(queue.tracks().map(track=>track.id),['a','d']);
    queue.markPlayed('a');assert.equal(queue.hasPlayed('a'),true);assert.equal(queue.hasPlayed('d'),false);
    queue.reset(null);assert.equal(queue.hasPlayed('a'),false);
    assert.deepEqual(queue.tracks().map(track=>track.id),['a','b','d']);
});
test('switching role playlist resets queue edits and old settings retain metadata, bindings, artwork and appearance', () => {
    const raw={...fixture(),theme:'rose',fontPreset:'kinghwa',surface:'matte',playlists:[{id:'p',name:'故事',description:'一段故事',trackIds:['a','c'],characterAvatars:['card.png'],lastTrackId:'c',coverId:'cover:12345678-1234-1234-1234-123456789abc'}]};
    const settings=normalizeSettings(raw),queue=createPlaybackQueue(id=>getQueue(settings,id));queue.reset(null);queue.remove('c','a');queue.reset('p');
    assert.deepEqual(queue.tracks().map(track=>track.id),['a','c']);assert.equal(queue.sourceId,'p');
    assert.deepEqual(settings.playlists,raw.playlists);assert.equal(settings.theme,'rose');assert.equal(settings.fontPreset,'kinghwa');assert.equal(settings.surface,'matte');
    assert.equal(normalizeSettings({...raw,playlists:[{...raw.playlists[0],description:'x'.repeat(500)}]}).playlists[0].description.length,240);
});
