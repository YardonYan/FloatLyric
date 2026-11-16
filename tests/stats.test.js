'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { StatsTracker, aggregate, markdownReport, csvExport, fmtDuration } = require('../electron/stats');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fl-stats-')); }

test('tracker: a >=1s play counts as one song, an instant skip does not', () => {
  const dir = tmpDir();
  let t = 0;
  const tr = new StatsTracker(dir, () => t);
  tr.onSongChange({ ok: true, playing: true, title: 'A', artist: 'X', duration: 300, position: 0 });
  t += 5000;
  tr.onSongChange({ ok: true, playing: true, title: 'B', artist: 'Y', duration: 200, position: 0 }); // settles A
  tr.onSongChange({ ok: true, playing: true, title: 'C', artist: 'Z', duration: 200, position: 0 }); // B played 0s
  const rows = tr.readRows();
  const songs = rows.filter(r => r.type === 'song');
  assert.equal(songs.length, 1);
  assert.equal(songs[0].title, 'A');
  assert.equal(songs[0].sec, 5);
  const listens = rows.filter(r => r.type === 'listen');
  assert.equal(listens.length, 1);
  assert.equal(listens[0].sec, 5);
  assert.equal(tr.todayCount, 1);
  assert.equal(tr.todayMs, 5000);
});

test('tracker: a replay of the same track counts as another play', () => {
  const dir = tmpDir();
  let t = 0;
  const tr = new StatsTracker(dir, () => t);
  tr.onSongChange({ ok: true, playing: true, title: 'Loop', artist: 'X', duration: 100, position: 0 });
  t += 30000;
  tr.onState({ ok: true, playing: true, title: 'Loop', artist: 'X', duration: 100, position: 30 });
  t += 30000;
  tr.onState({ ok: true, playing: true, title: 'Loop', artist: 'X', duration: 100, position: 5 }); // rewind
  const songs = tr.readRows().filter(r => r.type === 'song');
  assert.equal(songs.length, 1);
  t += 10000;
  tr.shutdown();
  const songs2 = tr.readRows().filter(r => r.type === 'song');
  assert.equal(songs2.length, 2);
  assert.equal(songs2[1].title, 'Loop');
});

test('tracker: paused time does not accumulate', () => {
  const dir = tmpDir();
  let t = 0;
  const tr = new StatsTracker(dir, () => t);
  tr.onSongChange({ ok: true, playing: true, title: 'A', artist: 'X', duration: 300, position: 0 });
  t += 2000;
  tr.onState({ ok: true, playing: false, title: 'A', artist: 'X', duration: 300, position: 2 });
  t += 600000;
  tr.onState({ ok: true, playing: true, title: 'A', artist: 'X', duration: 300, position: 2 });
  t += 3000;
  tr.shutdown();
  const song = tr.readRows().find(r => r.type === 'song');
  assert.equal(song.sec, 5);
  const listenMs = tr.readRows()
    .filter(r => r.type === 'listen')
    .reduce((s, r) => s + Math.round(r.sec * 1000), 0);
  assert.equal(listenMs, 5000);
});

test('tracker: today counters restore from the log on restart', () => {
  const dir = tmpDir();
  let t = 0;
  const a = new StatsTracker(dir, () => t);
  a.onSongChange({ ok: true, playing: true, title: 'A', artist: 'X', duration: 100, position: 0 });
  t += 5000;
  a.shutdown();
  const b = new StatsTracker(dir, () => t);
  assert.equal(b.todayMs, 5000);
  assert.equal(b.todayCount, 1);
});

test('tracker: 60s slices are written while a long track plays', () => {
  const dir = tmpDir();
  let t = 0;
  const tr = new StatsTracker(dir, () => t);
  tr.onSongChange({ ok: true, playing: true, title: 'Long', artist: 'X', duration: 600, position: 0 });
  t += 60000;
  tr.tick();
  t += 60000;
  tr.tick();
  const listens = tr.readRows().filter(r => r.type === 'listen');
  assert.equal(listens.length, 2);
  assert.equal(tr.todayMs, 120000);
  t += 45000;
  tr.shutdown();
  const listens2 = tr.readRows().filter(r => r.type === 'listen');
  assert.equal(listens2.length, 3);          // remaining 45s flushed on settle
  assert.equal(listens2[2].sec, 45);
  const song = tr.readRows().find(r => r.type === 'song');
  assert.equal(song.sec, 165);               // 60+60+45
});

test('aggregate: cards, hour buckets, days and top songs', () => {
  const now = new Date(2026, 10, 13, 12, 0, 0);
  const rows = [
    { type: 'listen', start: new Date(2026, 10, 13, 10, 0).toISOString(), sec: 600 },
    { type: 'song', start: new Date(2026, 10, 13, 10, 0).toISOString(), title: 'A', artist: 'X', dur: 300, sec: 600 },
    { type: 'listen', start: new Date(2026, 10, 12, 23, 30).toISOString(), sec: 300 },
    { type: 'song', start: new Date(2026, 10, 12, 23, 30).toISOString(), title: 'B', artist: 'Y', dur: 300, sec: 300 },
    { type: 'listen', start: new Date(2026, 10, 1, 8, 0).toISOString(), sec: 1200 }
  ];
  const agg = aggregate(rows, now);
  assert.equal(agg.today.ms, 600000);
  assert.equal(agg.today.count, 1);
  assert.equal(agg.week.ms, 900000);
  assert.equal(agg.month.ms, 2100000);
  assert.equal(agg.hours[10].ms, 600000);
  assert.equal(agg.hours[10].count, 1);
  assert.equal(agg.days.length, 3);
  assert.equal(agg.top[0].title, 'A');
  assert.equal(agg.recent.length, 2);
});

test('markdown report contains range, duration and top songs', () => {
  const now = new Date(2026, 10, 13, 12, 0, 0);
  const rows = [
    { type: 'listen', start: new Date(2026, 10, 13, 10, 0).toISOString(), sec: 600 },
    { type: 'song', start: new Date(2026, 10, 13, 10, 0).toISOString(), title: '晴天', artist: '周杰伦', dur: 270, sec: 600 }
  ];
  const week = markdownReport(rows, 'week', now);
  assert.match(week, /听歌周报/);
  assert.match(week, /10 分钟/);
  assert.match(week, /晴天/);
  const month = markdownReport(rows, 'month', now);
  assert.match(month, /听歌月报/);
});

test('csv export lists songs with BOM and escaped quotes', () => {
  const rows = [
    { type: 'listen', start: '2026-11-13T02:00:00.000Z', sec: 30 },
    { type: 'song', start: '2026-11-13T02:00:00.000Z', title: 'A"Q', artist: 'X', dur: 100, sec: 60 }
  ];
  const csv = csvExport(rows);
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv, /"A""Q"/);
  assert.doesNotMatch(csv.split('\n')[1], /listen/);
});

test('fmtDuration formats hours and minutes', () => {
  assert.equal(fmtDuration(0), '不足 1 分钟');
  assert.equal(fmtDuration(5 * 60000), '5 分钟');
  assert.equal(fmtDuration(83 * 60000), '1 小时 23 分');
});