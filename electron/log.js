'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const enabled = !app.isPackaged;
const FILE = path.join(__dirname, '..', '_logs', 'main.log');
if (enabled) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, '');
}

function log(...args) {
  if (!enabled) return;
  const line = `[${new Date().toISOString().slice(11, 23)}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
  try { fs.appendFileSync(FILE, line); } catch {}
}

function attach(win, name) {
  const wc = win.webContents;
  wc.on('console-message', (_e, level, message, line, source) => {
    log(`${name} console[${level}] ${message} (${source}:${line})`);
  });
  wc.on('did-fail-load', (_e, code, desc, url) => log(`${name} did-fail-load ${code} ${desc} ${url}`));
  wc.on('preload-error', (_e, p, err) => log(`${name} preload-error ${p} ${err && err.message}`));
  wc.on('render-process-gone', (_e, d) => log(`${name} render-process-gone ${JSON.stringify(d)}`));
  wc.on('did-finish-load', () => log(`${name} did-finish-load visible=${win.isVisible()} bounds=${JSON.stringify(win.getBounds())}`));
  win.on('show', () => log(`${name} show`));
  win.on('hide', () => log(`${name} hide`));
}

module.exports = { log, attach, FILE };