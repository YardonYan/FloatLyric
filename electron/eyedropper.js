'use strict';

const { desktopCapturer, screen } = require('electron');

// desktopCapturer hands back one source per display, each already scaled to fit
// the requested thumbnail box. Map cursor DIP -> that source's own pixel grid
// rather than assuming the thumbnail is native resolution.
function displayForPoint(pt) {
  return screen.getDisplayNearestPoint(pt);
}

async function grabSources() {
  const displays = screen.getAllDisplays();
  const w = Math.max(...displays.map(d => Math.round(d.size.width * d.scaleFactor)));
  const h = Math.max(...displays.map(d => Math.round(d.size.height * d.scaleFactor)));
  return desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
}

// A fullscreen topmost picker makes other Chromium/Electron windows count as
// occluded; they stop presenting and the live capture reads black there. Grab
// the desktop once before the picker exists and sample that frozen frame.
let frozen = null;

async function freeze() {
  try { frozen = await grabSources(); } catch { frozen = null; }
  return !!frozen;
}

function unfreeze() { frozen = null; }

function pickPixel(source, display, pt) {
  const size = source.thumbnail.getSize();
  const nativeW = display.size.width * display.scaleFactor;
  const nativeH = display.size.height * display.scaleFactor;
  const sx = size.width / nativeW;
  const sy = size.height / nativeH;
  const px = Math.floor((pt.x - display.bounds.x) * display.scaleFactor * sx);
  const py = Math.floor((pt.y - display.bounds.y) * display.scaleFactor * sy);
  const cx = Math.max(0, Math.min(size.width - 1, px));
  const cy = Math.max(0, Math.min(size.height - 1, py));
  const bmp = source.thumbnail.crop({ x: cx, y: cy, width: 1, height: 1 }).toBitmap();
  // NativeImage bitmaps are BGRA on Windows.
  return { b: bmp[0], g: bmp[1], r: bmp[2], x: cx, y: cy };
}

function toHex({ r, g, b }) {
  const f = v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return '#' + f(r) + f(g) + f(b);
}

// Samples a small neighbourhood so the loupe can show real pixels, not a flat swatch.
function patch(source, display, pt, radius = 7) {
  const size = source.thumbnail.getSize();
  const nativeW = display.size.width * display.scaleFactor;
  const nativeH = display.size.height * display.scaleFactor;
  const sx = size.width / nativeW, sy = size.height / nativeH;
  const cx = Math.floor((pt.x - display.bounds.x) * display.scaleFactor * sx);
  const cy = Math.floor((pt.y - display.bounds.y) * display.scaleFactor * sy);
  const x0 = Math.max(0, cx - radius), y0 = Math.max(0, cy - radius);
  const x1 = Math.min(size.width, cx + radius + 1), y1 = Math.min(size.height, cy + radius + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  const crop = source.thumbnail.crop({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  return { dataUrl: crop.toDataURL(), w: x1 - x0, h: y1 - y0, cx: cx - x0, cy: cy - y0 };
}

async function sample({ withPatch = false, at = null } = {}) {
  const pt = at || screen.getCursorScreenPoint();
  const display = displayForPoint(pt);
  const sources = frozen || await grabSources();
  const source = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
  if (!source) return null;
  const px = pickPixel(source, display, pt);
  const out = {
    hex: toHex(px),
    x: pt.x,
    y: pt.y,
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    bounds: display.bounds
  };
  if (withPatch) out.patch = patch(source, display, pt);
  return out;
}

module.exports = { sample, grabSources, displayForPoint, freeze, unfreeze };