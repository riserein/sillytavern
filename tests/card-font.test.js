import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { packFont, unpackFont, PLAIN_FONT_BYTES } from '../card-player/font-transport.js';
import { FONT_PRESETS } from '../fonts.js';

test('only the two compact declared fonts ship, match their source hashes and stay below 5 MiB', async () => {
    const directory = new URL('../assets/fonts/', import.meta.url);
    const files = (await readdir(directory)).filter((name) => /\.(?:ttf|otf|woff2?)$/.test(name)).sort();
    const declared = Object.values(FONT_PRESETS)
        .filter((font) => font.file)
        .map((font) => font.file)
        .sort();
    assert.deepEqual(files, ['ChildFunSans.woff2', 'PoxiaoPixel.woff2']);
    assert.deepEqual(declared, files);
    const sources = JSON.parse(await readFile(new URL('sources.json', directory)));
    assert.deepEqual(sources.map((source) => source.file).sort(), files);
    for (const file of files) {
        const url = new URL(file, directory);
        assert.ok((await stat(url)).size < 5 * 1024 * 1024);
        assert.equal(
            createHash('sha256')
                .update(await readFile(url))
                .digest('hex'),
            sources.find((source) => source.file === file).sha256,
        );
    }
});

test('legacy large-resource transport remains lossless using generated test bytes', async () => {
    // Transport compatibility only; no removed font asset is shipped as a fixture.
    const original = new Uint8Array(PLAIN_FONT_BYTES + 1);
    for (let i = 0; i < original.length; i++) original[i] = i % 251;
    const expected = createHash('sha256').update(original).digest('hex');
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
