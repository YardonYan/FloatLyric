'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mapPoint, bgraToRgb, rgbToHex } = require('../electron/pixel-map');

// The user's real setup: 1440x900 DIP at scaleFactor 2 -> 2880x1800 physical.
const display = {
  id: 1,
  scaleFactor: 2,
  size: { width: 1440, height: 900 },
  bounds: { x: 0, y: 0, width: 1440, height: 900 }
};
const nativeSize = { width: 2880, height: 1800 };

test('DIP maps to physical pixels at scale 2 with a native-size thumbnail', () => {
  assert.deepEqual(mapPoint({ x: 100, y: 50 }, display, nativeSize), { x: 200, y: 100 });
  assert.deepEqual(mapPoint({ x: 0, y: 0 }, display, nativeSize), { x: 0, y: 0 });
});

test('fractional DIP floors to the pixel below', () => {
  assert.deepEqual(mapPoint({ x: 10.9, y: 20.1 }, display, nativeSize), { x: 21, y: 40 });
});

test('downscaled thumbnail maps through the size ratio', () => {
  // Capture asked for a box half the native resolution.
  const half = { width: 1440, height: 900 };
  assert.deepEqual(mapPoint({ x: 100, y: 50 }, display, half), { x: 100, y: 50 });
  assert.deepEqual(mapPoint({ x: 1439, y: 899 }, display, half), { x: 1439, y: 899 });
});

test('non-integer thumbnail ratio still lands inside the grid', () => {
  const odd = { width: 1000, height: 625 };
  const p = mapPoint({ x: 720, y: 450 }, display, odd);
  assert.equal(p.x, Math.floor(720 * 2 * (1000 / 2880)));
  assert.equal(p.y, Math.floor(450 * 2 * (625 / 1800)));
});

test('secondary display bounds are subtracted before scaling', () => {
  const second = { ...display, id: 2, bounds: { x: 1440, y: 0, width: 1440, height: 900 } };
  assert.deepEqual(mapPoint({ x: 1540, y: 50 }, second, nativeSize), { x: 200, y: 100 });
});

test('points outside the display clamp to the edge pixels', () => {
  assert.deepEqual(mapPoint({ x: -5, y: -5 }, display, nativeSize), { x: 0, y: 0 });
  assert.deepEqual(mapPoint({ x: 2000, y: 2000 }, display, nativeSize), { x: 2879, y: 1799 });
});

test('scale 1 display maps one DIP to one pixel', () => {
  const hd = { ...display, scaleFactor: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  assert.deepEqual(mapPoint({ x: 960, y: 540 }, hd, { width: 1920, height: 1080 }), { x: 960, y: 540 });
});

test('bitmap bytes are read as BGRA, not RGBA', () => {
  // Pure red pixel: B=0 G=0 R=255 A=255.
  assert.deepEqual(bgraToRgb([0, 0, 255, 255]), { b: 0, g: 0, r: 255 });
  assert.deepEqual(bgraToRgb([76, 122, 79, 255]), { b: 76, g: 122, r: 79 });
});

test('rgbToHex formats lowercase, pads and clamps', () => {
  assert.equal(rgbToHex({ r: 79, g: 122, b: 76 }), '#4f7a4c');
  assert.equal(rgbToHex({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(rgbToHex({ r: 255, g: 255, b: 255 }), '#ffffff');
  assert.equal(rgbToHex({ r: 300, g: -4, b: 1 }), '#ff0001');
});