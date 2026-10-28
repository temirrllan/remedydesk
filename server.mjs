import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzeCase } from './lib/ai.mjs';
import { PayPalSandbox } from './lib/paypal.mjs';
import { SAMPLE_CASES, canRefund, centsToAmount } from './lib/policy.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(root, 'data', 'store.json');
const port = Number(process.env.PORT || 4180);
const host = '127.0.0.1';
const csrf = randomBytes(24).toString('hex');
const paypal = new PayPalSandbox();
const busy = new Set();
let cases;

async function save() {
  await mkdir(path.dirname(dataPath), { recursive: true });
  const tmp = `${dataPath}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cases, null, 2));
  await rename(tmp, dataPath);
}
try { cases = JSON.parse(await readFile(dataPath, 'utf8')); }
catch { cases = SAMPLE_CASES.map(item => ({ ...item, recommendation: null, paypal: null, refund: null, events: [] })); await save(); }

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'" });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function error(res, status, message) { send(res, status, { error: message }); }
function findCase(id) { return cases.find(item => item.id === id); }
function log(item, action, detail) { item.events.unshift({ at: new Date().toISOString(), action, detail }); }
async function locked(id, action) {
  if (busy.has(id)) throw new Error('This case is already being updated');
  busy.add(id);
  try { return await action(); } finally { busy.delete(id); }
}
function safeCase(item) {
  const { refundKey, ...publicCase } = item;
  if (publicCase.paypal) {
    const { createKey, captureKey, ...publicPayment } = publicCase.paypal;
    publicCase.paypal = publicPayment;
  }
  return { ...publicCase, refundBlockedReason: canRefund(item) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const caseMatch = url.pathname.match(/^\/api\/cases\/([a-z0-9-]+)\/(analyze|order|refund)$/);
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { paypalConfigured: paypal.configured, aiModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct', csrf, sandbox: true });
    if (req.method === 'GET' && url.pathname === '/api/cases') return send(res, 200, cases.map(safeCase));
    if (caseMatch && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${host}:${port}` && req.headers.origin !== `http://localhost:${port}`) return error(res, 403, 'Invalid origin');
      if (req.headers['x-remedy-token'] !== csrf) return error(res, 403, 'Missing request token');
      const item = findCase(caseMatch[1]);
      if (!item) return error(res, 404, 'Case not found');
      const action = caseMatch[2];
      if (action === 'analyze') {
        const result = await locked(item.id, async () => {
          const recommendation = await analyzeCase(item);
          item.recommendation = recommendation;
          log(item, 'AI analysis', `${recommendation.severity}; ${recommendation.percent}% policy`);
          await save();
          return safeCase(item);
        });
        return send(res, 200, result);
      }
      if (action === 'order') {
        if (!paypal.configured) return error(res, 400, 'PayPal Sandbox credentials are not configured');
        const result = await locked(item.id, async () => {
          if (item.paypal?.captureId) return { case: safeCase(item), approveUrl: null };
          if (!item.paypal) { item.paypal = { createKey: randomUUID() }; await save(); }
          if (!item.paypal.orderId) {
            const origin = `http://${host}:${port}`;
            const order = await paypal.createOrder(item, `${origin}/checkout/return?case=${item.id}`, `${origin}/checkout/cancel?case=${item.id}`, item.paypal.createKey);
            item.paypal.orderId = order.id;
            item.paypal.approveUrl = order.approveUrl;
            log(item, 'Sandbox order created', order.id);
            await save();
          }
          return { case: safeCase(item), approveUrl: item.paypal.approveUrl };
        });
        return send(res, 200, result);
      }
      if (action === 'refund') {
        const blocked = canRefund(item);
        if (blocked) return error(res, 400, blocked);
        const result = await locked(item.id, async () => {
          const capture = await paypal.getCapture(item.paypal.captureId);
          if (capture.status !== 'COMPLETED' || capture.amount?.currency_code !== item.currency || capture.amount?.value !== centsToAmount(item.priceCents)) throw new Error('PayPal capture does not match the case payment');
          if (!item.refundKey) { item.refundKey = randomUUID(); await save(); }
          const refund = await paypal.refund(item.paypal.captureId, item.recommendation.refundCents, item.currency, item.refundKey);
          if (!refund.id || !['COMPLETED', 'PENDING'].includes(refund.status)) throw new Error('PayPal did not confirm the refund');
          item.refund = { id: refund.id, status: refund.status, amount: refund.amount };
          log(item, 'Sandbox refund', `${refund.id}: ${refund.status}`);
          await save();
          return safeCase(item);
        });
        return send(res, 200, result);
      }
    }
    if (req.method === 'GET' && url.pathname === '/checkout/return') {
      const item = findCase(url.searchParams.get('case'));
      const token = url.searchParams.get('token');
      if (!item || !token || item.paypal?.orderId !== token) return error(res, 400, 'Order not recognized');
      try {
        await locked(item.id, async () => {
          if (item.paypal.captureId) return;
          if (!item.paypal.captureKey) { item.paypal.captureKey = randomUUID(); await save(); }
          const captured = await paypal.captureOrder(token, item.paypal.captureKey);
          if (captured.amount?.currency_code !== item.currency || captured.amount?.value !== centsToAmount(item.priceCents)) throw new Error('Captured amount does not match the case');
          item.paypal.captureId = captured.captureId;
          item.paypal.capturedAt = new Date().toISOString();
          log(item, 'Sandbox payment captured', captured.captureId);
          await save();
        });
        res.writeHead(302, { Location: `/?case=${item.id}&checkout=complete` }); return res.end();
      } catch (captureError) {
        item.checkoutError = captureError.message; await save();
        res.writeHead(302, { Location: `/?case=${item.id}&checkout=error` }); return res.end();
      }
    }
    if (req.method === 'GET' && url.pathname === '/checkout/cancel') {
      res.writeHead(302, { Location: `/?case=${encodeURIComponent(url.searchParams.get('case') || '')}&checkout=cancelled` }); return res.end();
    }
    if (req.method === 'GET' && ['/', '/app.js', '/styles.css'].includes(url.pathname)) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const mime = name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
      return send(res, 200, await readFile(path.join(root, 'public', name), 'utf8'), mime);
    }
    return error(res, 404, 'Not found');
  } catch (cause) {
    const status = cause instanceof SyntaxError ? 400 : 500;
    console.error(cause);
    return error(res, status, cause.message || 'Unexpected error');
  }
});
server.listen(port, host, () => console.log(`RemedyDesk: http://${host}:${port}`));
