import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compactNativePng, compactNativeResponse } from '../card-player/png-size.js';

const image = await readFile(new URL('../assets/covers/moon.png', import.meta.url));
const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Amber',
        description: '角色设定不变',
        extensions: {
            riserein_card_player: { mode: 'native' },
            tavern_helper: {
                scripts: [{ content: 'selected original font and music bytes', data: { keep: 42 } }],
            },
            unrelated: { preserve: true },
        },
    },
};
function chunk(keyword, value) {
    const data = Buffer.from(keyword + '\0' + Buffer.from(JSON.stringify(value)).toString('base64'));
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    result.write('tEXt', 4);
    data.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
}
const png = (...chunks) =>
    new Blob([image.subarray(0, -12), ...chunks, image.subarray(-12)], { type: 'image/png' });
const bytes = async (blob) => Buffer.from(await blob.arrayBuffer());

test('PNG removes only an identical V3 envelope and retains the exact V2/image/CRC bytes', async () => {
    const v2 = chunk('chara', card),
        v3 = chunk('ccv3', { ...card, spec: 'chara_card_v3', spec_version: '3.0' });
    const original = png(v2, v3),
        expected = png(v2);
    const compact = await compactNativePng(original);
    assert.deepEqual(await bytes(compact), await bytes(expected));
    assert.equal(original.size - compact.size, v3.length);
    assert.equal(await compactNativePng(compact), compact);
});

test('distinct V3 data, other authors, missing metadata and malformed PNGs remain unchanged', async () => {
    const other = structuredClone(card);
    other.data.name = 'Other character';
    const unowned = structuredClone(card);
    delete unowned.data.extensions.riserein_card_player;
    const v3 = (value) => chunk('ccv3', { ...value, spec: 'chara_card_v3', spec_version: '3.0' });
    const inputs = [
        png(chunk('chara', card), v3(other)),
        png(chunk('chara', unowned), v3(unowned)),
        png(v3(card)),
        new Blob([image.subarray(0, 25)]),
        new Blob(['invalid file']),
    ];
    for (const original of inputs) assert.equal(await compactNativePng(original), original);
});

test('ST V3-in-chara duplication is normalized to a valid V2 envelope with its full data and correct CRC', async () => {
    const v3 = { ...card, spec: 'chara_card_v3', spec_version: '3.0' };
    assert.deepEqual(
        await bytes(await compactNativePng(png(chunk('chara', v3), chunk('ccv3', v3)))),
        await bytes(png(chunk('chara', card))),
    );
});

test('large scripts do not overflow the JavaScript argument stack; HTTP download metadata stays valid', async () => {
    const large = structuredClone(card);
    large.data.extensions.tavern_helper.scripts[0].content = 'large original resource '.repeat(30000);
    const duplicate = chunk('ccv3', { ...large, spec: 'chara_card_v3', spec_version: '3.0' });
    const input = png(chunk('chara', large), duplicate);
    const response = await compactNativeResponse(
        new Response(input, {
            headers: {
                'Content-Type': 'image/png',
                'Content-Encoding': 'gzip',
                'Content-Length': String(input.size),
                'Content-Disposition': 'attachment; filename="Amber.png"',
            },
        }),
        'png',
    );
    const output = await response.blob();
    assert.equal(input.size - output.size, duplicate.length);
    assert.equal(response.headers.get('Content-Length'), String(output.size));
    assert.equal(response.headers.get('Content-Encoding'), null);
    assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="Amber.png"');
    const json = new Response('{}');
    assert.equal(await compactNativeResponse(json, 'json'), json);
});
