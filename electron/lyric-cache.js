'use strict';

// Lyric cache helpers. Insertion order is the LRU queue: the oldest key sits
// first, every read/write re-inserts its key at the tail, eviction drops from
// the head. Pure functions so the ordering rules can be unit-tested.

const MAX_CACHE_SONGS = 200;

function putLyric(cache, key, value, max = MAX_CACHE_SONGS) {
  const next = { ...cache };
  delete next[key];
  next[key] = value;
  const keys = Object.keys(next);
  if (keys.length > max) {
    for (const k of keys.slice(0, keys.length - max)) delete next[k];
  }
  return next;
}

function touchLyric(cache, key) {
  if (!Object.hasOwn(cache, key)) return cache;
  const next = { ...cache };
  const value = next[key];
  delete next[key];
  next[key] = value;
  return next;
}

module.exports = { MAX_CACHE_SONGS, putLyric, touchLyric };