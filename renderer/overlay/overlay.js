'use strict';

const $ = id => document.getElementById(id);
const pane = $('pane'), lineEl = $('line'), trEl = $('tr');
const ctxPrev = $('ctxPrev'), ctxNext = $('ctxNext'), idleText = $('idleText');
const progressFill = $('progressFill');

let cfg = null;
let lyrics = { lines: [], source: 'none' };
let net = null;            // last state from main
let netAt = 0;             // performance.now() when it arrived
let idx = -1;
let previewHex = null;
let offsetMs = 0;
let stale = false;
let staleTimer = null;
let lastSwitchAt = 0;
let lastProgressPct = -1;

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
  s.setProperty('--text-opacity', String(clamp(cfg.textOpacity ?? 100, 10, 100) / 100));
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

  const sc = cfg.shortcuts || {};
  $('btnPick').title = `屏幕取色针 (${sc.pick || 'Alt+C'})`;
  $('btnPanel').title = `控制面板 (${sc.panel || 'Alt+P'})`;
  $('btnLock').title = `锁定位置 (${sc.lock || 'Alt+Shift+L'})`;
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
  const lineW = lineEl.scrollWidth;
  const w = Math.max(lineW, trEl.scrollWidth);
  let scale = 1;
  if (w > avail) {
    scale = Math.max(0.42, avail / w);
    main.style.setProperty('--fit', String(scale));
  }
  // Past the 0.42 floor the line is still wider than the pane. Slide it rather
  // than shrivelling the type further, which would be unreadable.
  const overflow = Math.ceil(lineW * scale - avail);
  const marquee = overflow > 2;
  main.classList.toggle('is-marquee', marquee);
  if (marquee) {
    lineEl.style.setProperty('--marquee-x', `-${overflow}px`);
    lineEl.style.setProperty('--marquee-dur', `${Math.max(6, Math.round(overflow / 30))}s`);
  }
  queueHotZones();
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

  // Apply the fit in the same frame. A deferred fit paints one frame of the
  // unscaled line first, which reads as a size blink on every line change.
  fit();
}

function setIdle(msg) {
  document.body.classList.add('is-idle');
  idleText.textContent = msg;
  queueHotZones();
}

// Idle states do not need 60fps: pause the lyric clock to a few frames a
// second, and stop entirely while the window is hidden.
const IDLE_FRAME_MS = 400;
const PAUSED_FRAME_MS = 250;
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
  let delay = 0;
  if (!net || !net.ok) {
    if (!document.body.classList.contains('is-idle')) setIdle('等待网易云播放');
    delay = IDLE_FRAME_MS;
  } else {
    const t = positionNow();
    if (net.duration) {
      const pct = clamp(t / net.duration, 0, 1) * 100;
      // Writing the width every frame is wasted compositing for a 3px bar.
      if (Math.abs(pct - lastProgressPct) >= 0.05) {
        progressFill.style.width = pct.toFixed(2) + '%';
        lastProgressPct = pct;
      }
    }

    if (!lyrics.lines.length) {
      const msg = lyrics.source === 'loading' ? '正在找歌词…'
        : lyrics.source === 'instrumental' ? '纯音乐，请欣赏'
          : '这首歌没有歌词';
      if (idleText.textContent !== msg || !document.body.classList.contains('is-idle')) setIdle(msg);
      delay = IDLE_FRAME_MS;
    } else if (stale) {
      // Waiting for the new song's lyrics; keep the last line on screen rather
      // than blanking the strip for the length of a network round-trip.
      delay = net.playing ? 0 : PAUSED_FRAME_MS;
    } else {
      // While the idle layer was up the lyric block was display:none, so any
      // fit measured during that time was 0. Re-measure on the way back.
      const wasIdle = document.body.classList.contains('is-idle');
      document.body.classList.remove('is-idle');
      if (wasIdle) fit();
      const i = lineAt(t);
      if (i !== idx) {
        const now = performance.now();
        // A one-line hop back right after a switch is sampling noise around the
        // boundary; replaying the enter animation there looks like a blink.
        const backtrack = idx > 0 && i < idx && now - lastSwitchAt < 600;
        if (!backtrack) {
          const first = idx === -1;
          idx = i;
          lastSwitchAt = now;
          renderLine(i, !first);
        }
      }
      delay = net.playing ? 0 : PAUSED_FRAME_MS;
    }
  }
  scheduleLoop(delay);
}

function ingestState(s) {
  net = s;
  netAt = performance.now();
  lastProgressPct = -1;
  if (!s || !s.ok) { idx = -1; }
}

function ingestLyrics(r) {
  clearTimeout(staleTimer);
  stale = false;
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
  window.fl.on.lyricsLoading(() => {
    clearTimeout(staleTimer);
    if (lyrics.lines.length) {
      stale = true;
      // If the lookup never answers, fall back to the normal empty state.
      staleTimer = setTimeout(() => {
        stale = false;
        lyrics = { lines: [], source: 'none' };
        idx = -1;
      }, 6000);
      return;
    }
    lyrics = { lines: [], source: 'loading' };
    idx = -1;
  });
  window.fl.on.settings(next => {
    const refit = next.fontSize !== cfg.fontSize || next.showTranslation !== cfg.showTranslation;
    cfg = next;
    offsetMs = next.offsetMs || 0;
    applyTheme();
    queueHotZones();
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
  wireEdges();
  window.addEventListener('resize', () => requestAnimationFrame(fit));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop(); else scheduleLoop(0);
  });
  window.fl.on.hot(on => document.body.classList.toggle('is-hot', !!on));
  queueHotZones();
  scheduleLoop(0);
}

// Only the lyric text (plus the small HUD / resize grip) is a mouse target.
// The boxes are reported window-local to the main process, which polls the
// cursor and toggles the window's hit-testing.
function hotRects() {
  if (!cfg || cfg.clickThrough || cfg.locked) return [];
  return [lineEl, trEl, $('idleText'), $('hud'), $('grip'), $('edgeLeft'), $('edgeRight')]
    .map(el => el.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0);
}

let hotReportPending = false;

function reportHotZones() {
  const zones = hotRects().map(r => ({
    x: Math.round(r.left), y: Math.round(r.top),
    w: Math.round(r.width), h: Math.round(r.height)
  }));
  window.fl.overlay.setHotZones(zones);
}

function queueHotZones() {
  if (hotReportPending) return;
  hotReportPending = true;
  requestAnimationFrame(() => {
    hotReportPending = false;
    reportHotZones();
  });
}

function wireEdges() {
  // Drag either vertical edge to change the strip width. The left edge keeps
  // the right edge anchored, the right edge keeps the left edge anchored.
  for (const [el, side] of [[$('edgeLeft'), 'left'], [$('edgeRight'), 'right']]) {
    let start = null;
    el.addEventListener('pointerdown', async e => {
      if (e.button !== 0 || !cfg || cfg.locked || cfg.clickThrough) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const b = await window.fl.overlay.bounds();
      start = { sx: e.screenX, x: b.x, w: b.width };
    });
    el.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.screenX - start.sx;
      if (!dx) return;
      if (side === 'right') {
        window.fl.overlay.bounds({ width: clamp(start.w + dx, 280, 3000) });
      } else {
        const w = clamp(start.w - dx, 280, 3000);
        window.fl.overlay.bounds({ x: Math.round(start.x + start.w - w), width: w });
      }
    });
    const end = e => {
      start = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      queueHotZones();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
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