'use strict';

// Pure settings schema: defaults, version and migrations. Kept free of
// electron/fs so the merge rules can be unit-tested with plain node.

const SETTINGS_VERSION = 1;

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

// One entry per settings version that changed a default. `resets` lists the
// keys whose default moved, with the OLD default as the match value: a stored
// value equal to the old default is treated as "never touched" and follows the
// new default; anything else is an explicit user choice and is kept.
const MIGRATIONS = [
  {
    version: 1,
    resets: [
      { key: 'align', oldDefault: 'center' }
    ]
  }
];

function mergeSettings(saved) {
  const data = { ...DEFAULTS, ...(saved || {}) };
  // Nested maps need a deep merge, otherwise an older settings file would
  // drop newly added defaults entirely.
  data.shortcuts = { ...DEFAULTS.shortcuts, ...((saved && saved.shortcuts) || {}) };
  const from = Number.isInteger(saved?.settingsVersion) ? saved.settingsVersion : 0;
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    for (const { key, oldDefault } of m.resets) {
      if (data[key] === oldDefault) data[key] = DEFAULTS[key];
    }
  }
  data.settingsVersion = SETTINGS_VERSION;
  return data;
}

module.exports = { SETTINGS_VERSION, DEFAULTS, MIGRATIONS, mergeSettings };