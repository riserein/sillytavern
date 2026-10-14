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
