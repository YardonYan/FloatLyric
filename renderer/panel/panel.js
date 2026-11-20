'use strict';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let cfg = null;
let net = null, netAt = 0;
let bounds = null;
let phase = 'idle';
let lastSrc = 'ncm';
let lastConnDetail = '';

const PRESETS = ['#F2F4F8', '#FFD9A0', '#F6C6D0', '#A8D8FF', '#B8E6C8', '#D6C6FF', '#FFE066', '#FF9E8A'];

// 风格预设：一套面向 AI 编程工具 / 办公场景的观感参数，点击整套应用，之后仍可微调。
// followColor = true 表示不动颜色——取色针取过的话就是取到的那个色。
const STYLE_PRESETS = [
  { name: '正文模式', fontFamily: 'system', fontSize: 15, fontWeight: 400, bgOpacity: 0, glow: 0, textOpacity: 75, followColor: true },
  { name: 'VS Code', fontFamily: 'cascadia', fontSize: 14, fontWeight: 400, baseColor: '#D4D4D4', bgOpacity: 0, glow: 0, textOpacity: 85, followColor: true },
  { name: '终端 Codex', fontFamily: 'consolas', fontSize: 13, fontWeight: 400, baseColor: '#CCCCCC', bgOpacity: 0, glow: 0, textOpacity: 80, followColor: true },
  { name: '浅色 IDE', fontFamily: 'yahei', fontSize: 14, fontWeight: 400, baseColor: '#333333', bgOpacity: 0, glow: 0, textOpacity: 90, followColor: true },
  { name: 'Darcula', fontFamily: 'consolas', fontSize: 14, fontWeight: 400, baseColor: '#A9B7C6', bgOpacity: 0, glow: 0, textOpacity: 90, followColor: true },
  { name: '文档写作', fontFamily: 'dengxian', fontSize: 15, fontWeight: 400, baseColor: '#24292F', bgOpacity: 0, glow: 0, textOpacity: 100, followColor: false }
];

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
  $('textOpacity').value = cfg.textOpacity ?? 100;
  $('textOpacityVal').textContent = (cfg.textOpacity ?? 100) + '%';
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
  $('showStatsBadge').checked = !!cfg.showStatsBadge;
  $('demoEnabled').checked = cfg.demoEnabled !== false;
  $('smtcFallback').checked = cfg.smtcFallback !== false;
  $('diagnostics').checked = !!cfg.diagnostics;
  // 取色变化后，跟随取色的预设按钮色块同步更新。
  document.querySelectorAll('#stylePresets .style-preset').forEach((btn, i) => {
    const p = STYLE_PRESETS[i];
    if (p && p.followColor) {
      const dot = btn.querySelector('.sw i');
      if (dot) dot.style.background = cfg.baseColor;
    }
  });
  $('closeAction').value = cfg.closeAction || 'tray';
  $('btnQuit').title = cfg.closeAction === 'quit' ? '退出浮词' : '收起到托盘';
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

function setConn(p, detail) {
  phase = p;
  lastConnDetail = detail || '';
  applyConnDisplay();
}

// One renderer for the status pill: the phase from ncm:status events decides
// the default, but a live SMTC state overrides it — "following via the system
// media interface" reads as healthy, not as an error state.
function applyConnDisplay() {
  const el = $('conn');
  const labels = {
    idle: '未连接', probing: '检测中…', connected: '已跟随',
    reconnecting: '重连中…', launching: '启动中…',
    'needs-restart': '需重启网易云', 'not-running': '网易云未运行',
    'port-busy': '调试端口被占用', error: '连接失败'
  };
  const smtcLive = lastSrc === 'smtc' && net && net.ok && net.src === 'smtc';
  if (smtcLive) {
    el.dataset.phase = 'connected';
    $('connText').textContent = '已跟随 · 系统媒体';
  } else {
    el.dataset.phase = phase;
    $('connText').textContent = labels[phase] || phase;
  }
  const show = !smtcLive && phase !== 'connected' && phase !== 'probing';
  // While the first-run wizard is up it owns the connection story; the plain
  // block would just repeat it.
  $('connBlock').hidden = !show || !cfg.wizardDone;
  $('connNote').textContent = lastConnDetail || (
    phase === 'needs-restart' ? '网易云正在运行，但没有开启调试端口，浮词读不到播放进度。'
      : phase === 'not-running' ? '网易云没有运行。启动后浮词会自动开始跟随。'
      : phase === 'port-busy' ? `端口 ${cfg.cdpPort} 被其他程序占用，浮词无法读取播放进度。关闭占用它的程序，或重启浮词后再试。`
      : phase === 'error' ? '连接出错。' : ''
  );
}

// First-run wizard: one card that walks the user to a connected state. The
// status broadcast drives it, so the button label always matches what the next
// click will actually do.
function renderWizard() {
  const wiz = $('wizard');
  const show = !cfg.wizardDone;
  wiz.hidden = !show;
  if (!show) return;
  const btn = $('wzAction');
  const txt = $('wzText');
  btn.disabled = false;
  if (phase === 'connected') {
    $('wzStep').textContent = '完成';
    txt.textContent = '✓ 已连接，浮词正在跟随网易云播放。去挑一个喜欢的样式，然后开始听歌吧。';
    btn.textContent = '开始使用';
  } else if (phase === 'launching') {
    $('wzStep').textContent = '进行中';
    txt.textContent = '正在重启网易云并开启调试端口，通常需要几秒钟…';
    btn.textContent = '请稍候';
    btn.disabled = true;
  } else if (phase === 'probing') {
    $('wzStep').textContent = '进行中';
    txt.textContent = '正在检测网易云…';
    btn.textContent = '请稍候';
    btn.disabled = true;
  } else if (phase === 'needs-restart') {
    $('wzStep').textContent = '第一步';
    txt.textContent = '网易云已在运行，但还没开启调试端口，浮词读不到播放进度。点下面的按钮会自动重启网易云并带上调试参数（会先关闭当前的网易云）。';
    btn.textContent = '一键重启网易云并开启调试';
  } else if (phase === 'port-busy') {
    $('wzStep').textContent = '第一步';
    txt.textContent = `调试端口 ${cfg.cdpPort} 被另一个程序占用了。关闭占用它的程序后再试，或重启浮词。`;
    btn.textContent = '重新检测';
  } else if (phase === 'not-running') {
    $('wzStep').textContent = '第一步';
    txt.textContent = '网易云还没有运行。点下面的按钮，浮词会以调试模式启动它——只需这一次，之后浮词会自动跟随每一首歌。';
    btn.textContent = '一键启动网易云（调试模式）';
  } else {
    $('wzStep').textContent = '第一步';
    txt.textContent = '先把网易云连上浮词，歌词条才会开始显示歌词。';
    btn.textContent = '重新检测';
  }
}

function fmtDurCn(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (total === 0) return '不到 1 分钟';
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function updateTodayBar(d) {
  const bar = $('todaybar');
  if (!d || (!d.ms && !d.count)) { bar.hidden = true; return; }
  bar.hidden = false;
  $('tbDur').textContent = fmtDurCn(d.ms || 0);
  $('tbCnt').textContent = d.count || 0;
  const top = d.top;
  const el = $('tbTop');
  if (top) {
    el.textContent = `《${top.title}》`;
    el.title = `《${top.title}》${top.artist ? ' — ' + top.artist : ''} · 今天听了 ${top.count} 次，约 ${fmtDurCn(top.ms)}`;
  } else {
    el.textContent = '最常听：—';
    el.title = '';
  }
}

function ingestState(s) {
  net = s; netAt = performance.now();
  lastSrc = s && s.src === 'smtc' ? 'smtc' : 'ncm';
  applyConnDisplay();
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
const PROGRESS_FRAME_MS = 250;
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
    delay = net.playing ? PROGRESS_FRAME_MS : PAUSED_FRAME_MS;
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
  const st0 = await window.fl.ncm.status();
  setConn(st0.phase, st0.detail);
  renderWizard();
  const st = await window.fl.ncm.state();
  if (st) ingestState(st);
  const ly = await window.fl.lyrics.current();
  if (ly) showSource(ly);

  window.fl.on.ncmState(ingestState);
  window.fl.on.ncmStatus(s => { setConn(s.phase, s.detail); renderWizard(); });
  window.fl.on.lyricsData(showSource);
  window.fl.on.settings(next => { cfg = next; syncControls(); renderWizard(); });
  window.fl.on.pickEnded(() => refreshBounds());
  window.fl.on.statsToday(d => updateTodayBar(d));
  // Pull on the same 30s cadence as the stats window so the bar always matches it.
  window.fl.stats.data().then(d => {
    if (d) updateTodayBar({ ms: d.today.ms, count: d.today.count, top: d.todayTop });
  });
  setInterval(async () => {
    if (document.hidden) return;
    const d = await window.fl.stats.data();
    if (d) updateTodayBar({ ms: d.today.ms, count: d.today.count, top: d.todayTop });
  }, 30000);
  $('todaybar').onclick = () => window.fl.stats.open();
  // Manual lyric source switching.
  $('btnSearchLyrics').onclick = () => {
    const box = $('searchBox');
    box.hidden = !box.hidden;
    if (!box.hidden && $('songTitle').textContent !== '未在播放') {
      $('searchInput').value = $('songTitle').textContent;
    }
  };
  $('btnDoSearch').onclick = async () => {
    const q = $('searchInput').value.trim();
    if (!q) return;
    const btn = $('btnDoSearch');
    btn.textContent = '搜索中…';
    const list = await window.fl.lyrics.search(q).catch(() => []);
    btn.textContent = '搜索';
    const host = $('searchResults');
    host.textContent = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '没有找到结果';
      host.appendChild(li);
      return;
    }
    list.forEach(s => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = s.name;
      const a = document.createElement('span');
      a.className = 'a';
      a.textContent = s.artists + (s.album ? ` · ${s.album}` : '');
      name.append(t, a);
      name.title = `${s.name} — ${s.artists}${s.album ? ' · ' + s.album : ''}`;
      const use = document.createElement('button');
      use.className = 'btn';
      use.textContent = '使用';
      use.onclick = async () => {
        const r = await window.fl.lyrics.pick(s.id).catch(() => null);
        if (r) { showSource(r); $('searchBox').hidden = true; host.textContent = ''; }
      };
      li.append(name, use);
      host.appendChild(li);
    });
  };
  window.fl.on.overlayBounds(b => {
    if (!b) return;
    bounds = b;
    $('ovWidth').value = b.width;
    $('ovHeight').value = b.height;
  });

  $('btnHide').onclick = () => window.fl.panel.hide();
  $('btnQuit').onclick = () => window.fl.panel.close();
  $('btnPick').onclick = () => window.fl.pick.start();
  $('btnLaunch').onclick = async () => { setConn('launching'); await window.fl.ncm.launch(); };
  $('btnReconnect').onclick = async () => { setConn('probing'); await window.fl.ncm.reconnect(); };

  $('wzAction').onclick = async () => {
    if (phase === 'connected') {
      await window.fl.settings.set({ wizardDone: true });
    } else if (phase === 'needs-restart' || phase === 'not-running') {
      setConn('launching');
      await window.fl.ncm.launch();
    } else {
      setConn('probing');
      await window.fl.ncm.reconnect();
    }
  };
  $('wzSkip').onclick = () => window.fl.settings.set({ wizardDone: true });

  $('btnPrev').onclick = () => window.fl.ncm.control('prev');
  $('btnNext').onclick = () => window.fl.ncm.control('next');
  $('btnToggle').onclick = () => window.fl.ncm.control('toggle');

  $('colorInput').oninput = e => set({ baseColor: e.target.value });
  $('shade').oninput = e => { cfg.shade = +e.target.value; $('shadeVal').textContent = (cfg.shade > 0 ? '+' : '') + cfg.shade; paintColor(); window.fl.settings.set({ shade: cfg.shade }); };
  $('fontSize').oninput = e => { cfg.fontSize = +e.target.value; $('fontSizeVal').textContent = cfg.fontSize + ' px'; window.fl.settings.set({ fontSize: cfg.fontSize }); };
  $('bgOpacity').oninput = e => { cfg.bgOpacity = +e.target.value / 100; $('bgOpacityVal').textContent = e.target.value + '%'; window.fl.settings.set({ bgOpacity: cfg.bgOpacity }); };
  $('glow').oninput = e => { cfg.glow = +e.target.value / 100; $('glowVal').textContent = e.target.value + '%'; window.fl.settings.set({ glow: cfg.glow }); };
  $('textOpacity').oninput = e => { cfg.textOpacity = +e.target.value; $('textOpacityVal').textContent = e.target.value + '%'; window.fl.settings.set({ textOpacity: cfg.textOpacity }); };
  $('offsetMs').oninput = e => { cfg.offsetMs = +e.target.value; $('offsetVal').textContent = (cfg.offsetMs > 0 ? '+' : '') + cfg.offsetMs + ' ms'; window.fl.settings.set({ offsetMs: cfg.offsetMs }); };

  $('offMinus').onclick = () => set({ offsetMs: clamp(cfg.offsetMs - 100, -3000, 3000) });
  $('offPlus').onclick = () => set({ offsetMs: clamp(cfg.offsetMs + 100, -3000, 3000) });
  $('offReset').onclick = () => set({ offsetMs: 0 });

  $('fontFamily').onchange = e => set({ fontFamily: e.target.value });
  $('fontWeight').onchange = e => set({ fontWeight: +e.target.value });

  for (const [id, key] of [['showTranslation', 'showTranslation'], ['showContext', 'showContext'], ['showProgressBar', 'showProgressBar'], ['locked', 'locked'], ['clickThrough', 'clickThrough'], ['autoLaunch', 'autoLaunch'], ['showStatsBadge', 'showStatsBadge'], ['demoEnabled', 'demoEnabled'], ['smtcFallback', 'smtcFallback'], ['diagnostics', 'diagnostics']]) {
    $(id).onchange = e => set({ [key]: e.target.checked });
  }

  $('closeAction').onchange = e => set({ closeAction: e.target.value });

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

  function renderStylePresets() {
    const host = $('stylePresets');
    host.textContent = '';
    for (const p of STYLE_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'style-preset';
      btn.title = `${p.name}：${p.fontSize}px、${p.fontWeight === 400 ? '常规' : '加粗'}、文字浓度 ${p.textOpacity}%${p.followColor ? '、颜色跟随取色针' : ''}。点击应用，之后仍可微调。`;
      const sw = document.createElement('span');
      sw.className = 'sw';
      const c1 = document.createElement('i');
      c1.style.background = p.followColor ? (cfg.baseColor || '#3D434B') : p.baseColor;
      sw.appendChild(c1);
      const pname = document.createElement('span');
      pname.className = 'pname';
      pname.textContent = p.name;
      btn.append(sw, pname);
      btn.onclick = () => {
        const patch = {
          fontFamily: p.fontFamily,
          fontSize: p.fontSize,
          fontWeight: p.fontWeight,
          bgOpacity: p.bgOpacity,
          glow: p.glow,
          textOpacity: p.textOpacity
        };
        if (!p.followColor) patch.baseColor = p.baseColor;
        set(patch);
      };
      host.appendChild(btn);
    }
  }
  renderStylePresets();

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
  $('btnStats').onclick = () => window.fl.stats.open();
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