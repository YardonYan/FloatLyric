'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MAX_CACHE_SONGS, putLyric, touchLyric } = require('../electron/lyric-cache');

const lyric = n => ({ lines: [{ t: n, text: `line ${n}` }], source: 'netease' });

test('cap is 200 songs', () => {
  assert.equal(MAX_CACHE_SONGS, 200);
});

test('put appends new keys at the tail', () => {
  let cache = {};
  cache = putLyric(cache, 'a', lyric(1));
  cache = putLyric(cache, 'b', lyric(2));
  assert.deepEqual(Object.keys(cache), ['a', 'b']);
});

test('re-put moves a key to the tail and replaces its value', () => {
  let cache = putLyric(putLyric({}, 'a', lyric(1)), 'b', lyric(2));
  cache = putLyric(cache, 'a', lyric(3));
  assert.deepEqual(Object.keys(cache), ['b', 'a']);
  assert.equal(cache.a.lines[0].t, 3);
});

test('eviction drops the oldest keys beyond the cap', () => {
  let cache = {};
  for (let i = 0; i < 5; i++) cache = putLyric(cache, `k${i}`, lyric(i), 3);
  assert.deepEqual(Object.keys(cache), ['k2', 'k3', 'k4']);
});

test('a touched song survives eviction of colder ones', () => {
  let cache = {};
  for (const k of ['a', 'b', 'c']) cache = putLyric(cache, k, lyric(0), 3);
  cache = touchLyric(cache, 'a');
  cache = putLyric(cache, 'd', lyric(1), 3);
  assert.deepEqual(Object.keys(cache), ['c', 'a', 'd']);
});

test('touch promotes an existing key and ignores missing ones', () => {
  const cache = { a: lyric(1), b: lyric(2) };
  assert.deepEqual(Object.keys(touchLyric(cache, 'a')), ['b', 'a']);
  assert.equal(touchLyric(cache, 'zzz'), cache);
});

test('put does not mutate the input cache', () => {
  const cache = { a: lyric(1) };
  putLyric(cache, 'b', lyric(2));
  assert.deepEqual(Object.keys(cache), ['a']);
});