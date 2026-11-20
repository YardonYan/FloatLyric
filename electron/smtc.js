'use strict';

// SMTC fallback playback source: talks to a long-lived powershell.exe that
// polls the Windows System Media Transport Controls (electron/smtc.ps1) and
// emits one normalized state object per tick. Used when the NetEase debug
// port is unavailable so ANY player that reports to Windows still drives the
// strip. The CDP bridge keeps priority; main.js decides who is on air.

const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SCRIPT = path.join(__dirname, 'smtc.ps1');
const RESTART_DELAY = 2000;

// Timeline data can be missing (some browsers report sessions without one);
// a state without a usable duration would freeze the lyric clock at 0:00.
// The upstream reason (no-session / no-media) is kept for diagnostics.
function normalizeTick(tick) {
  if (!tick || !tick.ok || !(tick.dur > 0)) {
    return { ok: false, reason: (tick && tick.reason) || 'no-timeline', src: 'smtc' };
  }
  return {
    ok: true,
    src: 'smtc',
    title: String(tick.title || ''),
    artist: String(tick.artist || ''),
    album: String(tick.album || ''),
    position: Number(tick.pos) || 0,
    duration: Number(tick.dur) || 0,
    playing: !!tick.playing
  };
}

// Mirrors the bridge signature: title|artist|rounded duration. Same live/remix
// with the same title+artist must re-trigger lyrics when the duration differs.
function songKey(state) {
  return `${state.title}|${state.artist}|${state.duration ? Math.round(state.duration) : ''}`;
}

class SmtcSource extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.stopped = false;
    this.hasSession = false;
    this.lastState = null;
    this.lastKey = '';
    this.buf = '';
  }

  start() {
    // A previous stop() must not block a later re-enable (the panel toggle
    // flips this source on and off at runtime).
    this.stopped = false;
    if (this.proc) return;
    this.launch();
  }

  launch() {
    this.buf = '';
    let proc;
    try {
      proc = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      setTimeout(() => { if (!this.stopped && !this.proc) this.launch(); }, RESTART_DELAY);
      return;
    }
    this.proc = proc;
    proc.stdout.on('data', d => {
      this.buf += d.toString('utf8');
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        let tick;
        try { tick = JSON.parse(line); } catch { continue; }
        this.onTick(tick);
      }
    });
    proc.stderr.on('data', () => {});
    proc.on('exit', () => {
      this.proc = null;
      this.hasSession = false;
      this.lastState = null;
      if (!this.stopped) setTimeout(() => { if (!this.stopped && !this.proc) this.launch(); }, RESTART_DELAY);
    });
  }

  onTick(tick) {
    const state = normalizeTick(tick);
    state.at = Date.now();
    if (!state.ok) {
      // "no-media" / "no-session" mean nothing usable is playing: the source
      // has no session for the panel to show. A valid session that merely
      // misses its timeline is rarer and treated the same way here.
      this.hasSession = false;
      this.lastState = null;
      this.emit('state', state);
      return;
    }
    this.hasSession = true;
    this.lastState = state;
    const key = songKey(state);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.emit('songchange', state);
    }
    this.emit('state', state);
  }

  // play | pause | toggle | prev | next through a one-shot powershell.exe —
  // playback control is rare, so a cold start (~1-2s) is acceptable.
  control(action) {
    const cmds = new Set(['play', 'pause', 'toggle', 'prev', 'next']);
    if (!cmds.has(action)) return Promise.resolve(false);
    return new Promise(resolve => {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-cmd', action],
        { timeout: 12000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(false);
          try { resolve(JSON.parse(String(stdout).trim()).ok === true); } catch { resolve(false); }
        });
    });
  }

  stop() {
    this.stopped = true;
    try { this.proc?.kill(); } catch {}
    this.proc = null;
    this.hasSession = false;
    this.lastState = null;
  }
}

module.exports = { SmtcSource, normalizeTick, songKey };
