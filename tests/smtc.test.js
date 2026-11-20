'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTick, songKey, SmtcSource } = require('../electron/smtc');

test('normalizeTick rejects sessions without a usable timeline', () => {
  const s = normalizeTick({ ok: true, title: '歌', artist: '人', pos: 3, dur: 0 });
  assert.equal(s.ok, false);
  assert.equal(s.src, 'smtc');
});

test('normalizeTick keeps title/artist/position/playing for real sessions', () => {
  const s = normalizeTick({ ok: true, playing: true, title: '晴天', artist: '周杰伦', album: '叶惠美', pos: 12.4, dur: 269.2 });
  assert.equal(s.ok, true);
  assert.equal(s.src, 'smtc');
  assert.equal(s.title, '晴天');
  assert.equal(s.artist, '周杰伦');
  assert.equal(s.album, '叶惠美');
  assert.equal(s.position, 12.4);
  assert.equal(s.duration, 269.2);
  assert.equal(s.playing, true);
});

test('normalizeTick coerces garbage values safely', () => {
  const s = normalizeTick({ ok: true, title: null, artist: 42, pos: 'x', dur: '5.5' });
  assert.equal(s.ok, true);
  assert.equal(s.title, '');
  assert.equal(s.artist, '42');
  assert.equal(s.position, 0);
  assert.equal(s.duration, 5.5);
  assert.equal(s.playing, false);
});

test('normalizeTick marks a missing or empty tick as not ok and keeps the reason', () => {
  assert.equal(normalizeTick(null).ok, false);
  assert.equal(normalizeTick({ ok: false }).reason, 'no-timeline');
  assert.equal(normalizeTick({ ok: false, reason: 'no-media' }).reason, 'no-media');
});

test('songKey matches the bridge signature and separates versions by duration', () => {
  const a = songKey({ title: '歌', artist: '人', duration: 200.4 });
  const b = songKey({ title: '歌', artist: '人', duration: 200.6 });
  const c = songKey({ title: '歌', artist: '人', duration: 0 });
  assert.equal(a, '歌|人|200');
  assert.notEqual(a, b);
  assert.equal(c, '歌|人|');
});

test('a session appearing emits songchange once, then only state', async () => {
  const src = new SmtcSource();
  const changes = [];
  const states = [];
  src.on('songchange', s => changes.push(s));
  src.on('state', s => states.push(s));

  src.onTick({ ok: true, playing: true, title: 'A', artist: 'X', pos: 1, dur: 100 });
  src.onTick({ ok: true, playing: true, title: 'A', artist: 'X', pos: 1.5, dur: 100 });
  src.onTick({ ok: true, playing: true, title: 'B', artist: 'Y', pos: 0, dur: 200 });

  assert.equal(changes.length, 2);
  assert.equal(changes[0].title, 'A');
  assert.equal(changes[1].title, 'B');
  assert.equal(states.length, 3);
  assert.equal(src.hasSession, true);
  src.stop();
});

test('no-media ticks clear the session and report not ok', async () => {
  const src = new SmtcSource();
  src.onTick({ ok: true, playing: true, title: 'A', artist: 'X', pos: 1, dur: 100 });
  assert.equal(src.hasSession, true);
  const seen = [];
  src.on('state', s => seen.push(s));
  src.onTick({ ok: false, reason: 'no-media' });
  assert.equal(src.hasSession, false);
  assert.equal(seen.at(-1).ok, false);
  assert.equal(seen.at(-1).src, 'smtc');
  src.stop();
});

test('a stopped source can be started again', () => {
  const src = new SmtcSource();
  src.start();
  src.stop();
  assert.equal(src.proc, null);
  src.start(); // must not throw and must clear the stopped flag
  assert.equal(src.stopped, false);
  src.stop();
});
