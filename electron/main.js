'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const settings = require('./settings');
const { NcmBridge, isNcmRunning } = require('./ncm');
const { fetchLyrics, parseLrc, clean } = require('./lyrics');
const { putLyric, touchLyric } = require('./lyric-cache');
const eyedropper = require('./eyedropper');
const { log, attach } = require('./log');

const ROOT = path.join(__dirname, '..');
const R = (...p) => path.join(ROOT, 'renderer', ...p);

let overlay = null, panel = null, picker = null, tray = null;
let bridge = null;
let pickTimer = null;
let pickActive = false;
let pickPrevColor = null;
let currentLyrics = { lines: [], source: 'none' };
let currentSong = null;
let lyricRequest = 0;
let ncmStatus = { phase: 'idle', detail: '' };
let connecting = false;
let retryBusy = false;
let autoRetryTimer = null;
let lastProcessCheck = 0;
let pointerTimer = null;
let hotZones = [];
let hot = false;
let balloonShown = false;

// Phases where nothing is in flight and a probe is worth trying again.
const AUTO_PHASES = new Set(['idle', 'not-running', 'needs-restart', 'error']);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showPanel(); });
  boot();
}

function boot() {
  app.whenReady().then(async () => {
    log('boot ready', process.versions.electron);
    try {
      settings.init();
      if (process.platform === 'win32') app.setAppUserModelId('top.yardon.floatlyric');

      createOverlay();
      createPanel();
      createTray();
      registerIpc();
      registerShortcuts();

      bridge = new NcmBridge(settings.get().cdpPort);
      wireBridge();
      await tryConnect();
      startAutoReconnect();
      startPointerWatch();
      log('boot done', ncmStatus);
    } catch (err) {
      log('BOOT ERROR', err && err.stack || String(err));
    }
  }).catch(err => log('READY ERROR', err && err.stack || String(err)));

  // The window-all-closed event carries no event object; subscribing at all is
  // enough to keep the app alive when the last window goes away.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    settings.flush();
    clearInterval(autoRetryTimer);
    clearInterval(pointerTimer);
    bridge?.stop();
    stopPick(false);
    globalShortcut.unregisterAll();
  });
}

function wireBridge() {
  bridge.on('connected', () => {
    log('bridge connected');
    ncmStatus = { phase: 'connected', detail: '' };
    broadcast('ncm:status', ncmStatus);
  });
  bridge.on('disconnected', () => {
    log('bridge disconnected');
    ncmStatus = { phase: 'reconnecting', detail: '' };
    broadcast('ncm:status', ncmStatus);
  });
  // While switching tracks the client occasionally reports a hidden slider for
  // one sample; forwarding that would blank the strip for a frame (a visible
  // flicker). Hold the last good state through short misses.
  let lastGoodAt = 0;
  let lastGoodSeen = false;
  bridge.on('state', s => {
    if (s && s.ok) {
      lastGoodSeen = true;
      lastGoodAt = Date.now();
    } else if (lastGoodSeen && Date.now() - lastGoodAt < 1500) {
      return;
    }
    broadcast('ncm:state', s);
  });
  bridge.on('songchange', s => {
    log('songchange', s.title, s.artist, s.duration);
    currentSong = { title: s.title, artist: s.artist, duration: s.duration, cover: s.cover };
    loadLyrics(currentSong);
  });
  bridge.on('error', e => log('bridge error', e && e.message || e));
}

async function tryConnect() {
  if (connecting) return;
  connecting = true;
  try {
    ncmStatus = { phase: 'probing', detail: '' };
    broadcast('ncm:status', ncmStatus);
    const ok = await bridge.start();
    if (ok) {
      ncmStatus = { phase: 'connected', detail: '' };
    } else {
      const running = await isNcmRunning();
      lastProcessCheck = Date.now();
      ncmStatus = {
        phase: running ? 'needs-restart' : 'not-running',
        detail: running ? '网易云已在运行，但未开启调试端口' : '网易云未运行'
      };
    }
  } finally {
    connecting = false;
    broadcast('ncm:status', ncmStatus);
  }
}

// The client is often started after the overlay. Keep a cheap probe running so
// the overlay attaches on its own instead of sitting on "未连接" until the user
// finds the reconnect button.
function startAutoReconnect() {
  clearInterval(autoRetryTimer);
  autoRetryTimer = setInterval(autoRetry, 2000);
}

// Polling the cursor is the only reliable hit-test here: on Windows the
// `forward` option stops delivering moves once the window starts ignoring the
// mouse, so after the first exit the pointer could never come back.
const HOT_PAD = 10;

function setHot(on) {
  if (on === hot) return;
  hot = on;
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(!on, { forward: true });
  try { overlay.webContents.send('overlay:hot', on); } catch {}
}

function resetHot() {
  hot = false;
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(true, { forward: true });
  try { overlay.webContents.send('overlay:hot', false); } catch {}
}

function startPointerWatch() {
  clearInterval(pointerTimer);
  pointerTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) {
      setHot(false);
      return;
    }
    const cfg = settings.get();
    if (cfg.clickThrough || cfg.locked) {
      setHot(false);
      return;
    }
    const b = overlay.getContentBounds();
    const pt = screen.getCursorScreenPoint();
    const x = pt.x - b.x;
    const y = pt.y - b.y;
    const inside = x >= 0 && y >= 0 && x <= b.width && y <= b.height;
    const hit = inside && hotZones.some(z =>
      x >= z.x - HOT_PAD && x <= z.x + z.w + HOT_PAD &&
      y >= z.y - HOT_PAD && y <= z.y + z.h + HOT_PAD);
    setHot(hit);
  }, 100);
}

async function autoRetry() {
  if (retryBusy || connecting || !bridge) return;
  if (!AUTO_PHASES.has(ncmStatus.phase)) return;
  retryBusy = true;
  try {
    const targets = await bridge.probe();
    if (targets && targets.length) {
      const ok = await bridge.start();
      if (ok) {
        ncmStatus = { phase: 'connected', detail: '' };
        broadcast('ncm:status', ncmStatus);
      }
      return;
    }
    // Process lookup spawns PowerShell-free tasklist each time; keep it rare.
    if (Date.now() - lastProcessCheck < 15000) return;
    lastProcessCheck = Date.now();
    const running = await isNcmRunning();
    const next = running
      ? { phase: 'needs-restart', detail: '网易云已在运行，但未开启调试端口' }
      : { phase: 'not-running', detail: '网易云未运行' };
    if (next.phase !== ncmStatus.phase) {
      ncmStatus = next;
      broadcast('ncm:status', next);
    }
  } catch (err) {
    log('auto reconnect error', err && err.message || err);
  } finally {
    retryBusy = false;
  }
}

// Cache key includes duration so a live/remix with the same title and artist
// does not inherit the studio version's timeline.
function songKey(song) {
  const d = song && song.duration ? Math.round(song.duration) : '';
  return `${song.title}|${song.artist}|${d}`;
}
const legacySongKey = song => `${song.title}|${song.artist}`;

function cacheLyric(key, value) {
  settings.set({ lyricCache: putLyric(settings.get().lyricCache || {}, key, value) });
}

function hasLyric(value) {
  return !!value && (Array.isArray(value.lines) && value.lines.length > 0 || value.source === 'instrumental');
}

async function loadLyrics(song) {
  const req = ++lyricRequest;
  broadcast('lyrics:loading', { title: song.title });

  const cache = settings.get().lyricCache || {};
  const key = songKey(song);
  const legacy = legacySongKey(song);
  const hit = cache[key] || cache[legacy];
  if (hasLyric(hit)) {
    log('lyrics cache hit', key, hit.lines ? hit.lines.length : hit.source);
    if (!cache[key]) cacheLyric(key, hit);
    else settings.set({ lyricCache: touchLyric(cache, key) });
    currentLyrics = { lines: hit.lines || [], source: hit.source, matched: hit.matched, matchedArtist: hit.matchedArtist };
    broadcast('lyrics:data', currentLyrics);
    return;
  }

  let r;
  try {
    r = await fetchLyrics(song.title, song.artist, song.duration);
    // One quiet retry: a dropped request should not read as "no lyrics".
    if (r.source === 'none' && req === lyricRequest) {
      await new Promise(res => setTimeout(res, 2000));
      if (req !== lyricRequest) return;
      const retry = await fetchLyrics(song.title, song.artist, song.duration);
      if (retry.source !== 'none') r = retry;
    }
  } catch (err) {
    log('LYRICS FETCH ERROR', err && err.stack || String(err));
    r = { lines: [], source: 'none' };
  }
  if (req !== lyricRequest) return;
  log('lyrics loaded', song.title, r.source, r.lines.length);
  currentLyrics = r;
  broadcast('lyrics:data', r);
  if (r.lines.length || r.source === 'instrumental') {
    cacheLyric(key, {
      lines: r.lines || [],
      source: r.source,
      matched: r.matched,
      matchedArtist: r.matchedArtist
    });
  }
}

function broadcast(channel, payload) {
  for (const w of [overlay, panel, picker]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function createOverlay() {
  const s = settings.get();
  const display = screen.getPrimaryDisplay();
  const width = 620, height = 84;
  const bounds = s.overlayBounds || {
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height - height - 96),
    width, height
  };

  overlay = new BrowserWindow({
    ...bounds,
    minWidth: 280,
    minHeight: 70,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(R('overlay', 'index.html'));
  attach(overlay, 'overlay');
  overlay.on('moved', persistOverlay);
  overlay.on('resized', persistOverlay);
  overlay.on('closed', () => { overlay = null; });
  // The strip is mostly empty space. Start in pass-through mode; the renderer
  // flips interaction on only while the pointer is over the text or HUD.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  if (s.locked) overlay.setMovable(false);
}

function persistOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  const b = overlay.getBounds();
  settings.set({ overlayBounds: b });
  // Keep the panel's width/height fields in sync while the edge is dragged.
  for (const w of [panel, picker]) {
    if (w && !w.isDestroyed()) w.webContents.send('overlay:boundsChanged', b);
  }
}

function createPanel() {
  const s = settings.get();
  const width = 384, height = 620;
  const display = screen.getPrimaryDisplay();
  const bounds = s.panelBounds || {
    x: Math.round(display.workArea.x + display.workArea.width - width - 40),
    y: Math.round(display.workArea.y + 60),
    width, height
  };
  panel = new BrowserWindow({
    ...bounds,
    minWidth: 340,
    minHeight: 420,
    frame: false,
    transparent: false,
    backgroundColor: '#14161C',
    hasShadow: true,
    resizable: true,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  panel.loadFile(R('panel', 'index.html'));
  attach(panel, 'panel');
  panel.on('moved', () => { if (panel && !panel.isDestroyed()) settings.set({ panelBounds: panel.getBounds() }); });
  panel.on('resized', () => { if (panel && !panel.isDestroyed()) settings.set({ panelBounds: panel.getBounds() }); });
  panel.on('closed', () => { panel = null; });
  panel.once('ready-to-show', () => panel.show());
}

function showPanel() {
  if (!panel || panel.isDestroyed()) createPanel();
  panel.show();
  panel.focus();
}

// Tell the user where the panel went the first time they close it to the tray.
// Windows may suppress this balloon under Focus Assist, so it is only a hint.
function notifyTray() {
  if (!tray || balloonShown) return;
  balloonShown = true;
  try {
    const opts = {
      title: '浮词已收起到托盘',
      content: '点击任务栏右下角的浮词图标，或按 Alt+P，可重新打开控制面板。'
    };
    const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png'));
    if (!icon.isEmpty()) opts.icon = icon.resize({ width: 32, height: 32 });
    tray.displayBalloon(opts);
  } catch {}
}

function createTray() {
  const iconPath = path.join(ROOT, 'assets', 'tray.png');
  let img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('浮词 · 桌面歌词');
  const menu = Menu.buildFromTemplate([
    { label: '显示歌词', click: () => { overlay?.show(); } },
    { label: '隐藏歌词', click: () => { overlay?.hide(); } },
    { type: 'separator' },
    { label: '控制面板', click: showPanel },
    { label: '屏幕取色针', click: () => startPick() },
    { type: 'separator' },
    { label: '重新连接网易云', click: () => tryConnect() },
    { label: '以调试模式启动网易云', click: () => launchNcm() },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showPanel);
}

function toggleOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  if (overlay.isVisible()) {
    // A single "boss key" hides both the strip and the panel.
    overlay.hide();
    panel?.hide();
  } else {
    overlay.show();
  }
}

function toggleLock() {
  const locked = !settings.get().locked;
  settings.set({ locked });
  broadcast('settings:changed', settings.get());
}

// Returns the accelerators that Windows refused (already taken by another app).
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const sc = settings.get().shortcuts || {};
  const failed = [];
  const bind = (accel, fn) => {
    if (!accel) return;
    let ok = false;
    try { ok = globalShortcut.register(accel, fn); } catch { ok = false; }
    if (!ok) failed.push(accel);
  };
  bind(sc.toggle, toggleOverlay);
  bind(sc.panel, showPanel);
  bind(sc.pick, () => startPick());
  bind(sc.lock, toggleLock);
  return failed;
}

async function launchNcm() {
  ncmStatus = { phase: 'launching', detail: '' };
  broadcast('ncm:status', ncmStatus);
  const r = await bridge.launchWithDebugPort();
  if (r.ok) {
    bridge.stop();
    bridge = new NcmBridge(settings.get().cdpPort);
    wireBridge();
    await tryConnect();
  } else {
    ncmStatus = { phase: 'error', detail: r.reason === 'not-installed' ? '找不到网易云安装位置' : '调试端口未能开启' };
    broadcast('ncm:status', ncmStatus);
  }
  return r;
}

async function startPick() {
  if (pickActive) return;
  pickActive = true;
  pickPrevColor = settings.get().baseColor;
  await eyedropper.freeze();

  const all = screen.getAllDisplays();
  const minX = Math.min(...all.map(d => d.bounds.x));
  const minY = Math.min(...all.map(d => d.bounds.y));
  const maxX = Math.max(...all.map(d => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...all.map(d => d.bounds.y + d.bounds.height));

  picker = new BrowserWindow({
    x: minX, y: minY, width: maxX - minX, height: maxY - minY,
    frame: false, transparent: true, hasShadow: false, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  picker.setAlwaysOnTop(true, 'screen-saver');
  picker.loadFile(R('picker', 'index.html'));
  attach(picker, 'picker');
  picker.once('ready-to-show', () => {
    picker.show();
    picker.focus();
    broadcast('pick:started', { shade: settings.get().shade });
    loopPick();
  });
  picker.on('closed', () => { picker = null; });
}

function loopPick() {
  clearTimeout(pickTimer);
  if (!pickActive) return;
  pickTimer = setTimeout(async () => {
    if (!pickActive || !picker || picker.isDestroyed()) return;
    try {
      const s = await eyedropper.sample({ withPatch: true });
      if (s && pickActive) {
        picker.webContents.send('pick:sample', s);
        overlay?.webContents.send('pick:preview', { hex: s.hex });
      }
    } catch {}
    loopPick();
  }, 55);
}

function stopPick(commit) {
  if (!pickActive) return;
  pickActive = false;
  clearTimeout(pickTimer);
  eyedropper.unfreeze();
  if (!commit && pickPrevColor) {
    settings.set({ baseColor: pickPrevColor });
    broadcast('settings:changed', settings.get());
  }
  overlay?.webContents.send('pick:preview', null);
  broadcast('pick:ended', { committed: !!commit });
  if (picker && !picker.isDestroyed()) picker.close();
  picker = null;
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = settings.set(patch);
    applyLiveSettings(next, patch);
    if ('shortcuts' in patch) {
      const failed = registerShortcuts();
      if (failed.length) broadcast('settings:shortcutsFailed', failed);
    }
    broadcast('settings:changed', next);
    return next;
  });

  ipcMain.handle('ncm:status', () => ncmStatus);
  ipcMain.handle('ncm:reconnect', () => tryConnect());
  ipcMain.handle('ncm:launch', () => launchNcm());
  ipcMain.handle('ncm:control', (_e, action) => bridge?.control(action));
  ipcMain.handle('ncm:state', () => bridge?.lastState || null);

  ipcMain.handle('lyrics:current', () => currentLyrics);
  ipcMain.handle('lyrics:refetch', async () => {
    if (!currentSong) return currentLyrics;
    const cache = { ...settings.get().lyricCache };
    delete cache[songKey(currentSong)];
    delete cache[legacySongKey(currentSong)];
    settings.set({ lyricCache: cache });
    await loadLyrics(currentSong);
    return currentLyrics;
  });
  ipcMain.handle('lyrics:fromText', (_e, raw) => {
    const lines = clean(parseLrc(raw));
    currentLyrics = { lines, source: 'manual' };
    broadcast('lyrics:data', currentLyrics);
    return currentLyrics;
  });

  ipcMain.handle('pick:start', async () => { await startPick(); return true; });
  ipcMain.handle('pick:sample', () => eyedropper.sample({}));
  ipcMain.handle('pick:commit', (_e, hex) => {
    if (hex) settings.set({ baseColor: hex });
    stopPick(true);
    broadcast('settings:changed', settings.get());
    return settings.get();
  });
  ipcMain.handle('pick:cancel', () => { stopPick(false); return true; });

  ipcMain.handle('overlay:bounds', (_e, b) => {
    if (!overlay || overlay.isDestroyed()) return null;
    if (b && typeof b.width === 'number') {
      const cur = overlay.getBounds();
      overlay.setBounds({
        x: Math.round(b.x ?? cur.x), y: Math.round(b.y ?? cur.y),
        width: Math.max(280, Math.round(b.width)), height: Math.max(70, Math.round(b.height))
      });
      persistOverlay();
    }
    return overlay.getBounds();
  });
  // Renderer reports the boxes (window-local) that should accept the mouse:
  // the lyric text, the toolbar and the resize grip. Everything else must let
  // clicks fall through to the window below.
  ipcMain.on('overlay:hot-zones', (_e, zones) => {
    hotZones = Array.isArray(zones)
      ? zones.slice(0, 8).map(z => ({
        x: Number(z.x) || 0, y: Number(z.y) || 0,
        w: Number(z.w) || 0, h: Number(z.h) || 0
      })).filter(z => z.w > 0 && z.h > 0)
      : [];
  });

  ipcMain.handle('overlay:center', () => {
    if (!overlay || overlay.isDestroyed()) return null;
    const b = overlay.getBounds();
    // Center on the display the overlay actually lives on, not the primary one.
    const wa = screen.getDisplayMatching(b).workArea;
    overlay.setBounds({
      x: Math.round(wa.x + (wa.width - b.width) / 2),
      y: Math.round(wa.y + wa.height - b.height - 90),
      width: b.width,
      height: b.height
    });
    persistOverlay();
    return overlay.getBounds();
  });
  ipcMain.handle('overlay:toggle', () => {
    if (!overlay) return false;
    if (overlay.isVisible()) {
      overlay.hide();
      resetHot();
    } else {
      overlay.show();
      resetHot();
    }
    return overlay.isVisible();
  });
  ipcMain.handle('overlay:show', () => {
    overlay?.show();
    resetHot();
    return true;
  });
  ipcMain.handle('panel:show', () => { showPanel(); return true; });
  ipcMain.handle('panel:hide', () => { panel?.hide(); return true; });
  // The panel's X follows the user's preference: park in the tray or quit.
  ipcMain.handle('panel:close', () => {
    if (settings.get().closeAction === 'quit') {
      app.quit();
      return { action: 'quit' };
    }
    let visible = false;
    if (panel && !panel.isDestroyed()) {
      panel.hide();
      visible = panel.isVisible();
    }
    notifyTray();
    return { action: 'tray', visible };
  });
  ipcMain.handle('app:quit', () => { app.quit(); });
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('shell:open', (_e, url) => { shell.openExternal(url); });

  // Dev-only full-desktop grab for visual verification; never registered in builds.
  if (!app.isPackaged) {
    ipcMain.handle('dev:shot', async (_e, out) => {
      const ds = screen.getAllDisplays();
      const w = Math.max(...ds.map(d => Math.round(d.size.width * d.scaleFactor)));
      const h = Math.max(...ds.map(d => Math.round(d.size.height * d.scaleFactor)));
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
      fs.writeFileSync(out, sources[0].thumbnail.toPNG());
      return out;
    });
    ipcMain.handle('dev:sampleAt', (_e, at) => eyedropper.sample({ at }));
  }
}

function applyLiveSettings(next, patch) {
  if (!overlay || overlay.isDestroyed()) return;
  if ('clickThrough' in patch) {
    // Full pass-through when enabled; otherwise the renderer re-enables the
    // window only over the text. Either way start from pass-through and let the
    // pointer decide.
    overlay.setIgnoreMouseEvents(true, { forward: true });
  }
  if ('locked' in patch) overlay.setMovable(!next.locked);
  if ('autoLaunch' in patch) {
    // Portable builds run from a per-launch temp dir; the launcher exposes the
    // real exe path here, otherwise the login item would point at a dead dir.
    const portable = process.env.PORTABLE_EXECUTABLE_FILE;
    app.setLoginItemSettings({
      openAtLogin: !!next.autoLaunch,
      path: portable || process.execPath,
      args: portable || app.isPackaged ? [] : [app.getAppPath()]
    });
  }
}

module.exports = { showPanel };