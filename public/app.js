let cases = [];
let status = null;
let selectedId = new URLSearchParams(location.search).get('case');
let pending = false;
const main = document.getElementById('main');
const list = document.getElementById('case-list');
const toast = document.getElementById('toast');

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function money(cents, currency = 'USD') { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100); }
function notify(message, error = false) { toast.textContent = message; toast.className = `toast show${error ? ' error' : ''}`; clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.className = 'toast', 5000); }
async function getJson(url) { const response = await fetch(url); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data; }
async function postJson(url) { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Remedy-Token': status.csrf }, body: '{}' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data; }

function stage(item) {
  if (item.refund?.id) return { label: 'Refund issued', cls: 'done' };
  if (item.paypal?.captureId) return { label: 'Payment captured', cls: 'paid' };
  if (item.paypal?.orderId) return { label: 'Awaiting payment', cls: 'waiting' };
  if (item.recommendation) return { label: 'Review ready', cls: 'ready' };
  return { label: 'New case', cls: 'new' };
}

function renderList() {
  document.getElementById('case-count').textContent = String(cases.length).padStart(2, '0');
  list.innerHTML = cases.map(item => {
    const s = stage(item);
    return `<button class="case-row ${item.id === selectedId ? 'selected' : ''}" type="button" data-case="${esc(item.id)}" aria-current="${item.id === selectedId ? 'page' : 'false'}"><span class="case-row-top"><strong>${esc(item.account)}</strong><span class="case-arrow" aria-hidden="true">↗</span></span><span class="case-row-sub">${esc(item.plan)} · ${money(item.priceCents, item.currency)}</span><span class="case-row-status ${s.cls}"><i></i>${s.label}</span></button>`;
  }).join('');
}

function renderMain() {
  const item = cases.find(row => row.id === selectedId) || cases[0];
  if (!item) { main.innerHTML = '<p>No cases available.</p>'; return; }
  selectedId = item.id;
  const recommendation = item.recommendation;
  const s = stage(item);
  const bar = recommendation ? recommendation.percent : 0;
  main.innerHTML = `
    <div class="content-head"><div><span class="eyebrow">CASE / ${esc(item.id.toUpperCase())}</span><h2>${esc(item.account)}</h2><p>${esc(item.plan)} plan · Synthetic service incident</p></div><span class="status-badge ${s.cls}"><i></i>${s.label}</span></div>
    <div class="flow" aria-label="Workflow"><div class="flow-step active"><span>01</span> Understand</div><div class="flow-rule"></div><div class="flow-step ${recommendation ? 'active' : ''}"><span>02</span> Recommend</div><div class="flow-rule"></div><div class="flow-step ${item.paypal?.captureId ? 'active' : ''}"><span>03</span> PayPal</div><div class="flow-rule"></div><div class="flow-step ${item.refund?.id ? 'active' : ''}"><span>04</span> Resolve</div></div>
    <section class="section incident"><div class="section-heading"><span class="eyebrow">THE SITUATION</span><h3>What happened</h3></div><p class="incident-text">${esc(item.incident)}</p><div class="customer-voice"><span class="quote-mark">“</span><div><span class="eyebrow">CUSTOMER REQUEST</span><p>${esc(item.request)}</p></div></div></section>
    <div class="columns"><section class="section analysis"><div class="section-heading"><span class="eyebrow">AI + FIXED POLICY</span><h3>Impact assessment</h3></div>${recommendation ? `
      <div class="severity-row"><span class="severity ${esc(recommendation.severity)}">${esc(recommendation.severity)}</span><span class="model">Analyzed with ${esc(recommendation.model)}</span></div>
      <p class="reason">${esc(recommendation.reason)}</p><div class="evidence"><span class="eyebrow">VERIFIED INCIDENT EVIDENCE</span><p>“${esc(recommendation.evidence)}”</p></div>
      <div class="policy-row"><div><span>Policy rate</span><strong>${recommendation.percent}%</strong></div><div class="meter"><div class="meter-fill p${bar}"></div></div><div><span>Suggested refund</span><strong>${money(recommendation.refundCents, item.currency)}</strong></div></div>
      <p class="fineprint">${esc(recommendation.policy)}</p><button class="text-button" id="analyze" ${pending ? 'disabled' : ''}>Run analysis again ↗</button>` : `
      <div class="empty-analysis"><div class="spark" aria-hidden="true">✳</div><p>Review the incident with a local AI model. Evidence must match the incident text before policy can calculate a refund.</p><button class="primary" id="analyze" ${pending ? 'disabled' : ''}>${pending ? 'Analyzing…' : 'Analyze impact'} <span aria-hidden="true">↗</span></button></div>`}</section>
    <section class="section payment"><div class="section-heading"><span class="eyebrow">PAYPAL SANDBOX</span><h3>Payment & remedy</h3></div>
      <div class="amount-line"><span>Original payment</span><strong>${money(item.priceCents, item.currency)}</strong></div>
      <div class="amount-line"><span>Policy recommendation</span><strong>${recommendation ? money(recommendation.refundCents, item.currency) : '—'}</strong></div>
      <div class="payment-state"><span class="state-icon">${item.refund?.id ? '✓' : item.paypal?.captureId ? '✓' : '○'}</span><div><strong>${item.refund?.id ? 'Refund confirmed' : item.paypal?.captureId ? 'Sandbox payment captured' : 'Test payment needed'}</strong><p>${item.refund?.id ? `PayPal refund ${esc(item.refund.id)} · ${esc(item.refund.status)}` : item.paypal?.captureId ? `Capture ${esc(item.paypal.captureId)}` : 'Create a sandbox order, then approve it with a sandbox buyer.'}</p></div></div>
      ${item.checkoutError ? `<p class="inline-error">${esc(item.checkoutError)}</p>` : ''}
      ${item.paypal?.orderId && !item.paypal?.captureId ? `<a class="secondary block" href="${esc(item.paypal.approveUrl)}">Continue sandbox checkout ↗</a>` : ''}
      ${!item.paypal?.orderId ? `<button class="secondary block" id="create-order" ${!status.paypalConfigured || pending ? 'disabled' : ''}>Create sandbox test payment ↗</button>` : ''}
      <button class="refund block" id="refund" ${item.refundBlockedReason || pending ? 'disabled' : ''}>Approve ${recommendation ? money(recommendation.refundCents, item.currency) : '—'} refund <span aria-hidden="true">↗</span></button>
      <p class="fineprint">${esc(item.refundBlockedReason || 'A human must approve this PayPal Sandbox refund. The model cannot move money.')}</p>
      ${!status.paypalConfigured ? '<p class="setup-note">Connect your own PayPal Sandbox credentials in <code>.env</code> to enable payments.</p>' : ''}
    </section></div>
    <section class="activity"><div class="section-line"><h3>Activity</h3><span>${item.events.length} events</span></div><ol>${item.events.length ? item.events.map(event => `<li><time>${new Date(event.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</time><strong>${esc(event.action)}</strong><span>${esc(event.detail)}</span></li>`).join('') : '<li class="activity-empty">No actions yet. Start with an impact analysis.</li>'}</ol></section>`;
}

function render() { renderList(); renderMain(); }
async function refresh() { cases = await getJson('/api/cases'); render(); }
async function run(action) {
  if (pending) return;
  const item = cases.find(row => row.id === selectedId);
  if (!item) return;
  if (action === 'refund' && !confirm(`Issue a ${money(item.recommendation.refundCents, item.currency)} refund in PayPal Sandbox for ${item.account}? This cannot be cancelled after submission.`)) return;
  pending = true; render();
  try {
    const data = await postJson(`/api/cases/${encodeURIComponent(selectedId)}/${action}`);
    if (action === 'order' && data.approveUrl) { location.href = data.approveUrl; return; }
    await refresh(); notify(action === 'refund' ? 'Sandbox refund recorded.' : action === 'analyze' ? 'Impact analysis completed.' : 'Sandbox order created.');
  } catch (error) { notify(error.message, true); }
  finally { pending = false; render(); }
}

list.addEventListener('click', event => { const button = event.target.closest('[data-case]'); if (!button) return; selectedId = button.dataset.case; history.replaceState({}, '', `/?case=${encodeURIComponent(selectedId)}`); render(); main.focus(); });
main.addEventListener('click', event => { if (event.target.closest('#analyze')) run('analyze'); else if (event.target.closest('#create-order')) run('order'); else if (event.target.closest('#refund')) run('refund'); });
try {
  status = await getJson('/api/status');
  await refresh();
  const checkout = new URLSearchParams(location.search).get('checkout');
  if (checkout === 'complete') notify('PayPal Sandbox payment captured.');
  if (checkout === 'error') notify('Payment capture failed. See case details.', true);
  if (checkout === 'cancelled') notify('Sandbox checkout was cancelled.');
} catch (error) { main.innerHTML = `<div class="fatal">Could not load RemedyDesk: ${esc(error.message)}</div>`; }
