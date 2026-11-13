'use strict';

const globals = require('globals');

const rules = {
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'error',
  'no-fallthrough': 'error',
  'no-constant-condition': 'warn',
  'no-async-promise-executor': 'error',
  'no-useless-escape': 'warn',
  'no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^_' }]
};

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', '_logs/**', 'preview/**', 'research/**', 'scripts/**', 'tools/**'] },
  {
    files: ['electron/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, WebSocket: 'readonly' }
    },
    rules
  },
  {
    files: ['renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser, Color: 'readonly', Fonts: 'readonly', module: 'readonly' }
    },
    rules
  },
  {
    // Injected into the NetEase page, so it runs in a browser, not in Node.
    files: ['electron/extract.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules
  }
];