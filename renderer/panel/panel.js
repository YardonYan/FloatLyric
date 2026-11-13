'use strict';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let cfg = null;
let net = null, netAt = 0;
let bounds = null;

const PRESETS = ['#F2F4F8', '#FFD9A0', '#F6C6D0', '#A8D8FF', '#B8E6C8', '#D6C6FF', '#FFE066', '#FF9E8A'];

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

function effective() { return Color.shade(cfg.baseColor, cfg.shade); }

function paintShadeTrack() {
  const stops = [];
  for (let i = 0; i <= 10; i++) {
    const d = -100 + i * 20;
    stops.push(`${Color.shade(cfg.baseColor, d)} ${i * 10}%`);
  }
  $('shade').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
}

function paintColor() {
  const hex = effective();
  $('swatchBig').style.setProperty('--sw', hex);
  $('hexVal').textContent = hex.toUpperCase();
  $('colorInput').value = /^#[0-9a-f]{6}$/i.test(cfg.baseColor) ? cfg.baseColor : '#f2f4f8';
  paintShadeTrack();
  for (const b of document.querySelectorAll('.pre')) {
    b.classList.toggle('on', b.dataset.hex.toLowerCase() === String(cfg.baseColor).toLowerCase());
  }
}

function syncControls() {
  $('fontSize').value = cfg.fontSize;
  $('fontSizeVal').textContent = cfg.fontSize + ' px';
  $('shade').value = cfg.shade;
  $('shadeVal').textContent = (cfg.shade > 0 ? '+' : '') + cfg.shade;
  $('bgOpacity').value = Math.round(cfg.bgOpacity * 100);
  $('bgOpacityVal').textContent = Math.round(cfg.bgOpacity * 100) + '%';
  $('glow').value = Math.round(cfg.glow * 100);
  $('glowVal').textContent = Math.round(cfg.glow * 100) + '%';
  $('offsetMs').value = cfg.offsetMs;
  $('offsetVal').textContent = (cfg.offsetMs > 0 ? '+' : '') + cfg.offsetMs + ' ms';
  $('fontFamily').value = cfg.fontFamily || 'system';
  $('fontWeight').value = String(cfg.fontWeight);
  $('showTranslation').checked = !!cfg.showTranslation;
  $('showContext').checked = !!cfg.showContext;
  $('showProgressBar').checked = cfg.showProgressBar !== false;
  $('locked').checked = !!cfg.locked;
  $('clickThrough').checked = !!cfg.clickThrough;
  $('autoLaunch').checked = !!cfg.autoLaunch;
  if (bounds) { $('ovWidth').value = bounds.width; $('ovHeight').value = bounds.height; }
  syncShortcuts();
  paintColor();
}

const DEFAULT_SHORTCUTS = { toggle: 'Alt+L', panel: 'Alt+P', pick: 'Alt+C', lock: 'Alt+Shift+L' };
const KEY_ALIAS = {
  ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Enter: 'Return', '+': 'Plus', '-': 'Minus'
};
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'];
const NAMED_KEYS = ['Space', 'Up', 'Down', 'Left', 'Right', 'Return', 'Tab', 'Backspace', 'Delete',
  'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'];

function syncShortcuts() {
  const sc = { ...DEFAULT_SHORTCUTS, ...(cfg.shortcuts || {}) };
  for (const input of document.querySelectorAll('.sc-input')) {
    input.value = sc[input.dataset.action] || '';
  }
  const kbd = document.querySelector('#btnPick kbd');
  if (kbd) kbd.textContent = sc.pick || '—';
}

function accelFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  if (!parts.length) return null;
  const k = e.key;
  if (MODIFIERS.includes(k)) return null;
  let key = KEY_ALIAS[k] || k;
  if (key.length === 1) key = key.toUpperCase();
  else if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase();
  else if (!NAMED_KEYS.includes(key)) return null;
  return parts.concat(key).join('+');
}

let hintTimer = null;
const SC_HINT = '点击输入框后按下新的组合键（需含 Alt / Ctrl / Shift），Esc 取消。留空表示不注册。';

function showScHint(msg, bad) {
  const el = $('scHint');
  el.textContent = msg;
  el.style.color = bad ? '#ff9b8f' : '';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    el.textContent = SC_HINT;
    el.style.color = '';
  }, 4000);
}

const set = patch => window.fl.settings.set(patch).then(next => { cfg = next; syncControls(); });

function setConn(phase, detail) {
  const el = $('conn');
  el.dataset.phase = phase;
  const labels = {
    idle: '未连接', probing: '检测中…', connected: '已跟随',
    reconnecting: '重连中…', launching: '启动中…',
    'needs-restart': '需重启网易云', 'not-running': '网易云未运行', error: '连接失败'
  };
  $('connText').textContent = labels[phase] || phase;
  const show = phase !== 'connected' && phase !== 'probing';
  $('connBlock').hidden = !show;
  $('connNote').textContent = detail || (
    phase === 'needs-restart' ? '网易云正在运行，但没有开启调试端口，浮词读不到播放进度。'
      : phase === 'not-running' ? '网易云没有运行。启动后浮词会自动开始跟随。'
      : phase === 'error' ? '连接出错。' : ''
  );
}

function ingestState(s) {
  net = s; netAt = performance.now();
  if (!s || !s.ok) {
    $('songTitle').textContent = '未在播放';
    $('songArtist').textContent = '连接网易云后自动跟随';
    $('icoPlay').style.display = '';
    $('icoPause').style.display = 'none';
    $('barFill').style.width = '0%';
    $('tCur').textContent = '0:00';
    $('tDur').textContent = '0:00';
    return;
  }
  $('songTitle').textContent = s.title || '未知歌曲';
  $('songArtist').textContent = s.artist || '未知歌手';
  $('icoPlay').style.display = s.playing ? 'none' : '';
  $('icoPause').style.display = s.playing ? '' : 'none';
  $('tDur').textContent = fmtTime(s.duration || 0);
  if (s.cover) {
    // NetEase hands back http:// cover URLs; the CSP only allows https.
    const url = String(s.cover).replace(/^http:\/\//i, 'https://');
    $('cover').style.backgroundImage = `url("${url}")`;
    $('cover').classList.add('has-img');
  } else {
    $('cover').style.backgroundImage = '';
    $('cover').classList.remove('has-img');
  }
}

const PAUSED_FRAME_MS = 500;
const IDLE_FRAME_MS = 1000;
let frameTimer = null;
let frameRaf = null;

function stopLoop() {
  if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
  if (frameRaf) { cancelAnimationFrame(frameRaf); frameRaf = null; }
}

function scheduleLoop(delay) {
  stopLoop();
  if (document.hidden) return;
  if (delay > 0) {
    frameTimer = setTimeout(() => {
      frameTimer = null;
      frameRaf = requestAnimationFrame(tick);
    }, delay);
  } else {
    frameRaf = requestAnimationFrame(tick);
  }
}

function tick() {
  frameRaf = null;
  let delay = IDLE_FRAME_MS;
  if (net && net.ok) {
    let p = net.position || 0;
    if (net.playing) p += (performance.now() - netAt) / 1000;
    $('tCur').textContent = fmtTime(p);
    if (net.duration) $('barFill').style.width = (clamp(p / net.duration, 0, 1) * 100).toFixed(2) + '%';
    delay = net.playing ? 0 : PAUSED_FRAME_MS;
  }
  scheduleLoop(delay);
}

function buildPresets() {
  const host = $('presets');
  host.textContent = '';
  for (const hex of PRESETS) {
    const b = document.createElement('button');
    b.className = 'pre';
    b.dataset.hex = hex;
    b.style.background = hex;
    b.title = hex;
    b.onclick = () => set({ baseColor: hex });
    host.appendChild(b);
  }
}

async function refreshBounds() {
  bounds = await window.fl.overlay.bounds();
  if (bounds) { $('ovWidth').value = bounds.width; $('ovHeight').value = bounds.height; }
}

async function init() {
  cfg = await window.fl.settings.get();
  buildPresets();
  syncControls();
  await refreshBounds();

  $('ver').textContent = 'v' + await window.fl.app.version();
  setConn((await window.fl.ncm.status()).phase);
  const st = await window.fl.ncm.state();
  if (st) ingestState(st);
  const ly = await window.fl.lyrics.current();
  if (ly) showSource(ly);

  window.fl.on.ncmState(ingestState);
  window.fl.on.ncmStatus(s => setConn(s.phase, s.detail));
  window.fl.on.lyricsData(showSource);
  window.fl.on.settings(next => { cfg = next; syncControls(); });
  window.fl.on.pickEnded(() => refreshBounds());
  window.fl.on.overlayBounds(b => {
    if (!b) return;
    bounds = b;
    $('ovWidth').value = b.width;
    $('ovHeight').value = b.height;
  });

  $('btnHide').onclick = () => window.fl.panel.hide();
  $('btnQuit').onclick = () => window.fl.app.quit();
  $('btnPick').onclick = () => window.fl.pick.start();
  $('btnLaunch').onclick = async () => { setConn('launching'); await window.fl.ncm.launch(); };
  $('btnReconnect').onclick = async () => { setConn('probing'); await window.fl.ncm.reconnect(); };

  $('btnPrev').onclick = () => window.fl.ncm.control('prev');
  $('btnNext').onclick = () => window.fl.ncm.control('next');
  $('btnToggle').onclick = () => window.fl.ncm.control('toggle');

  $('colorInput').oninput = e => set({ baseColor: e.target.value });
  $('shade').oninput = e => { cfg.shade = +e.target.value; $('shadeVal').textContent = (cfg.shade > 0 ? '+' : '') + cfg.shade; paintColor(); window.fl.settings.set({ shade: cfg.shade }); };
  $('fontSize').oninput = e => { cfg.fontSize = +e.target.value; $('fontSizeVal').textContent = cfg.fontSize + ' px'; window.fl.settings.set({ fontSize: cfg.fontSize }); };
  $('bgOpacity').oninput = e => { cfg.bgOpacity = +e.target.value / 100; $('bgOpacityVal').textContent = e.target.value + '%'; window.fl.settings.set({ bgOpacity: cfg.bgOpacity }); };
  $('glow').oninput = e => { cfg.glow = +e.target.value / 100; $('glowVal').textContent = e.target.value + '%'; window.fl.settings.set({ glow: cfg.glow }); };
  $('offsetMs').oninput = e => { cfg.offsetMs = +e.target.value; $('offsetVal').textContent = (cfg.offsetMs > 0 ? '+' : '') + cfg.offsetMs + ' ms'; window.fl.settings.set({ offsetMs: cfg.offsetMs }); };

  $('offMinus').onclick = () => set({ offsetMs: clamp(cfg.offsetMs - 100, -3000, 3000) });
  $('offPlus').onclick = () => set({ offsetMs: clamp(cfg.offsetMs + 100, -3000, 3000) });
  $('offReset').onclick = () => set({ offsetMs: 0 });

  $('fontFamily').onchange = e => set({ fontFamily: e.target.value });
  $('fontWeight').onchange = e => set({ fontWeight: +e.target.value });

  for (const [id, key] of [['showTranslation', 'showTranslation'], ['showContext', 'showContext'], ['showProgressBar', 'showProgressBar'], ['locked', 'locked'], ['clickThrough', 'clickThrough'], ['autoLaunch', 'autoLaunch']]) {
    $(id).onchange = e => set({ [key]: e.target.checked });
  }

  for (const input of document.querySelectorAll('.sc-input')) {
    input.addEventListener('focus', () => input.classList.add('capturing'));
    input.addEventListener('blur', () => input.classList.remove('capturing'));
    input.addEventListener('keydown', e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { input.blur(); return; }
      const action = input.dataset.action;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        set({ shortcuts: { ...(cfg.shortcuts || {}), [action]: '' } });
        return;
      }
      const accel = accelFromEvent(e);
      if (!accel) { showScHint('需要至少一个修饰键，例如 Alt+L', true); return; }
      set({ shortcuts: { ...(cfg.shortcuts || {}), [action]: accel } });
    });
  }
  window.fl.on.shortcutsFailed(list => showScHint(`这些快捷键已被其他程序占用：${list.join('、')}`, true));

  $('btnRefetch').onclick = async () => {
    $('lyricSource').textContent = '歌词来源：重新搜索中…';
    showSource(await window.fl.lyrics.refetch());
  };
  $('btnImport').onclick = () => $('lrcFile').click();
  $('lrcFile').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    showSource(await window.fl.lyrics.fromText(text));
    e.target.value = '';
  };

  $('ovWidth').onchange = e => window.fl.overlay.bounds({ width: +e.target.value }).then(refreshBounds);
  $('ovHeight').onchange = e => window.fl.overlay.bounds({ height: +e.target.value }).then(refreshBounds);
  $('btnCenter').onclick = async () => {
    bounds = await window.fl.overlay.center();
    if (bounds) { $('ovWidth').value = bounds.width; $('ovHeight').value = bounds.height; }
  };
  $('btnToggleOverlay').onclick = () => window.fl.overlay.toggle();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop(); else scheduleLoop(0);
  });
  scheduleLoop(0);
}

function showSource(ly) {
  const names = { netease: '网易云', lrclib: 'LRCLIB', manual: '手动导入', instrumental: '纯音乐', none: '未找到' };
  const n = ly && ly.lines ? ly.lines.length : 0;
  $('lyricSource').textContent = `歌词来源：${names[ly?.source] || '—'}${n ? ` · ${n} 句` : ''}${ly?.matched ? ` · 匹配「${ly.matched}」` : ''}`;
}

init();