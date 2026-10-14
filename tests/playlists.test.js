import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeSettings, getQueue, createPlaylist, renamePlaylist, addTrackToPlaylist,
    removeTrackFromPlaylist, deleteTrackFromLibrary, deletePlaylist, bindPlaylistCharacters,
    playlistForCharacter, currentCharacterAvatar,
} from '../core.js';

const tracks = ['a', 'b', 'c'].map(id => ({ id, title: id, kind: 'local' }));

test('legacy libraries retain all audio IDs and selected songs when migrating', () => {
    const settings = normalizeSettings({ tracks, currentId: 'b', theme: 'rose', volume: 0.2 });
    assert.deepEqual(settings.tracks, tracks);
    assert.deepEqual(settings.playlists, []);
    assert.equal(settings.activePlaylistId, null);
    assert.equal(settings.currentId, 'b');
    assert.equal(settings.theme, 'rose');
    assert.equal(settings.volume, 0.2);
});

test('a song can belong to multiple playlists with a single library entry', () => {
    const settings = normalizeSettings({ tracks });
    const first = createPlaylist(settings, '雨夜', 'first');
    const second = createPlaylist(settings, '旅途', 'second');
    assert.equal(addTrackToPlaylist(settings, first.id, 'b'), true);
    assert.equal(addTrackToPlaylist(settings, first.id, 'b'), false);
    addTrackToPlaylist(settings, second.id, 'b');
    assert.equal(settings.tracks.length, 3);
    assert.deepEqual(getQueue(settings, first.id), [tracks[1]]);
    assert.deepEqual(getQueue(settings, second.id), [tracks[1]]);
});

test('playlists use their own song order and never advance through unrelated library songs', () => {
    const settings = normalizeSettings({ tracks });
    const playlist = createPlaylist(settings, '顺序', 'p');
    addTrackToPlaylist(settings, playlist.id, 'c');
    addTrackToPlaylist(settings, playlist.id, 'a');
    settings.activePlaylistId = playlist.id;
    assert.deepEqual(getQueue(settings).map(track => track.id), ['c', 'a']);
});

test('removing a playlist or its membership preserves the source library', () => {
    const settings = normalizeSettings({ tracks, currentId: 'a' });
    const playlist = createPlaylist(settings, '保留文件', 'p');
    addTrackToPlaylist(settings, playlist.id, 'a');
    removeTrackFromPlaylist(settings, playlist.id, 'a');
    assert.deepEqual(settings.tracks, tracks);
    addTrackToPlaylist(settings, playlist.id, 'a');
    settings.activePlaylistId = playlist.id;
    deletePlaylist(settings, playlist.id);
    assert.deepEqual(settings.tracks, tracks);
    assert.equal(settings.activePlaylistId, null);
    assert.equal(settings.currentId, 'a');
});

test('deleting a library song removes all memberships and stale selected references', () => {
    const settings = normalizeSettings({ tracks, currentId: 'b' });
    for (const id of ['p', 'q']) {
        const playlist = createPlaylist(settings, id, id);
        addTrackToPlaylist(settings, playlist.id, 'b');
        addTrackToPlaylist(settings, playlist.id, 'c');
    }
    deleteTrackFromLibrary(settings, 'b');
    assert.deepEqual(settings.tracks.map(track => track.id), ['a', 'c']);
    assert.equal(settings.currentId, null);
    for (const playlist of settings.playlists) {
        assert.deepEqual(playlist.trackIds, ['c']);
        assert.equal(playlist.lastTrackId, 'c');
    }
});

test('binding multiple cards is stable when card array indexes change, and rebinding transfers ownership', () => {
    const settings = normalizeSettings({ tracks });
    const first = createPlaylist(settings, '多个角色', 'p');
    const second = createPlaylist(settings, '另一个场景', 'q');
    bindPlaylistCharacters(settings, first.id, ['Alice.png', 'Bob.png']);
    assert.equal(playlistForCharacter(settings, 'Alice.png').id, first.id);
    assert.equal(playlistForCharacter(settings, 'Bob.png').id, first.id);
    assert.equal(currentCharacterAvatar({ characterId: '1', characters: [{ avatar: 'Bob.png' }, { avatar: 'Alice.png' }] }), 'Alice.png');
    bindPlaylistCharacters(settings, second.id, ['Alice.png']);
    assert.deepEqual(first.characterAvatars, ['Bob.png']);
    assert.equal(playlistForCharacter(settings, 'Alice.png').id, second.id);
    assert.equal(playlistForCharacter(settings, 'Bob.png').id, first.id);
    assert.equal(currentCharacterAvatar({ characters: tracks }), null);
    assert.equal(currentCharacterAvatar({ characterId: 0, groupId: 0, characters: [{ avatar: 'Alice.png' }] }), null);
});

test('restoration drops dangling song IDs, duplicate albums and conflicting bindings', () => {
    const settings = normalizeSettings({ tracks, activePlaylistId: 'p', currentId: 'b', playlists: [
        { id: 'p', name: '歌单', trackIds: ['c', 'missing', 'c'], characterAvatars: ['Alice.png'] },
        { id: 'p', name: '重复', trackIds: ['a'] },
        { id: 'q', trackIds: ['a'], characterAvatars: ['Alice.png', 'Bob.png'] },
    ] });
    assert.equal(settings.playlists.length, 2);
    assert.deepEqual(settings.playlists[0].trackIds, ['c']);
    assert.deepEqual(settings.playlists[1].characterAvatars, ['Bob.png']);
    assert.equal(settings.currentId, 'c');
    const empty = normalizeSettings({ tracks, playlists: [{ id: 'empty', trackIds: [] }], activePlaylistId: 'empty', currentId: 'a' });
    assert.equal(empty.currentId, null);
    assert.deepEqual(getQueue(empty), []);
});

test('playlist names reject empty, duplicate and reserved names while preserving rename contents', () => {
    const settings = normalizeSettings({ tracks });
    const playlist = createPlaylist(settings, '  第一张  ', 'p');
    addTrackToPlaylist(settings, playlist.id, 'a');
    assert.throws(() => createPlaylist(settings, '第一张'));
    assert.throws(() => createPlaylist(settings, '   '));
    assert.throws(() => createPlaylist(settings, '总曲库'));
    renamePlaylist(settings, playlist.id, '新名字');
    assert.equal(playlist.name, '新名字');
    assert.deepEqual(playlist.trackIds, ['a']);
});
