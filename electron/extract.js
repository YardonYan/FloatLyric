// Injected into the NetEase Cloud Music page via CDP Runtime.evaluate.
// Anchors are semantic class names + aria-labels, never CSS-module hashes,
// so this survives client updates that re-hash the generated class names.
(() => {
  const sl = document.querySelector('[aria-label="播放进度调节"]');
  if (!sl) return { ok: false, reason: 'no-player' };

  const sr = sl.getBoundingClientRect();
  if (!sr.width) return { ok: false, reason: 'slider-hidden' };

  // The played-track width is continuous; the mm:ss text only ticks once a second.
  const track = sl.querySelector('.track');
  let ratio = track ? track.getBoundingClientRect().width / sr.width : NaN;
  if (!isFinite(ratio) || ratio < 0) {
    const pct = parseFloat(sl.style.getPropertyValue('--track-precent'));
    ratio = isFinite(pct) ? pct / 100 : NaN;
  }
  if (ratio > 1) ratio = 1;

  let clock = null, duration = null;
  for (const e of sl.querySelectorAll('*')) {
    if (e.children.length) continue;
    const m = /^\s*(\d{1,2}):(\d{2})\s*\/\s*(\d{1,2}):(\d{2})\s*$/.exec(e.textContent || '');
    if (m) { clock = +m[1] * 60 + +m[2]; duration = +m[3] * 60 + +m[4]; break; }
  }

  let bar = sl;
  for (let i = 0; i < 3 && bar.parentElement; i++) bar = bar.parentElement;

  const icon = n => bar.querySelector('[aria-label="' + n + '"]');
  const playing = !!icon('pause');

  const firstLeaf = root => {
    if (!root) return '';
    for (const e of root.querySelectorAll('*')) {
      if (e.children.length) continue;
      const t = (e.textContent || '').trim();
      if (t) return t;
    }
    return (root.textContent || '').trim();
  };

  // .main-title holds a duplicated marquee copy; take the first leaf only.
  let title = firstLeaf(bar.querySelector('.main-title'));
  let artist = (bar.querySelector('.author')?.textContent || '').trim();

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

  let cover = '';
  const img = bar.querySelector('img');
  if (img) { const m = /https?:\/\/[^?\s]+/.exec(String(img.src || '')); cover = m ? m[0] : ''; }

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