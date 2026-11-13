'use strict';

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const EXTRACT = fs.readFileSync(path.join(__dirname, 'extract.js'), 'utf8');
const POLL_MS = 100;
const PAUSED_POLL_MS = 400;
const IDLE_POLL_MS = 1000;

function httpJson(port, route, timeout = 2500) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: route, timeout }, res => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

const CANDIDATE_DIRS = [
  () => path.join(process.env.LOCALAPPDATA || '', 'NetEase', 'CloudMusic'),
  () => 'D:\\网易云音乐\\CloudMusic',
  () => 'C:\\Program Files (x86)\\NetEase\\CloudMusic',
  () => 'C:\\Program Files\\NetEase\\CloudMusic',
  () => path.join(process.env.PROGRAMFILES || '', 'NetEase', 'CloudMusic')
];

function findExeSync() {
  for (const dir of CANDIDATE_DIRS) {
    const p = path.join(dir(), 'cloudmusic.exe');
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function findExeFromRegistry() {
  return new Promise(resolve => {
    const ps = `
      $keys = @(
        'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      )
      Get-ItemProperty $keys -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayIcon -like '*cloudmusic.exe*' } |
        Select-Object -First 1 -ExpandProperty DisplayIcon
    `;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const p = String(stdout).trim().split(/\r?\n/).pop().trim().replace(/^"|"$/g, '');
        resolve(p && fs.existsSync(p) ? p : null);
      });
  });
}

function isNcmRunning() {
  return new Promise(resolve => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq cloudmusic.exe', '/NH', '/FO', 'CSV'],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => resolve(!err && /cloudmusic\.exe/i.test(String(stdout))));
  });
}

class NcmBridge extends EventEmitter {
  constructor(port = 9222) {
    super();
    this.port = port;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.timer = null;
    this.lastState = null;
    this.signature = null;
    this.connected = false;
    this.exePath = null;
    this.busy = false;
    this.destroyed = false;
  }

  async resolveExe() {
    if (this.exePath && fs.existsSync(this.exePath)) return this.exePath;
    this.exePath = findExeSync() || await findExeFromRegistry();
    return this.exePath;
  }

  async targets() {
    const list = await httpJson(this.port, '/json/list');
    if (!Array.isArray(list)) return null;
    return list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }

  async probe() {
    const t = await this.targets();
    return t && t.length ? t : null;
  }

  async pickTarget() {
    const t = await this.targets();
    if (!t || !t.length) return null;
    return t.find(x => /app\.html/i.test(x.url || '')) || t[0];
  }

  async launchWithDebugPort() {
    const exe = await this.resolveExe();
    if (!exe) return { ok: false, reason: 'not-installed' };
    const running = await isNcmRunning();
    if (running) {
      await new Promise(resolve => {
        execFile('taskkill', ['/IM', 'cloudmusic.exe', '/F'], { timeout: 10000, windowsHide: true }, () => resolve());
      });
      await new Promise(r => setTimeout(r, 1500));
    }
    spawn(exe, [`--remote-debugging-port=${this.port}`], {
      detached: true, stdio: 'ignore', cwd: path.dirname(exe)
    }).unref();

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await this.probe()) return { ok: true, restarted: running };
    }
    return { ok: false, reason: 'port-never-opened' };
  }

  connect(wsUrl) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const ws = new WebSocket(wsUrl);
      const fail = e => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = ws;
        this.connected = true;
        ws.addEventListener('message', ev => this.onMessage(ev.data));
        ws.addEventListener('close', () => this.onClose());
        ws.addEventListener('error', () => this.onClose());
        resolve();
      });
      ws.addEventListener('error', fail);
      timer = setTimeout(() => fail(new Error('ws timeout')), 6000);
    });
  }

  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(timer);
      msg.error ? reject(new Error(msg.error.message || 'cdp error')) : resolve(msg.result);
    }
  }

  onClose() {
    if (!this.connected) return;
    this.connected = false;
    this.ws = null;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('cdp closed')); }
    this.pending.clear();
    this.emit('disconnected');
    if (!this.destroyed) setTimeout(() => this.reconnect(), 2000);
  }

  async reconnect() {
    if (this.destroyed || this.connected) return;
    const t = await this.pickTarget();
    if (!t) { setTimeout(() => this.reconnect(), 2500); return; }
    try {
      await this.connect(t.webSocketDebuggerUrl);
      await this.send('Runtime.enable');
      this.emit('connected');
      // A reconnect that skips poll() leaves the bridge "connected" with a
      // frozen lastState — the overlay then never follows the new track.
      this.poll();
    } catch { setTimeout(() => this.reconnect(), 2500); }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error('not connected'));
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('cdp timeout')); }
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: false, timeout: 5000
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'page exception');
    return r.result?.value;
  }

  async start() {
    if (this.connected) { this.poll(); return true; }
    const t = await this.pickTarget();
    if (!t) return false;
    try {
      await this.connect(t.webSocketDebuggerUrl);
      await this.send('Runtime.enable');
      this.emit('connected');
      this.poll();
      return true;
    } catch { return false; }
  }

  poll(delay = POLL_MS) {
    clearTimeout(this.timer);
    if (this.destroyed) return;
    this.timer = setTimeout(async () => {
      let next = this.connected ? POLL_MS : IDLE_POLL_MS;
      if (this.connected && !this.busy) {
        this.busy = true;
        try {
          const s = await this.evaluate(EXTRACT);
          if (s && s.ok) {
            s.at = Date.now();
            this.lastState = s;
            const sig = `${s.title}|${s.artist}|${s.duration}`;
            if (sig !== this.signature) {
              this.signature = sig;
              this.emit('songchange', s);
            }
            this.emit('state', s);
            // A paused player changes nothing for seconds at a time; sampling
            // it 10 times a second just burns CPU.
            if (!s.playing) next = PAUSED_POLL_MS;
          } else {
            this.emit('state', { ok: false, reason: s?.reason || 'no-player', at: Date.now() });
            next = IDLE_POLL_MS;
          }
        } catch (e) {
          this.emit('error', e.message);
          next = IDLE_POLL_MS;
        } finally { this.busy = false; }
      }
      this.poll(next);
    }, delay);
  }

  async control(action) {
    const labels = { toggle: ['pause', 'play'], prev: ['pre'], next: ['next'], lyric: ['lyric'] };
    const names = labels[action];
    if (!names) return false;
    const expr = `(() => {
      const sl = document.querySelector('[aria-label="播放进度调节"]');
      if (!sl) return false;
      let bar = sl; for (let i = 0; i < 3 && bar.parentElement; i++) bar = bar.parentElement;
      for (const n of ${JSON.stringify(names)}) {
        const el = bar.querySelector('[aria-label="' + n + '"]');
        if (el) { (el.closest('button,[role=button]') || el.parentElement || el).click(); return true; }
      }
      return false;
    })()`;
    try {
      const ok = await this.evaluate(expr);
      // Reflect transport changes in the UI immediately instead of waiting for
      // the (possibly downgraded) pause polling interval.
      if (ok) this.poll(0);
      return ok;
    } catch { return false; }
  }

  stop() {
    this.destroyed = true;
    clearTimeout(this.timer);
    try { this.ws?.close(); } catch {}
    this.connected = false;
  }
}

module.exports = { NcmBridge, findExeSync, findExeFromRegistry, isNcmRunning };