'use strict';

const $ = id => document.getElementById(id);
const stage = $('stage'), pane = $('pane'), lineEl = $('line'), trEl = $('tr');
const ctxPrev = $('ctxPrev'), ctxNext = $('ctxNext'), idleText = $('idleText');
const progressFill = $('progressFill');

let cfg = null;
let lyrics = { lines: [], source: 'none' };
let net = null;            // last state from main
let netAt = 0;             // performance.now() when it arrived
let idx = -1;
let previewHex = null;
let offsetMs = 0;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function lyricColor() {
  const base = previewHex || cfg.baseColor;
  return Color.shade(base, cfg.shade);
}

function applyTheme() {
  const hex = lyricColor();
  const { L, C, H } = Color.hexToOklch(hex);
  const light = L > 0.62;

  // Pane tint follows the picked hue at very low chroma, so the whole object
  // feels like one material. Dark lyrics get a light pane and vice versa.
  const paneL = light ? 0.185 : 0.925;
  const paneC = Math.min(C * 0.2, 0.024);
  const top = Color.oklchToHex(clamp(paneL + (light ? 0.05 : 0.02), 0, 1), paneC, H);
  const bot = Color.oklchToHex(clamp(paneL - (light ? 0.045 : 0.03), 0, 1), paneC, H);

  const dim = Color.oklchToHex(clamp(light ? L * 0.74 : L * 0.82, 0.05, 0.98), C * 0.8, H);
  const faint = Color.oklchToHex(clamp(light ? L * 0.5 : L * 0.62, 0.05, 0.98), C * 0.6, H);

  const haloCol = light ? '0,0,0' : '255,255,255';
  const g = clamp(cfg.glow, 0, 1);
  // glow 0 = bare type, exactly like a sentence typed on the desktop.
  const halo = g === 0 ? 'none' : `0 0 1px rgba(${haloCol},.5), 0 0 ${Math.round(10 + g * 22)}px rgba(${haloCol},${(0.30 + g * 0.34).toFixed(3)}), 0 1px 2px rgba(${haloCol},${(0.42 + g * 0.2).toFixed(3)})`;
  const haloSoft = g === 0 ? 'none' : `0 1px 2px rgba(${haloCol},.34)`;
  const paneOpacity = clamp(cfg.bgOpacity, 0, 1);
  const scrimA = (light ? 0.34 : 0.40) * paneOpacity;

  const s = pane.style;
  s.setProperty('--fs', cfg.fontSize + 'px');
  s.setProperty('--fw', String(cfg.fontWeight));
  lineEl.style.fontFamily = Fonts.stack(cfg.fontFamily);
  trEl.style.fontFamily = Fonts.stack(cfg.fontFamily);
  s.setProperty('--tr-scale', String(cfg.translationScale));
  s.setProperty('--lyric', hex);
  s.setProperty('--lyric-dim', Color.withAlpha(dim, 0.88));
  s.setProperty('--lyric-faint', Color.withAlpha(faint, 0.62));
  s.setProperty('--halo', halo);
  s.setProperty('--halo-soft', haloSoft);
  s.setProperty('--pane-bg', `linear-gradient(180deg, ${top}, ${bot})`);
  s.setProperty('--pane-edge', light ? 'rgba(255,255,255,.075)' : 'rgba(0,0,0,.09)');
  s.setProperty('--sheen', light ? 'rgba(255,255,255,.11)' : 'rgba(255,255,255,.55)');
  s.setProperty('--pane-opacity', String(paneOpacity));
  s.setProperty('--scrim', `rgba(${haloCol},${scrimA.toFixed(3)})`);
  s.setProperty('--prog-track', light ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.10)');
  s.setProperty('--prog-fill', Color.withAlpha(hex, light ? 0.5 : 0.42));
  s.setProperty('--hud-bg', light ? 'rgba(16,18,24,.62)' : 'rgba(255,255,255,.66)');
  s.setProperty('--hud-edge', light ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)');
  s.setProperty('--hud-ink', light ? 'rgba(238,241,246,.82)' : 'rgba(24,27,34,.76)');
  s.setProperty('--hud-ink-hi', light ? '#fff' : '#0d0f14');
  s.setProperty('--hud-hover', light ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.09)');

  document.body.classList.toggle('show-ctx', !!cfg.showContext);
  document.body.classList.toggle('show-progress', cfg.showProgressBar !== false);
  document.body.classList.toggle('is-locked', !!cfg.locked);
  $('btnLock').classList.toggle('on', !!cfg.locked);
}

function positionNow() {
  if (!net || !net.ok) return 0;
  let p = net.position ?? 0;
  if (net.playing) p += (performance.now() - netAt) / 1000;
  return p + offsetMs / 1000;
}

function lineAt(t) {
  const L = lyrics.lines;
  if (!L.length) return -1;
  let lo = 0, hi = L.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (L[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function fit() {
  const main = document.querySelector('.main');
  main.style.setProperty('--fit', '1');
  const avail = pane.clientWidth - 40;
  if (avail <= 40) return;
  const w = Math.max(lineEl.scrollWidth, trEl.scrollWidth);
  if (w > avail) main.style.setProperty('--fit', String(Math.max(0.42, avail / w)));
}

function renderLine(i, animate) {
  const L = lyrics.lines;
  const cur = i >= 0 ? L[i] : null;
  const text = cur ? cur.text : '';
  const tr = cfg.showTranslation && cur && cur.tr ? cur.tr : '';

  if (lineEl.textContent !== text) {
    lineEl.textContent = text;
    if (animate && text) {
      lineEl.classList.remove('enter');
      void lineEl.offsetWidth;
      lineEl.classList.add('enter');
    }
  }
  if (trEl.textContent !== tr) {
    trEl.textContent = tr;
    if (animate && tr) {
      trEl.classList.remove('enter');
      void trEl.offsetWidth;
      trEl.classList.add('enter');
    }
  }

  if (cfg.showContext) {
    let p = i - 1;
    while (p >= 0 && !L[p].text) p--;
    let n = i + 1;
    while (n < L.length && !L[n].text) n++;
    ctxPrev.textContent = p >= 0 ? L[p].text : '';
    ctxNext.textContent = n < L.length ? L[n].text : '';
  } else {
    ctxPrev.textContent = '';
    ctxNext.textContent = '';
  }

  requestAnimationFrame(fit);
}

function setIdle(msg) {
  document.body.classList.add('is-idle');
  idleText.textContent = msg;
}

function tick() {
  if (!net || !net.ok) {
    if (!document.body.classList.contains('is-idle')) setIdle('等待网易云播放');
    requestAnimationFrame(tick);
    return;
  }
  const t = positionNow();
  if (net.duration) {
    progressFill.style.width = (clamp(t / net.duration, 0, 1) * 100).toFixed(2) + '%';
  }

  if (!lyrics.lines.length) {
    const msg = lyrics.source === 'loading' ? '正在找歌词…' : '这首歌没有歌词';
    if (idleText.textContent !== msg || !document.body.classList.contains('is-idle')) setIdle(msg);
    requestAnimationFrame(tick);
    return;
  }

  document.body.classList.remove('is-idle');
  const i = lineAt(t);
  if (i !== idx) {
    const first = idx === -1;
    idx = i;
    renderLine(i, !first);
  }
  requestAnimationFrame(tick);
}

function ingestState(s) {
  net = s;
  netAt = performance.now();
  if (!s || !s.ok) { idx = -1; }
}

function ingestLyrics(r) {
  lyrics = r && Array.isArray(r.lines) ? r : { lines: [], source: 'none' };
  idx = -1;
  renderLine(lineAt(positionNow()), false);
}

async function init() {
  cfg = await window.fl.settings.get();
  offsetMs = cfg.offsetMs || 0;
  applyTheme();

  const [st, ly, ncm] = await Promise.all([
    window.fl.ncm.status(), window.fl.lyrics.current(), window.fl.ncm.state()
  ]);
  if (ncm) ingestState(ncm);
  if (ly) ingestLyrics(ly);
  void st;

  window.fl.on.ncmState(ingestState);
  window.fl.on.lyricsData(ingestLyrics);
  window.fl.on.lyricsLoading(() => { lyrics = { lines: [], source: 'loading' }; idx = -1; });
  window.fl.on.settings(next => {
    const refit = next.fontSize !== cfg.fontSize || next.showTranslation !== cfg.showTranslation;
    cfg = next;
    offsetMs = next.offsetMs || 0;
    applyTheme();
    if (refit) { idx = -1; renderLine(lineAt(positionNow()), false); }
  });
  window.fl.on.pickPreview(p => {
    previewHex = p ? p.hex : null;
    applyTheme();
  });
  window.fl.on.pickStarted(() => document.body.classList.add('is-picking'));
  window.fl.on.pickEnded(() => { document.body.classList.remove('is-picking'); previewHex = null; applyTheme(); });

  $('btnPick').onclick = () => window.fl.pick.start();
  $('btnPanel').onclick = () => window.fl.panel.show();
  $('btnSmaller').onclick = () => window.fl.settings.set({ fontSize: clamp(cfg.fontSize - 2, 14, 96) });
  $('btnBigger').onclick = () => window.fl.settings.set({ fontSize: clamp(cfg.fontSize + 2, 14, 96) });
  $('btnLock').onclick = () => window.fl.settings.set({ locked: !cfg.locked });

  wireGrip();
  window.addEventListener('resize', () => requestAnimationFrame(fit));
  requestAnimationFrame(tick);
}

function wireGrip() {
  const grip = $('grip');
  let start = null;
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    // Capture keeps move/up flowing even when the pointer leaves the window;
    // a plain window mouseup listener is lost out there and leaves a runaway
    // resize armed.
    grip.setPointerCapture(e.pointerId);
    start = { sx: e.screenX, sy: e.screenY, w: window.outerWidth, h: window.outerHeight };
  });
  grip.addEventListener('pointermove', e => {
    if (!start) return;
    const w = clamp(start.w + (e.screenX - start.sx), 280, 3000);
    const h = clamp(start.h + (e.screenY - start.sy), 70, 1200);
    window.fl.overlay.bounds({ width: w, height: h });
  });
  const end = e => {
    start = null;
    if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

init();