import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { packFont, unpackFont, PLAIN_FONT_BYTES } from '../card-player/font-transport.js';

test('large bundled KingHwa font is restored byte-for-byte with its original published SHA-256', async () => {
    const original = await readFile(new URL('../assets/fonts/KingHwaOldSong.ttf', import.meta.url));
    const expected = 'f7fef9fc413e9e2343f0bb432c51cca41c44b8fe37f071dc86b050896ae9f9e2';
    assert.equal(createHash('sha256').update(original).digest('hex'), expected);
    assert.ok(original.length > PLAIN_FONT_BYTES);
    const result = await packFont(new Blob([original]));
    assert.equal(result.encoding, 'gzip');
    assert.ok(result.blob.size < original.length);
    const restored = await unpackFont(result.blob, result.originalBytes);
    assert.equal(
        createHash('sha256')
            .update(Buffer.from(await restored.arrayBuffer()))
            .digest('hex'),
        expected,
    );
});

test('small fonts retain the original bytes without changing existing card transport', async () => {
    const font = new Blob(['small original font fixture']);
    const result = await packFont(font);
    assert.equal(result.blob, font);
    assert.equal(result.encoding, '');
    assert.equal(result.originalBytes, font.size);
});

test('corrupt, incorrectly sized and cancelled font archives are rejected', async () => {
    const compressed = await new Response(
        new Blob(['original bytes']).stream().pipeThrough(new CompressionStream('gzip')),
    ).blob();
    await assert.rejects(unpackFont(compressed, 1), /大小/);
    await assert.rejects(unpackFont(new Blob(['not gzip']), 14));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(unpackFont(compressed, 14, controller.signal), { name: 'AbortError' });
});
