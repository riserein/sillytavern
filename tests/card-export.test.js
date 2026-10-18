import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
    prepareCardPackage,
    attachPlayerToCard,
    buildCardExports,
    blobData,
    audioMime,
} from '../card-player/export.js';
import {
    publicResource,
    portableAudio,
    portableImage,
    normalizeCardConfig,
    MAX_AUDIO_BYTES,
} from '../card-player/config.js';

const local = { id: 'one', kind: 'local', title: '原歌曲', artist: '作者', lyrics: '[00:01]歌词' };
const audio = new Blob(['own generated audio fixture'], { type: 'audio/mpeg' }),
    image = new Blob(['image fixture'], { type: 'image/png' });
const make = (tracks = [local], extra = {}) => ({
    id: 'project:one',
    title: '歌单',
    tracks,
    appearance: { accent: '#b2c3b1', background: '#182220', text: '#e8eee6' },
    ...extra,
});
const resources = {
    getBlob: async (id) => (id === 'one' ? audio : image),
    readFallback: async () => image,
    readPublicImage: async () => image,
    probeAudio: async () => {},
};

test('packaging embeds local bytes and metadata in order without mutating library data', async () => {
    const first = { ...local },
        second = { ...local, id: 'two', title: '第二首', exportBlob: audio };
    const before = structuredClone(first);
    const probes = [];
    const result = await prepareCardPackage(make([second, first]), {
        ...resources,
        probeAudio: async (src) => probes.push(src),
    });
    assert.deepEqual(first, before);
    assert.deepEqual(
        result.config.tracks.map((track) => track.title),
        ['第二首', '原歌曲'],
    );
    assert.equal(result.linkedTracks, 0);
    assert.equal(probes.length, 2);
    assert.equal(
        Buffer.from(result.config.tracks[1].src.split(',')[1], 'base64').toString(),
        'own generated audio fixture',
    );
    assert.equal(result.config.tracks[1].lyrics, local.lyrics);
    assert.match(result.config.tracks[1].cover, /^data:image\/png;base64,/);
});
test('public export URLs reject local, credentialed, unsigned browser references and expiring signed URLs', () => {
    for (const url of [
        'blob:https://host.org/id',
        'file:///c:/a.mp3',
        'http://host.org/a.mp3',
        'https://localhost/a.mp3',
        'https://127.0.0.1/a.mp3',
        'https://10.0.0.1/a.mp3',
        'https://[::1]/a.mp3',
        'https://box.local/a.mp3',
        'https://foo.invalid/a.mp3',
        'https://user:password@host.org/a.mp3',
        'https://host.org/a.mp3?token=secret',
        'https://host.org/a.mp3?X-Amz-Signature=temporary',
        'https://host.org/a.mp3?expires=1',
    ])
        assert.equal(publicResource(url), null, url);
    assert.equal(publicResource('https://cdn.example.org/music.mp3'), 'https://cdn.example.org/music.mp3');
    assert.equal(portableAudio('data:text/html;base64,AA=='), null);
    assert.equal(portableImage('data:image/svg+xml;base64,AA=='), null);
});
test('missing audio, failed decoding and oversize songs fail the whole export rather than losing tracks', async () => {
    await assert.rejects(
        prepareCardPackage(make(), { ...resources, getBlob: async () => undefined }),
        /不在当前浏览器/,
    );
    await assert.rejects(
        prepareCardPackage(make(), {
            ...resources,
            probeAudio: async () => {
                throw new Error('cannot decode');
            },
        }),
        /cannot decode/,
    );
    await assert.rejects(
        prepareCardPackage(
            make([{ ...local, exportBlob: new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/mpeg' }) }]),
            resources,
        ),
        /20 MB/,
    );
    await assert.rejects(prepareCardPackage(make([], {}), resources), /没有歌曲/);
});
test('restricted/dynamic platform sources never export cached playback URLs; manual public replacement is explicit', async () => {
    const track = {
        ...local,
        kind: 'platform',
        platform: 'spotify',
        playback: 'external',
        url: 'https://cdn.example.org/cached.mp3',
    };
    await assert.rejects(prepareCardPackage(make([track]), resources), /不能独立分发播放/);
    const result = await prepareCardPackage(
        make([{ ...track, exportUrl: 'https://cdn.example.org/authorized.mp3' }]),
        resources,
    );
    assert.equal(result.linkedTracks, 1);
    assert.equal(result.config.tracks[0].src, 'https://cdn.example.org/authorized.mp3');
});
test('resource budget includes covers, background and fonts; cancellation never returns a partial package', async () => {
    const controller = new AbortController();
    await assert.rejects(
        prepareCardPackage(make([local]), {
            ...resources,
            signal: controller.signal,
            probeAudio: async () => controller.abort(),
        }),
        { name: 'AbortError' },
    );
    const big = new Blob([new Uint8Array(16 * 1024 * 1024)], { type: 'audio/mpeg' });
    await assert.rejects(
        prepareCardPackage(
            make([
                { ...local, exportBlob: big },
                { ...local, id: 'two', exportBlob: big },
            ]),
            resources,
        ),
        /30 MB/,
    );
    await assert.rejects(
        prepareCardPackage(make([local], { appearance: { imageId: 'missing' } }), {
            ...resources,
            getBlob: async (id) => (id === 'one' ? audio : undefined),
        }),
        /背景图片/,
    );
});
test('V2/V3 JSON attachment preserves other scripts, folders, world books and unknown metadata, replacing only our previous export', () => {
    for (const spec of ['chara_card_v2', 'chara_card_v3']) {
        const other = { type: 'script', id: 'other', content: 'private original script', enabled: false };
        const card = {
            spec,
            spec_version: spec.endsWith('3') ? '3.0' : '2.0',
            data: {
                name: '角色',
                description: '保留原设定',
                character_book: { entries: [{ id: 1, content: '保留世界书' }] },
                extensions: {
                    foreign: { keep: true },
                    tavern_helper: {
                        scripts: [{ type: 'folder', enabled: true, id: 'folder', scripts: [other] }],
                        variables: { keep: 7 },
                    },
                },
            },
        };
        const before = structuredClone(card),
            script = {
                type: 'script',
                id: 'ours',
                info: '由 Riserein 音乐播放器制作。',
                enabled: true,
                content: 'own',
            };
        const exported = attachPlayerToCard(card, script, 'project:one');
        assert.deepEqual(card, before);
        assert.equal(exported.data.description, '保留原设定');
        assert.deepEqual(exported.data.character_book, card.data.character_book);
        assert.deepEqual(exported.data.extensions.foreign, { keep: true });
        assert.deepEqual(exported.data.extensions.tavern_helper.variables, { keep: 7 });
        assert.deepEqual(exported.data.extensions.tavern_helper.scripts[0].scripts, [other]);
        const again = attachPlayerToCard(exported, { ...script, id: 'new' }, 'project:two');
        assert.equal(again.data.extensions.tavern_helper.scripts.length, 2);
        assert.equal(again.data.extensions.tavern_helper.scripts[1].id, 'new');
    }
    assert.throws(() => attachPlayerToCard({ name: 'chat' }, {}, 'p'), /角色卡 JSON/);
});
test('generated JS and preview safely serialize lyrics/titles containing closing script tags without executing them', async () => {
    const evil = '</script><script>globalThis.executed=true</script>\u2028';
    const config = (await prepareCardPackage(make([{ ...local, title: evil, lyrics: evil }]), resources)).config;
    const runtime =
        'var RisereinCardPlayer={startCharacterPlayer(c){globalThis.received=c;},startPreview(c){globalThis.received=c;}};';
    const files = buildCardExports(config, runtime, 'script-id');
    const sandbox = {};
    vm.runInNewContext(files.javascript, sandbox);
    assert.equal(sandbox.received.tracks[0].title, evil);
    assert.equal(sandbox.executed, undefined);
    assert.equal((files.preview.match(/<script>/g) || []).length, 1);
    assert.equal(files.script.enabled, true);
    assert.equal(files.script.content, files.javascript);
    assert.deepEqual(files.script.export_with, { data: true, button: true });
    assert.equal(files.songs.tracks[0].resource, 'embedded audio bytes');
});
test('portable runtime rejects invalid media configuration and validates appearance instead of interpolating arbitrary CSS', async () => {
    const src = await blobData(audio);
    const config = normalizeCardConfig({
        id: 'valid',
        tracks: [{ id: 'a', src }],
        appearance: { accent: 'red;position:fixed', fontFamily: 'url(https://bad.example/a)', image: 'blob:somewhere' },
    });
    assert.equal(config.appearance.accent, '#b2c3b1');
    assert.equal(config.appearance.image, '');
    assert.equal(config.appearance.fontFamily, 'system-ui, sans-serif');
    assert.throws(() => normalizeCardConfig({ id: 'p', tracks: [{ src: 'blob:old-local-file' }] }), /音源/);
});
test('font bytes and their license travel together, while an unspecified custom license blocks export', async () => {
    const font = new Blob(['font fixture'], { type: 'font/woff2' });
    const result = await prepareCardPackage(
        make([local], { appearance: { fontFile: 'known.woff2', fontName: '字形' } }),
        { ...resources, readFont: async () => font, readFontLicense: async () => 'Copyright Example; OFL 1.1' },
    );
    assert.match(result.config.appearance.font, /^data:application\/octet-stream;base64,/);
    assert.equal(result.config.appearance.fontLicense, 'Copyright Example; OFL 1.1');
    await assert.rejects(
        prepareCardPackage(make([local], { appearance: { fontId: 'own-font' } }), {
            ...resources,
            getBlob: async (id) => (id === 'one' ? audio : font),
        }),
        /字体的授权/,
    );
});

test('older imported M4A/OGG MIME aliases and empty MIME files keep their usable portable formats', async () => {
    assert.equal(audioMime(new Blob(['m4a'], { type: 'audio/x-m4a' })), 'audio/mp4');
    assert.equal(audioMime(new Blob(['ogg'], { type: 'application/ogg' })), 'audio/ogg');
    const file = new File(['audio fixture'], 'original.mp3', { type: '' });
    const result = await prepareCardPackage(make([{ ...local, title: '只有显示歌名', exportBlob: file }]), resources);
    assert.match(result.config.tracks[0].src, /^data:audio\/mpeg;base64,/);
});

test('shared designer exports retain known Helper format and selected UI without IDB image dependencies',async()=>{
 const {buildSharedCardExports}=await import('../card-player/shared-export.js'),{readScriptPayload}=await import('../card-player/quality.js');
 const input=(await prepareCardPackage(make(),resources)).config;
 const design={layout:'cassette',fontPreset:'song',launcher:'custom',customization:{iconId:'cover:00000000-0000-4000-8000-000000000000'}};
 input.appearance.launcherIcon='data:image/png;base64,aW1hZ2U=';
 const files=buildSharedCardExports(input,'const RisereinNativePlayer={startNativeCharacterPlayer(){},startNativePreview(){}};','script-id',{design,ui:{fontPreset:'song'}}),payload=readScriptPayload(files.script.content);
 assert.equal(files.script.type,'script');assert.equal(files.script.enabled,true);assert.equal(files.script.export_with.data,true);assert.equal(payload.ui.uiDesign.layout,'cassette');assert.equal(payload.ui.uiDesign.customization.iconId,null);assert.equal(payload.config.appearance.launcherIcon,input.appearance.launcherIcon);assert(files.preview.includes('startNativePreview'));assert(!files.javascript.includes('indexedDB.open'));assert.equal(files.analysis.rows.find(row=>row.kind==='launcher-icon').bytes,5);
 assert.deepEqual(files.songs.design,payload.ui.uiDesign);assert.equal(files.songs.tracks.length,1);assert.throws(()=>buildSharedCardExports(input,'startNativeCharacterPlayer','id',{design}),/共享预览/);
});
