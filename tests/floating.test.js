import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPosition, positionToRatio, positionFromRatio } from '../floating.js';

test('floating elements stay within the viewport on all four edges', () => {
    const size = { width: 46, height: 46 };
    const viewport = { width: 375, height: 667 };
    assert.deepEqual(clampPosition({ x: -100, y: -100 }, size, viewport), { x: 8, y: 8 });
    assert.deepEqual(clampPosition({ x: 1000, y: 1000 }, size, viewport), { x: 321, y: 613 });
    assert.deepEqual(clampPosition({ x: 100, y: 200 }, size, viewport), { x: 100, y: 200 });
});

test('positions restore exactly in the same viewport', () => {
    const viewport = { width: 1280, height: 720 };
    const position = { x: 200, y: 100 };
    const ratio = positionToRatio(position, viewport);
    assert.deepEqual(positionFromRatio(ratio, { width: 370, height: 450 }, viewport), position);
});

test('positions scale and clamp when moving from desktop to phone', () => {
    const ratio = positionToRatio({ x: 1000, y: 550 }, { width: 1280, height: 720 });
    const position = positionFromRatio(ratio, { width: 350, height: 513 }, { width: 375, height: 667 });
    assert.deepEqual(position, { x: 17, y: 146 });
});

test('a tall window keeps its drag handle accessible even in a very small viewport', () => {
    assert.deepEqual(clampPosition({ x: -10, y: -50 }, { width: 350, height: 500 }, { width: 375, height: 300 }), { x: 8, y: 8 });
});

test('resizable panel dimensions enforce limits and fit even a very small viewport', async () => {
    const { clampPanelSize, normalizePanelSize } = await import('../resizing.js');
    assert.deepEqual(clampPanelSize({ width: 20, height: 20 }, { width: 1280, height: 1200 }), { width: 320, height: 420 });
    assert.deepEqual(clampPanelSize({ width: 2000, height: 2000 }, { width: 1280, height: 1200 }), { width: 720, height: 960 });
    assert.deepEqual(clampPanelSize({ width: 720, height: 960 }, { width: 375, height: 667 }), { width: 351, height: 635 });
    assert.deepEqual(clampPanelSize({ width: 720, height: 960 }, { width: 240, height: 320 }), { width: 216, height: 288 });
    assert.equal(normalizePanelSize({ width: NaN, height: 500 }), null);
    assert.deepEqual(normalizePanelSize({ width: 400, height: 700 }), { width: 400, height: 700 });
});
