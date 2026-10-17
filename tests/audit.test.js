import test from 'node:test';
import assert from 'node:assert/strict';
import { base64Bytes } from '../base64.js';
import { createAssetRetirement, referencedAssets } from '../asset-retirement.js';
import { fetchBlob } from '../card-player/browser-resources.js';
import { verifyCardObject, payloadLiteral } from '../card-player/quality.js';
import { createNativeCardExport } from '../card-player/native-export.js';

test('chunked Base64 decoding preserves bytes across boundaries and rejects malformed input', () => {
    for (const size of [0, 1, 2, 3, 49151, 49152, 49153, 131073]) {
        const bytes = Buffer.alloc(size);
        for (let i = 0; i < size; i++) bytes[i] = i % 251;
        assert.deepEqual(Buffer.from(base64Bytes(bytes.toString('base64'))), bytes);
    }
    assert.deepEqual([...base64Bytes(' YW\nJj\t ')], [97, 98, 99]);
    for (const text of ['A', '***=', 'a=b=', '====']) assert.throws(() => base64Bytes(text));
    assert.throws(() => base64Bytes('A'.repeat(65532) + 'YQ==YQ=='));
});

const state = () => ({ tracks: [{ id: 'audio', kind: 'local', coverId: 'new' }], playlists: [], fonts: [], backgroundId: null });
function retirementFixture() {
    const settings = state(), deleted = [], calls = [];
    const host = { location: new URL('https://tavern.example.org/'), fetch: async () => new Response('{"result":"ok"}') };
    const api = createAssetRetirement({ host, settings, store: { deleteMany: async ids => deleted.push(...ids) }, scheduleSave: () => calls.push('save') });
    const save = async (value = settings, gzip = false) => {
        const json = JSON.stringify({ extension_settings: { riserein_music_player: value } });
        const body = gzip ? await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob() : json;
        return host.fetch('/api/settings/save', { method: 'POST', body, headers: gzip ? { 'Content-Encoding': 'gzip' } : {} });
    };
    return { api, settings, host, deleted, calls, save };
}
test('retirement retains server-referenced and live assets, handles gzip and only cleans acknowledged metadata', async () => {
    const f = retirementFixture();
    f.api.retire(['old', 'audio', 'new']);
    await f.save({ ...f.settings, tracks: [{ id: 'audio', kind: 'local', coverId: 'old' }] });
    assert.deepEqual(f.deleted, []);
    await f.save(f.settings, true);
    assert.deepEqual(f.deleted, ['old']);
    assert.equal(f.api.pendingCount, 2);
    assert(referencedAssets({ ...state(), backgroundId: 'background:x', fonts: [{ id: 'font:x' }] }).has('background:x:original'));
    f.api.dispose();
});
test('failed, malformed and cross-origin saves never authorize deleting prior bytes', async () => {
    for (const status of [403, 500]) {
        const deleted = [], settings = state();
        const host = { location: new URL('https://tavern.example.org/'), fetch: async () => new Response('{}', { status }) };
        const api = createAssetRetirement({ host, settings, store: { deleteMany: async ids => deleted.push(...ids) }, scheduleSave() {} });
        api.retire(['old']);
        await host.fetch('/api/settings/save', { method: 'POST', body: JSON.stringify({ extension_settings: { riserein_music_player: settings } }) });
        assert.deepEqual(deleted, []);
        assert.equal(api.pendingCount, 1);
        api.dispose();
    }
    const f = retirementFixture();
    f.api.retire(['old']);
    await f.host.fetch('https://other.example.org/api/settings/save', { method: 'POST', body: '{}' });
    await f.host.fetch('/api/settings/save', { method: 'POST', body: '{}' });
    await f.host.fetch('/api/settings/save', { method: 'POST', body: 'invalid-json' });
    assert.deepEqual(f.deleted, []);
    f.api.dispose();
});
test('overlapping saves require a fresh isolated acknowledgement; cleanup failure retains bytes for retry', async () => {
    const replies = [], deleted = [], settings = state();
    let retries = 0, fail = true;
    const host = { location: new URL('https://tavern.example.org/'), fetch: () => new Promise(resolve => replies.push(resolve)) };
    const api = createAssetRetirement({ host, settings, scheduleSave: () => retries++, store: { deleteMany: async ids => { if (fail) throw new Error('storage denied'); deleted.push(...ids); } } });
    api.retire(['old']);
    const request = () => host.fetch('/api/settings/save', { method: 'POST', body: JSON.stringify({ extension_settings: { riserein_music_player: settings } }) });
    const a = request(), b = request();
    replies[1](new Response('{"result":"ok"}')); await b;
    replies[0](new Response('{"result":"ok"}')); await a;
    assert.equal(deleted.length, 0);
    assert(retries > 1);
    const c = request(); replies[2](new Response('{"result":"ok"}')); await c;
    assert.equal(api.pendingCount, 1);
    fail = false;
    const d = request(); replies[3](new Response('{"result":"ok"}')); await d;
    assert.deepEqual(deleted, ['old']);
    api.dispose();
});
test('HTTP 200 error/HTML responses do not authorize deletion without ST result=ok acknowledgement', async () => {
    for (const body of ['{}', '{"error":"disk full"}', '<html>login</html>']) {
        const settings = state(), deleted = [];
        let unconfirmed = 0;
        const host = { location: new URL('https://tavern.example.org/'), fetch: async () => new Response(body) };
        const api = createAssetRetirement({ host, settings, store: { deleteMany: async ids => deleted.push(...ids) }, scheduleSave() {}, onUnconfirmed() { unconfirmed++; } });
        api.retire(['old']);
        await host.fetch('/api/settings/save', { method: 'POST', body: JSON.stringify({ extension_settings: { riserein_music_player: settings } }) });
        assert.deepEqual(deleted, []);
        assert.equal(api.pendingCount, 1);
        assert.equal(unconfirmed, 1);
        api.dispose();
    }
});
test('disposal preserves another extension fetch wrapper and a retained retired wrapper only forwards', async () => {
    const f = retirementFixture();
    const wrapped = f.host.fetch;
    const outer = (...args) => wrapped(...args);
    f.host.fetch = outer;
    f.api.dispose();
    f.api.retire(['old']);
    assert.equal(f.host.fetch, outer);
    assert.equal((await f.host.fetch('/api/settings/save', { method: 'POST', body: '{}' })).ok, true);
    assert.deepEqual(f.deleted, []);
    assert.equal(f.api.pendingCount, 0);
});
test('static card verification rejects a script larger than 45 MiB instead of overriding its failed status', () => {
    const config = { id: 'audit', title: 'size', tracks: [{ id: 'a', title: 'a', src: 'https://audio.example.org/a.mp3', cover: '' }], appearance: {} };
    const content = payloadLiteral({ config }) + ' '.repeat(46 * 1024 * 1024);
    const card = { spec: 'chara_card_v2', data: { name: 'Audit', extensions: { riserein_card_player: { scriptId: 'owned', projectId: 'audit' }, tavern_helper: { scripts: [{ id: 'owned', type: 'script', enabled: true, content }] } } } };
    assert.throws(() => verifyCardObject(card), /45 MB/);
});
test('bounded resource reads stop and cancel streams with missing or oversized Content-Length', async () => {
    const original = globalThis.fetch;
    let cancelled = 0, chunks = 0;
    try {
        globalThis.fetch = async () => new Response(new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled++; } }));
        await assert.rejects(fetchBlob('https://image.example.org/a', undefined, { maxBytes: 2048 }), /超过/);
        assert.equal(cancelled, 1);
        assert(chunks <= 4);
        globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'Content-Length': '4096' } });
        await assert.rejects(fetchBlob('https://image.example.org/a', undefined, { maxBytes: 2048 }), /超过/);
        assert.equal(cancelled, 2);
        globalThis.fetch = async () => new Response('abc', { headers: { 'Content-Type': 'image/png' } });
        assert.equal(await (await fetchBlob('https://image.example.org/a', undefined, { maxBytes: 3 })).text(), 'abc');
    } finally { globalThis.fetch = original; }
});
test('unbinding a card still succeeds after its Helper extension data has been removed', async () => {
    const previous = { window: globalThis.window, location: globalThis.location };
    const writes = [];
    const character = { avatar: 'audit.png', name: 'Audit', data: { name: 'Audit', extensions: { riserein_card_player: { version: 1, mode: 'native', scriptId: 'owned' } } } };
    const context = { characterId: 0, characters: [character], getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) };
    globalThis.window = { fetch: async (url, init) => { writes.push(JSON.parse(init.body)); return new Response('{"result":"ok"}'); } };
    globalThis.location = new URL('https://tavern.example.org/');
    const settings = { playlists: [{ characterAvatars: ['audit.png'] }] };
    const api = createNativeCardExport({ settings, store: {}, getContext: () => context, showStatus() {} });
    settings.playlists = []; // Explicitly remove a previously local binding, not an imported card.
    try {
        await api.syncBindings();
        assert.equal(writes.length, 1);
        assert.equal(character.data.extensions.riserein_card_player, null);
        assert.deepEqual(character.data.extensions.tavern_helper.scripts, []);
    } finally {
        api.dispose();
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
});
test('binding sync and exporting an unbound imported legacy player preserve its original script', async () => {
    const previous = { window: globalThis.window, location: globalThis.location };
    const character = { avatar: 'foreign.png', name: 'Imported', data: { name: 'Imported', extensions: { riserein_card_player: { version: 1, mode: 'native', scriptId: 'foreign', projectId: 'foreign-project' }, tavern_helper: { scripts: [{ type: 'script', enabled: true, id: 'foreign', content: '/* original legacy player */', info: '由 Riserein 音乐播放器制作。' }] } } } };
    const before = structuredClone(character);
    const context = { characterId: 0, characters: [character], getRequestHeaders: () => ({}) };
    const requests = [];
    globalThis.window = { fetch: async url => { requests.push(String(url)); return new Response(JSON.stringify({ spec: 'chara_card_v2', data: character.data })); } };
    globalThis.location = new URL('https://tavern.example.org/');
    const api = createNativeCardExport({ settings: { playlists: [] }, store: {}, getContext: () => context, showStatus() {} });
    try {
        await api.syncBindings();
        assert.deepEqual(requests, []);
        const response = await window.fetch('/api/characters/export', { method: 'POST', body: JSON.stringify({ avatar_url: 'foreign.png', format: 'json' }) });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data, before.data);
        assert.deepEqual(character, before);
        assert.deepEqual(requests, ['/api/characters/export']);
        assert.equal(api.lastReport.static, 'not-verified');
    } finally {
        api.dispose();
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
});
test('a disposed native exporter retained by another fetch wrapper no longer intercepts exports', async () => {
    const previous = { window: globalThis.window, location: globalThis.location };
    let forwarded = 0;
    const context = { characters: [{ avatar: 'a.png', data: { extensions: { riserein_card_player: { mode: 'native' } } } }] };
    globalThis.window = { fetch: async () => { forwarded++; return new Response('original export'); } };
    globalThis.location = new URL('https://tavern.example.org/');
    const api = createNativeCardExport({ settings: { playlists: [] }, store: {}, getContext: () => context, showStatus() {} });
    const retained = window.fetch;
    window.fetch = (...args) => retained(...args);
    try {
        api.dispose();
        const response = await window.fetch('/api/characters/export', { method: 'POST', body: JSON.stringify({ avatar_url: 'a.png', format: 'json' }) });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'original export');
        assert.equal(forwarded, 1);
    } finally {
        api.dispose();
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
});

test('native export hook forwards cross-origin and non-POST requests untouched', async () => {
    const previous = { window: globalThis.window, location: globalThis.location };
    const calls = [];
    globalThis.location = new URL('https://tavern.example.org/');
    globalThis.window = { fetch: async (...args) => { calls.push(args); return new Response('original'); } };
    const api = createNativeCardExport({ settings: { playlists: [] }, store: {}, getContext() { throw new Error('must not inspect context'); }, showStatus() {} });
    try {
        for (const [url, init] of [['https://other.example/api/characters/export', {method:'POST', body:'{}'}], ['/api/characters/export', {method:'GET'}]]) {
            assert.equal(await (await window.fetch(url, init)).text(), 'original');
            assert.equal(calls.at(-1)[0], url);
            assert.equal(calls.at(-1)[1], init);
        }
    } finally {
        api.dispose();
        for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
});

test('platform JSON responses cancel oversized streams and do not cache partial data', async () => {
    const { createMusicRequest } = await import('../platforms/request.js');
    let cancelled = 0, calls = 0;
    const request = createMusicRequest({maxBytes:128,fetcher:async()=>{
        calls++;
        return calls === 1 ? new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(100));},cancel(){cancelled++;}})) : Response.json({ok:true});
    }});
    await assert.rejects(request('https://source.example/music'), error => error.code === 'RESPONSE' && error.message.includes('过大'));
    assert.equal(cancelled,1);
    assert.deepEqual(await request('https://source.example/music'),{ok:true});
    assert.equal(calls,2);
});

test('platform cancellation and timeout interrupt a stalled response body', async () => {
    const { createMusicRequest } = await import('../platforms/request.js');
    for (const cancel of [false,true]) {
        let stopped = 0;
        const controller = new AbortController();
        const request = createMusicRequest({timeout:15,fetcher:async()=>new Response(new ReadableStream({cancel(){stopped++;}}))});
        const pending = request('https://source.example/music',{signal:controller.signal});
        if(cancel) setTimeout(()=>controller.abort(),2);
        await assert.rejects(pending,error=>cancel ? error.name==='AbortError' : error.code==='TIMEOUT');
        assert.equal(stopped,1);
    }
});
