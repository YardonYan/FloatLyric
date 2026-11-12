'use strict';

// Classic script: keep every binding inside an IIFE so loading this next to
// fonts.js / the page script cannot collide on top-level const names.
(function () {

// OKLCH rather than HSL: "深浅" is a perceptual lightness axis, and HSL's L
// makes yellow and blue at the same L look wildly different in brightness.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function hexToRgb(hex) {
  const h = String(hex).replace('#', '').trim();
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(s.slice(0, 6), 16);
  if (!isFinite(n)) return { r: 1, g: 1, b: 1 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function rgbToHex({ r, g, b }) {
  const f = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return '#' + f(r) + f(g) + f(b);
}

const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function rgbToOklab({ r, g, b }) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  };
}

function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return {
    r: toSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
  };
}

const inGamut = ({ r, g, b }) => r >= -0.002 && r <= 1.002 && g >= -0.002 && g <= 1.002 && b >= -0.002 && b <= 1.002;

function oklchToHex(L, C, H) {
  const h = (H * Math.PI) / 180;
  let c = C;
  let rgb = oklabToRgb({ L, a: c * Math.cos(h), b: c * Math.sin(h) });
  // Reduce chroma until the colour fits sRGB instead of clipping channels,
  // which would silently shift the hue the user picked.
  for (let i = 0; i < 24 && !inGamut(rgb); i++) {
    c *= 0.92;
    rgb = oklabToRgb({ L, a: c * Math.cos(h), b: c * Math.sin(h) });
  }
  return rgbToHex({ r: clamp(rgb.r, 0, 1), g: clamp(rgb.g, 0, 1), b: clamp(rgb.b, 0, 1) });
}

function hexToOklch(hex) {
  const { L, a, b } = rgbToOklab(hexToRgb(hex));
  const C = Math.sqrt(a * a + b * b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

// delta is -100..100, mapped onto a lightness span around the picked colour.
function shade(hex, delta) {
  const { L, C, H } = hexToOklch(hex);
  const d = clamp(delta, -100, 100) / 100;
  const target = d >= 0 ? L + (0.985 - L) * d : L * (1 + d * 0.92);
  return oklchToHex(clamp(target, 0.02, 0.995), C, H);
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${clamp(alpha, 0, 1)})`;
}

function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

const api = { hexToRgb, rgbToHex, hexToOklch, oklchToHex, shade, luminance, contrast, withAlpha, mix, clamp };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Color = api;

})();