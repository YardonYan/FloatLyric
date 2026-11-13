'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  fontSize: 22,
  fontWeight: 400,
  fontFamily: 'system',
  baseColor: '#3D434B',
  shade: 0,
  bgOpacity: 0,
  bgMode: 'auto',
  glow: 0,
  align: 'left',
  showContext: false,
  showTranslation: true,
  translationScale: 0.52,
  offsetMs: 0,
  locked: false,
  clickThrough: false,
  showProgressBar: false,
  autoLaunch: false,
  closeAction: 'tray',
  shortcuts: {
    toggle: 'Alt+L',
    panel: 'Alt+P',
    pick: 'Alt+C',
    lock: 'Alt+Shift+L'
  },
  cdpPort: 9222,
  overlayBounds: null,
  panelBounds: null,
  lyricCache: {}
};

let file = null;
let data = { ...DEFAULTS };
let writeTimer = null;

function init() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      data = { ...DEFAULTS, ...saved };
      // Nested maps need a deep merge, otherwise an older settings file would
      // drop newly added defaults entirely.
      data.shortcuts = { ...DEFAULTS.shortcuts, ...(saved.shortcuts || {}) };
    }
  } catch { data = { ...DEFAULTS }; }
  return data;
}

function get() { return data; }

function set(patch) {
  data = { ...data, ...patch };
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 350);
  return data;
}

function flush() {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {}
}

module.exports = { init, get, set, flush, DEFAULTS };