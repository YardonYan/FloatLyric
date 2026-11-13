'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Color = require('../renderer/shared/color');

const closeTo = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

test('hexToRgb expands short form and rejects garbage as white', () => {
  assert.deepEqual(Color.hexToRgb('#fff'), { r: 1, g: 1, b: 1 });
  assert.deepEqual(Color.hexToRgb('abc'), { r: 0xaa / 255, g: 0xbb / 255, b: 0xcc / 255 });
  assert.deepEqual(Color.hexToRgb('nope'), { r: 1, g: 1, b: 1 });
});

test('oklch round-trip stays within one channel step', () => {
  for (const hex of ['#3D434B', '#F2F4F8', '#FFD9A0', '#2B6CB0', '#000000', '#FFFFFF']) {
    const { L, C, H } = Color.hexToOklch(hex);
    const back = Color.hexToRgb(Color.oklchToHex(L, C, H));
    const src = Color.hexToRgb(hex);
    assert.ok(closeTo(back.r * 255, src.r * 255), `${hex} r ${back.r} vs ${src.r}`);
    assert.ok(closeTo(back.g * 255, src.g * 255), `${hex} g ${back.g} vs ${src.g}`);
    assert.ok(closeTo(back.b * 255, src.b * 255), `${hex} b ${back.b} vs ${src.b}`);
  }
});

test('shade moves lightness in the requested direction', () => {
  const base = '#3D434B';
  const lighter = Color.shade(base, 100);
  const darker = Color.shade(base, -100);
  assert.ok(Color.luminance(lighter) > Color.luminance(base));
  assert.ok(Color.luminance(darker) < Color.luminance(base));
});

test('contrast of black on white is the maximum 21', () => {
  assert.ok(closeTo(Color.contrast('#000000', '#FFFFFF'), 21, 0.01));
  assert.ok(closeTo(Color.contrast('#FFFFFF', '#FFFFFF'), 1, 0.001));
});

test('withAlpha clamps and formats rgba', () => {
  assert.equal(Color.withAlpha('#3D434B', 0.5), 'rgba(61,67,75,0.5)');
  assert.equal(Color.withAlpha('#3D434B', 2), 'rgba(61,67,75,1)');
  assert.equal(Color.withAlpha('#3D434B', -1), 'rgba(61,67,75,0)');
});

test('mix interpolates in sRGB', () => {
  assert.equal(Color.mix('#000000', '#FFFFFF', 0.5), '#808080');
});