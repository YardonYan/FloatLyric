'use strict';

const loupe = document.getElementById('loupe');
const patchImg = document.getElementById('patch');
const ring = document.getElementById('ring');
const swatch = document.getElementById('swatch');
const hexEl = document.getElementById('hex');
const rgbEl = document.getElementById('rgb');

let last = null;
let shade = 0;
let moved = false;

function place(x, y) {
  // Keep the loupe off the sampled pixel: it sits below-right of the cursor
  // and flips near screen edges so it never covers what is being picked.
  const w = 176, h = 214, off = 26;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x + off;
  let top = y + off;
  if (left + w > vw - 8) left = x - off - w;
  if (top + h > vh - 8) top = y - off - h;
  left = Math.max(8, Math.min(left, vw - w - 8));
  top = Math.max(8, Math.min(top, vh - h - 8));
  loupe.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

function onSample(s) {
  if (!s) return;
  last = s;
  if (!moved) {
    place(s.x - window.screenX, s.y - window.screenY);
    loupe.classList.add('on');
  }

  if (s.patch && s.patch.dataUrl) {
    patchImg.src = s.patch.dataUrl;
    const n = s.patch.w;
    document.querySelector('.grid').style.backgroundSize = `calc(100% / ${n}) calc(100% / ${n})`;
    const cross = document.querySelector('.cross');
    cross.style.width = `calc(100% / ${n})`;
    cross.style.height = `calc(100% / ${n})`;
    cross.style.left = ((s.patch.cx + 0.5) / n * 100) + '%';
    cross.style.top = ((s.patch.cy + 0.5) / n * 100) + '%';
  }

  const shown = Color.shade(s.hex, shade);
  ring.style.borderColor = shown;
  swatch.style.background = shown;
  hexEl.textContent = s.hex.toUpperCase();
  const { r, g, b } = Color.hexToRgb(s.hex);
  rgbEl.textContent = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
}

// Screen grabs land at ~4fps (DXGI duplication waits for a fresh frame), so the
// loupe position tracks the pointer locally at display rate; only the pixels
// and the readout arrive on the slower sample channel.
document.getElementById('hit').addEventListener('mousemove', e => {
  moved = true;
  place(e.clientX, e.clientY);
  loupe.classList.add('on');
});

document.getElementById('hit').addEventListener('mousedown', async e => {
  if (e.button === 2) { window.fl.pick.cancel(); return; }
  if (e.button !== 0) return;
  // Re-sample at click time: the streamed sample can be a quarter second stale.
  const fresh = await window.fl.pick.sample();
  window.fl.pick.commit(fresh ? fresh.hex : (last ? last.hex : null));
});

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); window.fl.pick.cancel(); }
  else if (e.key === 'Enter' && last) { e.preventDefault(); window.fl.pick.commit(last.hex); }
});

window.addEventListener('contextmenu', e => e.preventDefault());

window.fl.on.pickSample(onSample);
window.fl.on.pickStarted(p => { shade = p && typeof p.shade === 'number' ? p.shade : 0; });
window.fl.settings.get().then(c => { shade = c.shade || 0; });