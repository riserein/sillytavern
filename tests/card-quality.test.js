import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
    analyzePayload,
    assertCapacity,
    payloadLiteral,
    readScriptPayload,
    verifyCardObject,
    verifyCardFile,
    transformCardFile,
    crc32,
} from '../card-player/quality.js';
import { attachPlayerToCard } from '../card-player/export.js';
import { nativeCardScript } from '../card-player/native-export.js';
import { captureProjectResources } from '../card-player/project-store.js';
import { watchRoleLifetime } from '../card-player/lifecycle.js';
const data = (mime, bytes) => `data:${mime};base64,${Buffer.alloc(bytes, 42).toString('base64')}`;
const config = () => ({
    id: 'quality',
    title: '测试',
    tracks: [
        {
            id: 'one',
            title: '一',
            src: data('audio/mpeg', 30),
            cover: data('image/png', 10),
            lyrics: '[00:01]歌词',
        },
    ],
    appearance: {
        image: data('image/png', 20),
        font: data('application/octet-stream', 40),
        fontName: '字体',
    },
});
const make = () => ({
    version: 1,
    runtimeVersion: '1.13.0',
    config: config(),
    ui: {},
    playlist: { cover: data('image/png', 5) },
    assets: { 'assets/covers/moon.png': data('image/png', 6) },
});
const runtime = 'const RisereinNativePlayer={startNativeCharacterPlayer(p){capture(p)}};';
const envelope = () => {
    const payload = make(),
        script = nativeCardScript(payload, runtime, 'owned');
    const card = attachPlayerToCard(
        {
            spec: 'chara_card_v2',
            data: {
                name: '测试角色',
                description: '原有描述',
                extensions: { foreign: 5 },
            },
        },
        script,
        'quality',
    );
    return { payload, script, card };
};
test('capacity includes every audio, image, background, font and extra native asset occurrence', () => {
    const payload = make(),
        report = analyzePayload(payload);
    assert.equal(report.embeddedBytes, 111);
    assert.equal(report.rows.length, 7);
    assert.equal(report.browser, 'not-tested');
    assert.equal(report.tavern, 'not-tested');
    payload.assets.large = data('image/png', 2 * 1024 * 1024 + 1);
    assert.throws(() => assertCapacity(analyzePayload(payload)), /图片超过/);
});
test('extra native artwork pushes a previously valid 30 MiB payload over budget and blocks the entire export', () => {
    const payload = make();
    payload.config.tracks = [0, 1].map((i) => ({
        id: String(i),
        title: 'large',
        src: data('audio/mpeg', 15 * 1024 * 1024 - 10),
    }));
    payload.config.appearance = {};
    payload.playlist.cover = '';
    payload.assets = {};
    assert.equal(analyzePayload(payload).problems.length, 0);
    payload.assets.cover = data('image/png', 21);
    assert.throws(() => assertCapacity(analyzePayload(payload)), /30 MB/);
});
test('length-delimited payload reads executable-looking metadata without evaluating it', () => {
    const payload = make();
    payload.config.tracks[0].lyrics = '/*RSCP_PAYLOAD_V1:8*/ </script> globalThis.hacked=true;';
    const literal = payloadLiteral(payload);
    assert.deepEqual(readScriptPayload(literal), payload);
    let received;
    vm.runInNewContext(nativeCardScript(payload, runtime, 'owned').content, {
        capture: (p) => (received = JSON.parse(JSON.stringify(p))),
    });
    assert.deepEqual(received, payload);
    assert.throws(() => readScriptPayload(literal.slice(0, -2)), /长度/);
    assert.throws(() => readScriptPayload('unrecognized old script'), /旧版/);
});
test('export round-trip detects changed audio/lyrics/cover/background/font/UI and preserves other character fields', () => {
    const { card, script } = envelope();
    const report = verifyCardObject(card, { script, characterData: card.data });
    assert.equal(report.static, 'passed');
    assert.equal(report.tracks, 1);
    assert.equal(report.browser, 'not-tested');
    for (const key of ['lyrics', 'src', 'cover']) {
        const changed = structuredClone(card);
        const payload = make();
        payload.config.tracks[0][key] =
            key === 'lyrics' ? '修改后的歌词' : data(key === 'src' ? 'audio/mpeg' : 'image/png', 12);
        changed.data.extensions.tavern_helper.scripts[0] = nativeCardScript(payload, runtime, 'owned');
        assert.throws(() => verifyCardObject(changed, { script }), /不一致/);
    }
    const changed = structuredClone(card);
    changed.data.description = 'changed';
    assert.throws(() => verifyCardObject(changed, { script, characterData: card.data }), /description/);
    const malformed = make();
    malformed.config.appearance.image = 'blob:missing';
    assert.throws(() => readScriptPayload(payloadLiteral(malformed)), /资源损坏/);
});
test('distribution check rejects missing player records and disabled scripts or parent folders', () => {
    const { card } = envelope();
    const missing = structuredClone(card);
    delete missing.data.extensions.riserein_card_player;
    assert.throws(() => verifyCardObject(missing), /没有随卡播放器记录/);
    const disabled = structuredClone(card);
    disabled.data.extensions.tavern_helper.scripts[0].enabled = false;
    assert.throws(() => verifyCardObject(disabled), /已停用/);
    const nested = structuredClone(card);
    nested.data.extensions.tavern_helper.scripts = [{ type: 'folder', enabled: false, scripts: nested.data.extensions.tavern_helper.scripts }];
    assert.throws(() => verifyCardObject(nested), /已停用/);
    nested.data.extensions.tavern_helper.scripts[0].enabled = true;
    assert.equal(verifyCardObject(nested).static, 'passed');
});
function chunk(card) {
    const value = Buffer.from('chara\0' + Buffer.from(JSON.stringify(card)).toString('base64'));
    const chunk = Buffer.alloc(value.length + 12);
    chunk.writeUInt32BE(value.length);
    chunk.write('tEXt', 4);
    value.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    return chunk;
}
test('generated PNG and JSON reread validates metadata and image CRC, rejects corrupt or truncated exports', async () => {
    const { card, script } = envelope(),
        image = await readFile(new URL('../assets/covers/moon.png', import.meta.url));
    const png = Buffer.concat([image.subarray(0, -12), chunk(card), image.subarray(-12)]);
    for (const [format, blob] of [
        ['png', new Blob([png])],
        ['json', new Blob([JSON.stringify(card)])],
    ])
        assert.equal((await verifyCardFile(blob, format, { script })).static, 'passed');
    const damaged = Buffer.from(png);
    damaged[45] ^= 1;
    await assert.rejects(verifyCardFile(new Blob([damaged]), 'png'), /校验失败/);
    await assert.rejects(verifyCardFile(new Blob([png.subarray(0, -3)]), 'png'), /截断|缺少/);
});
test('draft capture copies local audio, art, background and font without modifying music data; missing bytes preserve old draft', async () => {
    const blob = new Blob(['original']),
        tracks = [{ id: 'audio', kind: 'local', title: '歌', coverId: 'cover' }];
    const before = structuredClone(tracks),
        resources = await captureProjectResources(
            tracks,
            { imageId: 'background', fontId: 'font' },
            async () => blob,
        );
    assert.deepEqual(tracks, before);
    assert.equal(await resources.tracks[0].exportBlob.text(), 'original');
    assert.equal(resources.appearance.imageBlob.size, 8);
    await assert.rejects(
        captureProjectResources(tracks, {}, async () => undefined),
        /未覆盖旧草稿/,
    );
});
test('synchronous exit during lifecycle subscription immediately releases newly registered listener', () => {
    let released = 0,
        disposed = 0;
    const life = watchRoleLifetime(
        {
            roleId: 'a',
            currentRole: () => 'a',
            onScriptExit: (exit) => {
                exit();
                return () => released++;
            },
            onHostExit: () => {
                throw new Error('must not register after exit');
            },
        },
        () => disposed++,
    );
    assert.equal(life.disposed, true);
    assert.equal(released, 1);
    assert.equal(disposed, 1);
    assert.equal(life.subscriptions, 0);
});

test('private Helper export filtering rewrites download bytes only and preserves card/image data', async () => {
    const { card } = envelope();
    card.data.extensions.tavern_helper.variables = { retained: 1 };
    const before = structuredClone(card),
        image = await readFile(new URL('../assets/covers/moon.png', import.meta.url));
    const original = new Blob([image.subarray(0, -12), chunk(card), image.subarray(-12)]);
    const output = await transformCardFile(original, 'png', (value) => {
        value.data.extensions.tavern_helper.variables = {};
        return value;
    });
    assert.deepEqual(card, before);
    const { readCardFile } = await import('../card-player/quality.js');
    assert.deepEqual((await readCardFile(original, 'png')).data.extensions.tavern_helper.variables, {
        retained: 1,
    });
    assert.deepEqual((await readCardFile(output, 'png')).data.extensions.tavern_helper.variables, {});
    assert.deepEqual(
        Buffer.from(await output.arrayBuffer()).subarray(0, image.length - 12),
        image.subarray(0, -12),
    );
});

test('package, extension and carried runtime declare the same maintenance version', async () => {
    const { PLAYER_BUILD, PAYLOAD_FORMAT } = await import('../card-player/quality.js');
    for (const name of ['package.json', 'manifest.json'])
        assert.equal(
            JSON.parse(await readFile(new URL('../' + name, import.meta.url), 'utf8')).version,
            PLAYER_BUILD,
        );
    const { card } = envelope();
    assert.equal(card.data.extensions.riserein_card_player.payloadFormat, PAYLOAD_FORMAT);
});

test('custom launcher bytes are counted and cannot bypass per-icon or combined export limits',()=>{
 const payload=make();payload.config.appearance.launcherIcon=data('image/png',4096);const report=analyzePayload(payload);assert.equal(report.rows.find(row=>row.kind==='launcher-icon').bytes,4096);payload.config.appearance.launcherIcon=data('image/png',1024*1024+1);assert.throws(()=>assertCapacity(analyzePayload(payload)),/1 MiB/);
});
test('static export inspection refuses a malformed launcher instead of silently dropping it',()=>{const payload=make();payload.config.appearance.launcherIcon='blob:missing';assert.throws(()=>readScriptPayload(payloadLiteral(payload)),/悬浮图标资源损坏/);});
test('project resource capture retains offline icon bytes and blocks a missing icon without changing the old draft',async()=>{const blob=new Blob(['image']),resources=await captureProjectResources([],{iconId:'own-icon'},async()=>blob);assert.equal(await resources.appearance.iconBlob.text(),'image');await assert.rejects(captureProjectResources([],{iconId:'missing'},async()=>undefined),/未覆盖旧草稿/);});
