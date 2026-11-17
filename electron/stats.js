'use strict';

// Listening-stats data layer: a tiny event log (NDJSON, one file per month)
// plus pure aggregation/report helpers. Kept free of electron so it can be
// unit-tested with plain node.
//
// Two row types:
//   {"type":"listen","start":ISO,"sec":n}   — a slice of played time (60s each)
//   {"type":"song","start":ISO,"title","artist","dur","sec"} — one play of a song
// Total time / hour buckets / day chart come from "listen" rows; play counts,
// top songs and the recent list come from "song" rows. A song row is written
// when the track changes, the client stops reporting, or the app quits —
// playing >= 1s counts as one play.

const fs = require('node:fs');
const path = require('node:path');

const LISTEN_INTERVAL_MS = 60_000;   // one "listen" slice per played minute
const MIN_SONG_MS = 1000;            // >= 1s counts as a played song
const REWIND_MS = 15;                // near-zero position + a big jump back = "replay"

function pad2(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d) { const x = startOfDay(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }
function startOfMonth(d) { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
function monthFileName(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}.ndjson`; }

function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (total === 0) return '不足 1 分钟';
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

class StatsTracker {
  // `now` is injectable so tests can drive time deterministically.
  constructor(dir, now = Date.now) {
    this.dir = dir;
    this._now = now;
    this.current = null;        // { title, artist, duration, startTs, playedMs, flushedMs }
    this.playingSince = null;   // timestamp of the current playing stretch
    this.lastPosition = null;
    this.todayKey = null;
    this.todayMs = 0;           // persisted played time today (listen rows)
    this.todayCount = 0;        // persisted songs today (song rows)
    this.todayTopMap = new Map(); // title♪artist -> { title, artist, count, ms }
    this.ensureToday();
  }

  monthFile(d = new Date(this._now())) {
    return path.join(this.dir, monthFileName(d));
  }

  ensureToday() {
    const key = dateKey(new Date(this._now()));
    if (key === this.todayKey) return;
    this.todayKey = key;
    this.todayMs = 0;
    this.todayCount = 0;
    this.todayTopMap.clear();
    this.restoreToday();
  }

  restoreToday() {
    const f = this.monthFile(new Date(this._now()));
    if (!fs.existsSync(f)) return;
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { return; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (dateKey(new Date(r.start)) !== this.todayKey) continue;
      if (r.type === 'listen') this.todayMs += Math.round((r.sec || 0) * 1000);
      else if (r.type === 'song') {
        this.todayCount += 1;
        const key = `${r.title || ''}♪${r.artist || ''}`;
        const t = this.todayTopMap.get(key) || { title: r.title || '未知歌曲', artist: r.artist || '', count: 0, ms: 0 };
        t.count += 1;
        t.ms += Math.round((r.sec || 0) * 1000);
        this.todayTopMap.set(key, t);
      }
    }
  }

  // Today's most-played track, or null. Used by the panel's today bar.
  getTodayTop() {
    return [...this.todayTopMap.values()]
      .sort((a, b) => b.count - a.count || b.ms - a.ms)[0] || null;
  }

  startSong(s) {
    this.current = {
      title: s.title || '未知歌曲',
      artist: s.artist || '',
      duration: s.duration || null,
      startTs: this._now(),
      playedMs: 0,
      flushedMs: 0
    };
  }

  pause() {
    if (this.playingSince == null) return;
    const span = this._now() - this.playingSince;
    this.playingSince = null;
    if (this.current) this.current.playedMs += span;
  }

  // Main-process state pump. `s.ok === false` (client gone / slider hidden)
  // counts as a pause: paused time must not accumulate.
  onState(s) {
    if (!s || !s.ok) {
      this.pause();
      return;
    }
    this.ensureToday();
    if (s.playing) {
      // Position jumping back to the beginning means the same track started
      // over — settle it and count it as another play.
      if (this.current && this.lastPosition != null && s.position != null &&
          s.position < REWIND_MS && this.lastPosition - s.position >= REWIND_MS) {
        this.finishSong();
        this.startSong(s);
        this.playingSince = this._now();
        this.lastPosition = s.position;
        return;
      }
      if (!this.current) this.startSong(s);
      if (this.playingSince == null) this.playingSince = this._now();
    } else {
      this.pause();
    }
    if (s.position != null) this.lastPosition = s.position;
  }

  onSongChange(s) {
    if (!s || !s.ok) return;
    this.ensureToday();
    this.finishSong();
    if (s.playing) {
      this.startSong(s);
      this.playingSince = this._now();
    }
    this.lastPosition = null;
  }

  // Called every LISTEN_INTERVAL_MS by the main process.
  tick() {
    this.ensureToday();
    if (this.playingSince == null) return;
    const now = this._now();
    const span = now - this.playingSince;
    if (span < LISTEN_INTERVAL_MS) return;
    this.playingSince = now;
    if (this.current) {
      this.current.playedMs += span;
      this.current.flushedMs += span;
    }
    this.writeListen(now, span);
  }

  writeListen(at, span) {
    this.append({
      type: 'listen',
      start: new Date(at - span).toISOString(),
      sec: +(span / 1000).toFixed(1)
    });
    if (dateKey(new Date(at)) === this.todayKey) this.todayMs += span;
  }

  finishSong() {
    this.pause();
    const c = this.current;
    if (!c) return;
    const remaining = c.playedMs - c.flushedMs;
    if (remaining >= MIN_SONG_MS) this.writeListen(this._now(), remaining);
    if (c.playedMs >= MIN_SONG_MS) {
      this.append({
        type: 'song',
        start: new Date(c.startTs).toISOString(),
        title: c.title,
        artist: c.artist,
        dur: c.duration,
        sec: +(c.playedMs / 1000).toFixed(1)
      });
      if (dateKey(new Date(c.startTs)) === this.todayKey) {
        this.todayCount += 1;
        const key = `${c.title}♪${c.artist}`;
        const t = this.todayTopMap.get(key) || { title: c.title, artist: c.artist, count: 0, ms: 0 };
        t.count += 1;
        t.ms += c.playedMs;
        this.todayTopMap.set(key, t);
      }
    }
    this.current = null;
    this.playingSince = null;
  }

  shutdown() {
    this.finishSong();
  }

  append(obj) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.monthFile(), JSON.stringify(obj) + '\n', 'utf8');
    } catch {}
  }

  readRows(now = new Date(this._now())) {
    const rows = [];
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    for (const d of [prev, now]) {
      const f = path.join(this.dir, monthFileName(d));
      if (!fs.existsSync(f)) continue;
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line)); } catch {}
      }
    }
    return rows;
  }

  snapshot() {
    const rows = this.readRows();
    const agg = aggregate(rows, new Date(this._now()));
    // Live counters win over the file-derived ones (they include unflushed time).
    agg.today = { ms: this.todayMs, count: this.todayCount };
    return agg;
  }
}

// Pure aggregation over parsed rows. `today` uses the local calendar day,
// `week` starts on Monday, `month` on the 1st; hour buckets cover the last 7
// days, the day chart the last ~31 days, top/recent all rows in range.
function aggregate(rows, now = new Date()) {
  const day0 = startOfDay(now).getTime();
  const week0 = startOfWeek(now).getTime();
  const month0 = startOfMonth(now).getTime();
  const cutoff = month0 - 31 * 86400000;
  const out = {
    generatedAt: now.toISOString(),
    today: { ms: 0, count: 0 },
    week: { ms: 0, count: 0 },
    month: { ms: 0, count: 0 },
    hours: Array.from({ length: 24 }, () => ({ ms: 0, count: 0 })),
    days: [],
    top: [],
    recent: []
  };
  const dayMap = new Map();
  const topMap = new Map();
  const todayTopMap = new Map();
  const recent = [];
  for (const r of rows) {
    const ts = Date.parse(r.start);
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const ms = Math.round((r.sec || 0) * 1000);
    const hour = new Date(ts).getHours();
    if (ts >= day0) {
      if (r.type === 'listen') out.today.ms += ms;
      else if (r.type === 'song') {
        out.today.count += 1;
        const key = `${r.title || ''}♪${r.artist || ''}`;
        const t = todayTopMap.get(key) || { title: r.title || '未知歌曲', artist: r.artist || '', count: 0, ms: 0 };
        t.count += 1;
        t.ms += ms;
        todayTopMap.set(key, t);
      }
    }
    if (ts >= week0) {
      if (r.type === 'listen') out.week.ms += ms;
      else if (r.type === 'song') out.week.count += 1;
      if (r.type === 'listen') out.hours[hour].ms += ms;
      else out.hours[hour].count += 1;
    }
    if (ts >= month0) {
      if (r.type === 'listen') out.month.ms += ms;
      else if (r.type === 'song') out.month.count += 1;
    }
    if (r.type === 'song') {
      const key = `${r.title || ''}♪${r.artist || ''}`;
      const t = topMap.get(key) || { title: r.title || '未知歌曲', artist: r.artist || '', count: 0, ms: 0 };
      t.count += 1;
      t.ms += ms;
      topMap.set(key, t);
      recent.push({ start: r.start, title: r.title, artist: r.artist, dur: r.dur, sec: r.sec });
    }
    const dk = dateKey(new Date(ts));
    const d = dayMap.get(dk) || { date: dk, ms: 0, count: 0 };
    d.ms += ms;
    if (r.type === 'song') d.count += 1;
    dayMap.set(dk, d);
  }
  out.days = [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-31);
  out.top = [...topMap.values()].sort((a, b) => b.count - a.count || b.ms - a.ms).slice(0, 10);
  out.todayTop = [...todayTopMap.values()].sort((a, b) => b.count - a.count || b.ms - a.ms)[0] || null;
  out.recent = recent.slice(-20).reverse();
  return out;
}

// Range-filtered aggregation for reports: week = last 7 days, month = this
// calendar month. Rows outside the range are dropped before aggregating.
function reportData(rows, type, now = new Date()) {
  const since = (type === 'week' ? startOfWeek(now) : startOfMonth(now)).getTime();
  const until = now.getTime();
  const filtered = rows.filter(r => {
    const ts = Date.parse(r.start);
    return Number.isFinite(ts) && ts >= since && ts <= until;
  });
  const agg = aggregate(filtered, now);
  const count = type === 'week'
    ? { ms: agg.week.ms, count: agg.week.count }
    : { ms: agg.month.ms, count: agg.month.count };
  return { agg, count };
}

function markdownReport(rows, type, now = new Date()) {
  const { agg, count } = reportData(rows, type, now);
  const isWeek = type === 'week';
  const since = isWeek ? startOfWeek(now) : startOfMonth(now);
  const lines = [];
  lines.push(`# ${isWeek ? '听歌周报' : '听歌月报'}`);
  lines.push('');
  lines.push(`- 统计区间：${dateKey(since)} ~ ${dateKey(now)}`);
  lines.push(`- 总时长：${fmtDuration(count.ms)}`);
  lines.push(`- 听歌首数：${count.count} 首`);
  lines.push('');
  lines.push('## 每日');
  lines.push('| 日期 | 时长 | 首数 |');
  lines.push('| --- | ---: | ---: |');
  const days = agg.days.filter(d => new Date(`${d.date}T00:00:00`).getTime() >= since.getTime());
  if (days.length) {
    for (const d of days) lines.push(`| ${d.date} | ${fmtDuration(d.ms)} | ${d.count} |`);
  } else {
    lines.push('| — | 无记录 | — |');
  }
  lines.push('');
  lines.push('## 时段分布');
  const hot = agg.hours.map((h, i) => ({ i, ...h })).filter(h => h.ms > 0 || h.count > 0);
  if (hot.length) {
    for (const h of hot) lines.push(`- ${pad2(h.i)}:00 ~ ${pad2((h.i + 1) % 24)}:00 — ${fmtDuration(h.ms)}（${h.count} 首）`);
  } else {
    lines.push('- 无记录');
  }
  lines.push('');
  lines.push('## 最常听');
  if (agg.top.length) {
    agg.top.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.title}${t.artist ? ' — ' + t.artist : ''}（${t.count} 次，约 ${fmtDuration(t.ms)}）`);
    });
  } else {
    lines.push('- 无记录');
  }
  return lines.join('\n');
}

function csvExport(rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const songs = rows
    .filter(r => r.type === 'song')
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const lines = ['时间,歌名,歌手,歌曲时长(秒),播放(秒)'];
  for (const r of songs) {
    lines.push([r.start, r.title, r.artist, r.dur ?? '', r.sec ?? ''].map(esc).join(','));
  }
  return '\ufeff' + lines.join('\n');
}

module.exports = {
  StatsTracker,
  aggregate,
  reportData,
  markdownReport,
  csvExport,
  fmtDuration,
  dateKey,
  LISTEN_INTERVAL_MS,
  MIN_SONG_MS
};