'use strict';
// Dev-only CDP client for inspecting our own Electron renderers.
// usage: node scripts/inspect.js <port> <urlSubstr> "<js expr>" [shotOut.png]
const fs = require('node:fs');

const port = process.argv[2] || '9223';
const substr = process.argv[3] || 'overlay';
const expr = process.argv[4] || '1';
const shot = process.argv[5];

async function main() {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  const t = list.find(x => x.type === 'page' && x.url.includes(substr));
  if (!t) { console.log('NO TARGET', list.map(x => x.url)); return; }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  await new Promise(r => { ws.onopen = r; });
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result && r.result.value !== undefined ? r.result.value : r, null, 2));
  if (shot) {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(s.data, 'base64'));
    console.log('SHOT', shot);
  }
  ws.close();
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });