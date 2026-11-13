'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { DEFAULTS, mergeSettings } = require('./settings-migrate');

let file = null;
let data = { ...DEFAULTS };
let writeTimer = null;

function init() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      data = mergeSettings(saved);
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