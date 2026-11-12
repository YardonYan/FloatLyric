// Minimal CDP client: evaluate JS inside the NetEase Cloud Music page.
// usage: node cdp.mjs "<js expression>"   |   node cdp.mjs --file expr.js
const PORT = process.env.CDP_PORT || 9222;

async function getWsUrl() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('no page target');
  return page.webSocketDebuggerUrl;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { ws.close(); }
    });
    ws.onerror = e => reject(new Error('ws error ' + (e.message || '')));
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
  });
}

const arg = process.argv[2];
let expr;
if (arg === '--file') {
  expr = await (await import('node:fs/promises')).readFile(process.argv[3], 'utf8');
} else {
  expr = arg;
}
if (!expr) { console.error('need expression'); process.exit(1); }

const cdp = await connect(await getWsUrl());
await cdp.send('Runtime.enable');
const r = await cdp.send('Runtime.evaluate', {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
  timeout: 15000
});
if (r.exceptionDetails) {
  console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails, null, 2));
} else {
  const v = r.result?.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
}
cdp.close();
process.exit(0);