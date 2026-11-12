'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const settings = require('./settings');
const { NcmBridge } = require('./ncm');
const { fetchLyrics, parseLrc, clean } = require('./lyrics');
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
      log('boot done', ncmStatus);
    } catch (err) {
      log('BOOT ERROR', err && err.stack || String(err));
    }
  }).catch(err => log('READY ERROR', err && err.stack || String(err)));

  app.on('window-all-closed', e => e.preventDefault());
  app.on('before-quit', () => {
    settings.flush();
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
  bridge.on('state', s => broadcast('ncm:state', s));
  bridge.on('songchange', s => {
    log('songchange', s.title, s.artist, s.duration);
    currentSong = { title: s.title, artist: s.artist, duration: s.duration, cover: s.cover };
    loadLyrics(currentSong);
  });
  bridge.on('error', e => log('bridge error', e && e.message || e));
}

async function tryConnect() {
  ncmStatus = { phase: 'probing', detail: '' };
  broadcast('ncm:status', ncmStatus);
  const ok = await bridge.start();
  if (ok) {
    ncmStatus = { phase: 'connected', detail: '' };
  } else {
    const running = await require('./ncm').isNcmRunning();
    ncmStatus = {
      phase: running ? 'needs-restart' : 'not-running',
      detail: running ? '网易云已在运行，但未开启调试端口' : '网易云未运行'
    };
  }
  broadcast('ncm:status', ncmStatus);
}

async function loadLyrics(song) {
  const req = ++lyricRequest;
  broadcast('lyrics:loading', { title: song.title });

  const cache = settings.get().lyricCache || {};
  const key = `${song.title}|${song.artist}`;
  if (cache[key] && Array.isArray(cache[key].lines) && cache[key].lines.length) {
    log('lyrics cache hit', key, cache[key].lines.length);
    currentLyrics = cache[key];
    broadcast('lyrics:data', currentLyrics);
    return;
  }

  let r;
  try {
    r = await fetchLyrics(song.title, song.artist, song.duration);
  } catch (err) {
    log('LYRICS FETCH ERROR', err && err.stack || String(err));
    r = { lines: [], source: 'none' };
  }
  if (req !== lyricRequest) return;
  log('lyrics loaded', song.title, r.source, r.lines.length);
  currentLyrics = r;
  broadcast('lyrics:data', r);
  if (r.lines.length) {
    const next = { ...cache };
    const keys = Object.keys(next);
    if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete next[k];
    next[key] = { lines: r.lines, source: r.source };
    settings.set({ lyricCache: next });
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
  if (s.clickThrough) overlay.setIgnoreMouseEvents(true, { forward: true });
  if (s.locked) overlay.setMovable(false);
}

function persistOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  settings.set({ overlayBounds: overlay.getBounds() });
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

function registerShortcuts() {
  const safe = (accel, fn) => { try { globalShortcut.register(accel, fn); } catch {} };
  safe('Alt+L', () => { if (overlay) overlay.isVisible() ? overlay.hide() : overlay.show(); });
  safe('Alt+P', showPanel);
  safe('Alt+C', () => startPick());
  safe('Alt+Shift+L', () => {
    const locked = !settings.get().locked;
    settings.set({ locked });
    broadcast('settings:changed', settings.get());
  });
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

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
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
  void display;
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
    delete cache[`${currentSong.title}|${currentSong.artist}`];
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
  ipcMain.handle('overlay:toggle', () => {
    if (!overlay) return false;
    overlay.isVisible() ? overlay.hide() : overlay.show();
    return overlay.isVisible();
  });
  ipcMain.handle('overlay:show', () => { overlay?.show(); return true; });
  ipcMain.handle('panel:show', () => { showPanel(); return true; });
  ipcMain.handle('panel:hide', () => { panel?.hide(); return true; });
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
    overlay.setIgnoreMouseEvents(!!next.clickThrough, { forward: true });
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