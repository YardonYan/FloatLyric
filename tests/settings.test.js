'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SETTINGS_VERSION, DEFAULTS, mergeSettings } = require('../electron/settings-migrate');

test('missing keys fall back to defaults', () => {
  const data = mergeSettings({ fontSize: 30 });
  assert.equal(data.fontSize, 30);
  assert.equal(data.baseColor, DEFAULTS.baseColor);
  assert.equal(data.settingsVersion, SETTINGS_VERSION);
});

test('shortcuts deep-merge keeps user binds and adds new ones', () => {
  const data = mergeSettings({ shortcuts: { toggle: 'Ctrl+T' } });
  assert.equal(data.shortcuts.toggle, 'Ctrl+T');
  assert.equal(data.shortcuts.panel, DEFAULTS.shortcuts.panel);
});

test('old file without version follows moved defaults', () => {
  // v1.0.0 shipped align 'center'; a stored 'center' means "never touched".
  const data = mergeSettings({ align: 'center' });
  assert.equal(data.align, DEFAULTS.align);
  assert.equal(data.align, 'left');
});

test('explicit user choices survive migration', () => {
  const data = mergeSettings({ align: 'right', bgOpacity: 0.4, baseColor: '#FF0000' });
  assert.equal(data.align, 'right');
  assert.equal(data.bgOpacity, 0.4);
  assert.equal(data.baseColor, '#FF0000');
});

test('already-migrated files are not migrated again', () => {
  // A user on the new default who deliberately picks the old value keeps it.
  const data = mergeSettings({ settingsVersion: SETTINGS_VERSION, align: 'center' });
  assert.equal(data.align, 'center');
});

test('null or garbage input yields pure defaults', () => {
  assert.deepEqual(mergeSettings(null), { ...DEFAULTS, shortcuts: { ...DEFAULTS.shortcuts }, settingsVersion: SETTINGS_VERSION });
  assert.equal(mergeSettings(undefined).fontSize, DEFAULTS.fontSize);
});