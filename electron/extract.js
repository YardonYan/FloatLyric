// Injected into the NetEase Cloud Music page via CDP Runtime.evaluate.
// Anchors are semantic class names + aria-labels, never CSS-module hashes,
// so this survives client updates that re-hash the generated class names.
//
// Element references are cached on the page itself (window.__flCache): the
// poll runs every 100 ms, and re-walking the DOM each time is the single
// most expensive part of the loop. A detached node (client reload, view
// rebuild) invalidates the cache and triggers a re-scan.
(() => {
  const cache = window.__flCache || (window.__flCache = {});
  const alive = el => el && el.isConnected;

  function resetUnderSlider() {
    cache.track = null;
    cache.timeEl = null;
  }
  function resetUnderBar() {
    cache.titleBox = null;
    cache.titleLeaf = null;
    cache.authorEl = null;
    cache.coverImg = null;
    cache.pauseBtn = null;
    resetUnderSlider();
  }

  let sl = alive(cache.slider) ? cache.slider : null;
  if (!sl) {
    sl = document.querySelector('[aria-label="播放进度调节"]');
    if (!sl) return { ok: false, reason: 'no-player' };
    cache.slider = sl;
    cache.bar = null;
    resetUnderBar();
  }

  if (!alive(cache.bar)) {
    let bar = sl;
    for (let i = 0; i < 3 && bar.parentElement; i++) bar = bar.parentElement;
    cache.bar = bar;
    resetUnderBar();
  }
  const bar = cache.bar;

  // The played-track width is continuous; the mm:ss text only ticks once a second.
  let track = alive(cache.track) ? cache.track : null;
  if (!track) {
    track = sl.querySelector('.track');
    cache.track = track;
  }
  let ratio = track ? track.getBoundingClientRect().width / sl.getBoundingClientRect().width : NaN;
  if (!isFinite(ratio) || ratio < 0) {
    const pct = parseFloat(sl.style.getPropertyValue('--track-precent'));
    ratio = isFinite(pct) ? pct / 100 : NaN;
  }
  if (ratio > 1) ratio = 1;

  let clock = null, duration = null;
  const TIME_RE = /^\s*(\d{1,2}):(\d{2})\s*\/\s*(\d{1,2}):(\d{2})\s*$/;
  let timeEl = alive(cache.timeEl) ? cache.timeEl : null;
  if (timeEl) {
    const m = TIME_RE.exec(timeEl.textContent || '');
    if (m) {
      clock = +m[1] * 60 + +m[2];
      duration = +m[3] * 60 + +m[4];
    } else {
      cache.timeEl = null;
      timeEl = null;
    }
  }
  if (!timeEl) {
    for (const e of sl.querySelectorAll('*')) {
      if (e.children.length) continue;
      const m = TIME_RE.exec(e.textContent || '');
      if (m) {
        cache.timeEl = e;
        clock = +m[1] * 60 + +m[2];
        duration = +m[3] * 60 + +m[4];
        break;
      }
    }
  }

  const firstLeafEl = root => {
    if (!root) return null;
    for (const e of root.querySelectorAll('*')) {
      if (e.children.length) continue;
      if ((e.textContent || '').trim()) return e;
    }
    return null;
  };

  // .main-title holds a duplicated marquee copy; take the first leaf only.
  let titleBox = alive(cache.titleBox) ? cache.titleBox : null;
  if (!titleBox) {
    titleBox = bar.querySelector('.main-title');
    cache.titleBox = titleBox;
  }
  let titleLeaf = alive(cache.titleLeaf) ? cache.titleLeaf : null;
  if (titleLeaf && !(titleLeaf.textContent || '').trim()) {
    titleLeaf = null;
    cache.titleLeaf = null;
  }
  if (!titleLeaf) {
    titleLeaf = firstLeafEl(titleBox);
    cache.titleLeaf = titleLeaf;
  }
  let title = titleLeaf ? (titleLeaf.textContent || '').trim() : '';

  let authorEl = alive(cache.authorEl) ? cache.authorEl : null;
  if (!authorEl) {
    authorEl = bar.querySelector('.author');
    cache.authorEl = authorEl;
  }
  let artist = authorEl ? (authorEl.textContent || '').trim() : '';

  if (!title) {
    const seen = [];
    for (const e of bar.querySelectorAll('span,div,a,p')) {
      if (e.children.length) continue;
      const t = (e.textContent || '').trim();
      if (t && t.length < 200 && !/^\d{1,2}:\d{2}/.test(t) && !/^\d+(\.\d+)?[wW万+]/.test(t)) seen.push(t);
    }
    const u = [...new Set(seen)];
    title = u[0] || '';
    if (!artist) artist = u.find(t => t !== title) || '';
  }

  let coverImg = alive(cache.coverImg) ? cache.coverImg : null;
  if (!coverImg) {
    coverImg = bar.querySelector('img');
    cache.coverImg = coverImg;
  }
  let cover = '';
  if (coverImg) {
    const m = /https?:\/\/[^?\s]+/.exec(String(coverImg.src || ''));
    cover = m ? m[0] : '';
  }

  let pauseBtn = alive(cache.pauseBtn) ? cache.pauseBtn : null;
  if (!pauseBtn) {
    pauseBtn = bar.querySelector('[aria-label="pause"]');
    cache.pauseBtn = pauseBtn;
  }
  const playing = !!pauseBtn;

  const icon = n => bar.querySelector('[aria-label="' + n + '"]');

  return {
    ok: true,
    playing,
    title,
    artist,
    cover,
    duration,
    position: duration != null && isFinite(ratio) ? +(ratio * duration).toFixed(3) : clock,
    clock,
    ratio: isFinite(ratio) ? +ratio.toFixed(6) : null,
    controls: { prev: !!icon('pre'), next: !!icon('next'), lyric: !!icon('lyric'), mode: icon('loop') ? 'loop' : null }
  };
})()