'use strict';

const https = require('node:https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Node's https ignores the system proxy, so these go out direct. That matters:
// the machine runs Clash, and an overseas exit IP makes NetEase return -460.
function get(url, headers = {}, timeout = 12000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
      headers: { 'User-Agent': UA, 'Accept': '*/*', ...headers },
      timeout
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return get(next, headers, timeout, redirects - 1).then(resolve, reject);
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function getJson(url, headers) {
  const r = await get(url, headers);
  try { return JSON.parse(r.body); } catch { return null; }
}

// Credits are enumerated endlessly by NetEase (录音工程 / 混音助理 / 合声编写 ...),
// so match on structure — a short role label followed by a colon — plus a
// leading-run rule, rather than trying to list every job title.
// The run rule is deliberately not "any short label": an opening lyric like
// "她说：别回头" is punctuation, not a credit.
const ROLE_WORD = /(作词|作曲|编曲|词曲|词|曲|制作|出品|联合出品|发行|监制|策划|统筹|企划|宣发|营销|版权|混音|母带|录音|和声|合声|弦乐|管乐|打击乐|吉他|贝斯|鼓|键盘|编程|程序|乐手|演唱|演奏|伴奏|封面|设计|摄影|造型|化妆|导演|工作室|录音室|工程|助理|编写|后期|团队|公司|室|方)/;
const LABEL_VALUE = /^\s*([^：:]{1,18})[：:]\s*\S/;
const EN_CREDIT = /^\s*(lyricist|composer|arranger|producer|mixing|mastering|recording|studio|label|publisher|vocals?|guitar|bass|drums?|strings|programmer|programming|executive producer|a&r)\s*[:：]/i;
const HEADER = /^\s*.{1,60}\s*[-–—]\s*.{1,60}\s*(?:[（(].{1,40}[)）])?\s*$/;

function isCredit(text, t) {
  if (!text) return false;
  const m = LABEL_VALUE.exec(text);
  if (m && ROLE_WORD.test(m[1])) return true;
  if (EN_CREDIT.test(text)) return true;
  if (t < 1.5 && HEADER.test(text) && !/[，。！？、]/.test(text)) return true;
  return false;
}

function parseLrc(raw) {
  if (!raw) return [];
  const out = [];
  // [offset:±ms] shifts the whole file; + means lyrics show earlier, so the
  // stamp is reduced by that amount (LRC spec). Only the first tag is used.
  let offsetMs = 0;
  for (const line of String(raw).split(/\r?\n/)) {
    const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(line);
    if (off) { offsetMs = Number(off[1]) || 0; break; }
  }
  for (const line of String(raw).split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    let text = line.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number('0.' + m[3]) : 0;
      const t = +m[1] * 60 + +m[2] + frac - offsetMs / 1000;
      out.push({ t, text });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// NetEase ships a placeholder line instead of an empty lyric body for
// instrumentals ("纯音乐，请欣赏" / "此歌曲为没有填词的纯音乐…").
const INSTRUMENTAL = /^(纯音乐|此歌曲.*(?:没有|无).*填词|instrumental|this (?:song|track).*(?:no|without).*lyrics)/i;

function isInstrumentalNotice(lines) {
  const texts = (lines || []).map(l => (l.text || '').trim()).filter(Boolean);
  if (!texts.length || texts.length > 3) return false;
  return texts.every(t => INSTRUMENTAL.test(t));
}

function mergeTranslation(base, trans) {
  if (!trans.length) return base;
  const byT = new Map();
  for (const l of trans) if (l.text) byT.set(Math.round(l.t * 10), l.text);
  return base.map(l => ({ ...l, tr: byT.get(Math.round(l.t * 10)) || '' }));
}

function clean(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.text) { out.push(l); continue; }
    if (isCredit(l.text, l.t)) continue;
    out.push(l);
  }
  // Credits also cluster at the tail (协力 / OP / SP ...). Walk back over empty
  // lines and short label:value lines until a real lyric stops the run.
  let cut = out.length;
  for (let i = out.length - 1; i >= 0; i--) {
    const text = out[i].text;
    if (!text) continue;
    const m = LABEL_VALUE.exec(text);
    if (m && m[1].trim().length <= 10 && !/[，。！？、]/.test(text)) { cut = i; continue; }
    break;
  }
  // A body made only of "label: value" lines is not a lyric with a tail
  // credit block; leaving cut at 0 would erase every line.
  return cut > 0 ? out.slice(0, cut) : out;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[（(【[].*?[)）】\]]/g, '')
    .replace(/[-—·・,，.。!！?？'"“”‘’]/g, '')
    .trim();
}

function scoreSong(song, title, artist) {
  const nt = norm(title), na = norm(artist);
  const st = norm(song.name);
  const sa = norm((song.artists || []).map(a => a.name).join(''));
  let score = 0;
  if (st === nt) score += 60;
  else if (st.includes(nt) || nt.includes(st)) score += 34;
  if (na && sa) {
    if (sa === na) score += 40;
    else if (sa.includes(na) || na.includes(sa)) score += 24;
  }
  // A live / remix / cover variant is rarely what the client is playing.
  if (/live|remix|cover|翻唱|伴奏|inst|dj|版/i.test(song.name) && !/live|remix|cover|翻唱|伴奏|dj/i.test(title)) score -= 22;
  return score;
}

async function neteaseSearch(title, artist) {
  const q = [title, artist].filter(Boolean).join(' ');
  const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=12&offset=0`;
  const j = await getJson(url, { 'X-Real-IP': '118.88.88.88', Referer: 'https://music.163.com/' });
  const songs = j?.result?.songs;
  if (!Array.isArray(songs) || !songs.length) {
    const bare = await getJson(
      `https://music.163.com/api/search/get?s=${encodeURIComponent(title)}&type=1&limit=12&offset=0`,
      { 'X-Real-IP': '118.88.88.88', Referer: 'https://music.163.com/' });
    return bare?.result?.songs || [];
  }
  return songs;
}

async function neteaseLyric(id) {
  const j = await getJson(`https://music.163.com/api/song/lyric?id=${id}&lv=-1&tv=-1`,
    { Referer: 'https://music.163.com/', 'X-Real-IP': '118.88.88.88' });
  if (!j || j.code !== 200) return null;
  const base = clean(parseLrc(j.lrc?.lyric));
  if (!base.length) return null;
  if (isInstrumentalNotice(base)) return { lines: [], source: 'instrumental', songId: id };
  const trans = parseLrc(j.tlyric?.lyric);
  return { lines: mergeTranslation(base, trans), source: 'netease', songId: id };
}

async function lrclib(title, artist, duration) {
  const h = { 'User-Agent': 'FloatLyric/1.0 (desktop lyrics overlay)' };
  if (duration) {
    const u = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist || '')}&duration=${Math.round(duration)}`;
    try {
      const j = await getJson(u, h);
      if (j?.syncedLyrics) {
        const lines = clean(parseLrc(j.syncedLyrics));
        if (lines.length) return { lines, source: 'lrclib' };
      }
    } catch {}
  }
  try {
    const j = await getJson(`https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist || '')}`, h);
    if (Array.isArray(j)) {
      const hit = j.find(x => x.syncedLyrics);
      if (hit) {
        const lines = clean(parseLrc(hit.syncedLyrics));
        if (lines.length) return { lines, source: 'lrclib' };
      }
    }
  } catch {}
  return null;
}

async function fetchLyrics(title, artist, duration) {
  if (!title) return { lines: [], source: 'none' };
  try {
    const songs = await neteaseSearch(title, artist);
    if (songs.length) {
      const ranked = songs.map(s => ({ s, score: scoreSong(s, title, artist) })).sort((a, b) => b.score - a.score);
      for (const { s, score } of ranked.slice(0, 3)) {
        if (score < 30) break;
        try {
          const r = await neteaseLyric(s.id);
          if (r) return { ...r, matched: s.name, matchedArtist: (s.artists || []).map(a => a.name).join('/') };
        } catch {}
      }
    }
  } catch {}
  try {
    const r = await lrclib(title, artist, duration);
    if (r) return r;
  } catch {}
  return { lines: [], source: 'none' };
}

module.exports = { fetchLyrics, parseLrc, clean, mergeTranslation, neteaseSearch, neteaseLyric, lrclib, isInstrumentalNotice, scoreSong };