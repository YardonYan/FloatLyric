'use strict';

// Pure pixel math for the eyedropper, split out of eyedropper.js so it can be
// unit-tested without electron. desktopCapturer hands back one source per
// display, each scaled to fit the requested thumbnail box; a DIP point must
// be mapped into that source's own pixel grid, not assumed native resolution.

function mapPoint(pt, display, size) {
  const nativeW = display.size.width * display.scaleFactor;
  const nativeH = display.size.height * display.scaleFactor;
  const sx = size.width / nativeW;
  const sy = size.height / nativeH;
  const px = Math.floor((pt.x - display.bounds.x) * display.scaleFactor * sx);
  const py = Math.floor((pt.y - display.bounds.y) * display.scaleFactor * sy);
  return {
    x: Math.max(0, Math.min(size.width - 1, px)),
    y: Math.max(0, Math.min(size.height - 1, py))
  };
}

// NativeImage bitmaps are BGRA on Windows.
function bgraToRgb(bmp) {
  return { b: bmp[0], g: bmp[1], r: bmp[2] };
}

function rgbToHex({ r, g, b }) {
  const f = v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return '#' + f(r) + f(g) + f(b);
}

module.exports = { mapPoint, bgraToRgb, rgbToHex };