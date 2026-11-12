'use strict';

// Dev-only: drive the overlay with CDP Input events (no OS cursor involved).
// Usage: node scripts/input.js <port> <urlSubstr> <jsonFile>
// jsonFile: [{type:'mousePressed'|'mouseMoved'|'mouseReleased', x, y, button?, clickCount?}, ...]

const fs = require('node:fs');
const http = require('node:http');

const [port, urlSubstr, file] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(file, 'utf8'));

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => resolve(JSON.parse(b)));
    }).on('error', reject);
  });
}

(async () => {
  const list = await get('/json/list');
  const page = list.find(t => t.type === 'page' && (t.url || '').includes(urlSubstr));
  if (!page) { console.error('page not found'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };
  await new Promise(r => ws.onopen = r);
  for (const s of steps) {
    const params = { type: s.type, x: s.x, y: s.y, button: s.button || 'left', buttons: s.type === 'mouseReleased' ? 0 : 1, clickCount: s.clickCount || 1 };
    await send('Input.dispatchMouseEvent', params);
    await new Promise(r => setTimeout(r, s.wait || 60));
  }
  console.log('dispatched', steps.length, 'events');
  ws.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });