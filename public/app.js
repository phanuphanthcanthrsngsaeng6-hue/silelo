/* ============ Silelo💯✨️ — App Logic ============ */
const API = '';
let TOKEN = localStorage.getItem('kt_token') || '';
let ME = null;
let ws = null;
let charts = {};
let map = null;

const $ = id => document.getElementById(id);

/* ---------- Helpers ---------- */
async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'เกิดข้อผิดพลาด' }));
  if (!res.ok && !data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), ms);
}

function money(n) {
  return '$' + Number(n).toLocaleString('en-US');
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return Math.floor(s / 60) + ' นาทีที่แล้ว';
  if (s < 86400) return Math.floor(s / 3600) + ' ชม.ที่แล้ว';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' วันที่แล้ว';
  return new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

/* ---------- Auth ---------- */
function switchAuth(mode) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.auth === mode));
  $('field-name').style.display = mode === 'register' ? 'block' : 'none';
  $('auth-submit').textContent = mode === 'register' ? 'สมัครสมาชิก 🎉' : 'เข้าสู่ระบบ 🚀';
  $('auth-error').textContent = '';
}

async function handleAuth(e) {
  e.preventDefault();
  const mode = document.querySelector('.auth-tab.active').dataset.auth;
  const email = $('in-email').value.trim();
  const password = $('in-pass').value;
  const name = $('in-name').value.trim();
  const btn = $('auth-submit');
  btn.disabled = true; btn.textContent = 'กำลังดำเนินการ...';
  try {
    const path = mode === 'register' ? '/api/register' : '/api/login';
    const data = await api(path, { method: 'POST', body: JSON.stringify({ email, password, name }) });
    TOKEN = data.token; localStorage.setItem('kt_token', TOKEN);
    ME = data.user;
    enterApp();
  } catch (err) {
    $('auth-error').textContent = '⚠️ ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = mode === 'register' ? 'สมัครสมาชิก 🎉' : 'เข้าสู่ระบบ 🚀';
  }
  return false;
}

async function demoLogin() {
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: 'demo@silelo.app', password: 'demo1234' }) });
    TOKEN = data.token; localStorage.setItem('kt_token', TOKEN);
    ME = data.user;
    enterApp();
    toast('เข้าสู่ระบบบัญชีหลักแล้ว · ไร้ขีดจำกัด ∞');
  } catch (err) { $('auth-error').textContent = '⚠️ ' + err.message; }
}

async function logout() {
  TOKEN = ''; localStorage.removeItem('kt_token'); ME = null;
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  $('app').style.display = 'none';
  $('auth-screen').style.display = 'flex';
  $('in-email').value = ''; $('in-pass').value = '';
  switchAuth('login');
}

function enterApp() {
  $('auth-screen').style.display = 'none';
  $('app').style.display = 'flex';
  renderProfile();
  loadDashboard();
  loadChatHistory();
  connectWS();
  initMap();
  go('home');
  // PWA install prompt
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

/* ---------- Navigation ---------- */
let currentTab = 'home';
function go(tab) {
  currentTab = tab;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + tab).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (tab === 'home') loadDashboard();
  if (tab === 'map' && map) setTimeout(() => map.invalidateSize(), 120);
  if (tab === 'me') { showSub(null); renderProfile(); }
  if (tab === 'voice') loadMemories();
  $('main').scrollTop = 0;
}

function showSub(name) {
  document.querySelectorAll('.sub-screen').forEach(s => s.classList.remove('active'));
  if (name) {
    $('sub-' + name).classList.add('active');
    if (name === 'payments') loadPackage();
    if (name === 'analytics') loadAnalytics();
    if (name === 'settings') fillSettings();
  }
}

/* ---------- Profile ---------- */
function renderProfile() {
  if (!ME) return;
  const init = (ME.name || 'K').trim().charAt(0).toUpperCase();
  $('h-avatar').textContent = init;
  $('profile-avatar').textContent = init;
  $('welcome-name').textContent = ME.name;
  $('profile-name').textContent = ME.name;
  $('profile-email').textContent = ME.email;
  const isUnlimited = ME.unlimited || ME.plan === 'Unlimited' || ME.role === 'owner';
  $('profile-plan').textContent = 'Plan: ' + (ME.plan || 'Professional') + (isUnlimited ? ' ∞' : '');
  const vipPill = document.querySelector('.pro-pill');
  if (vipPill) vipPill.textContent = isUnlimited ? '👑 บัญชีหลัก · ไร้ขีดจำกัด' : '⚡ PRO Client';
}

function fillSettings() {
  $('set-name').value = ME.name || '';
  $('set-email').value = ME.email || '';
}

async function saveSettings() {
  const name = $('set-name').value.trim();
  if (!name) return toast('กรุณากรอกชื่อ');
  try {
    // จำลองการบันทึก (ในเวอร์ชันจริงจะ PATCH ไปที่ /api/me)
    ME.name = name;
    localStorage.setItem('kt_profile', JSON.stringify(ME));
    renderProfile();
    toast('บันทึกการตั้งค่าแล้ว ✅');
  } catch (e) { toast('ไม่สามารถบันทึกได้'); }
}

/* ---------- Dashboard ---------- */
async function loadDashboard() {
  try {
    const [s, tx] = await Promise.all([api('/api/stats'), api('/api/transactions')]);
    const st = s.stats;
    $('stat-users').textContent = (st.monthlyUsers / 1000).toFixed(1).replace('.', ',') + 'k';
    $('stat-revenue').textContent = '$' + (st.revenue / 1000).toFixed(1) + 'k';
    $('stat-paid').textContent = money(st.paidSoFar);
    const paidUp = $('stat-paid-up');
    if (paidUp) paidUp.textContent = (st.paidSoFar >= st.packageTotal) ? '3 / 3 งวด · ครบแล้ว 🎉' : '2 / 3 งวด';
    renderTx(tx.transactions);
    renderRevenueChart(st);
  } catch (e) { /* เงียบเมื่อ offline */ }
}

function renderTx(list) {
  const el = $('tx-list');
  if (!list || list.length === 0) { el.innerHTML = '<p style="color:var(--muted);padding:14px 0;font-size:.85rem">ยังไม่มีธุรกรรม</p>'; return; }
  el.innerHTML = list.slice(0, 4).map(t => `
    <div class="tx-item">
      <span class="tx-ic ${t.milestoneId === 3 ? 'out' : ''}">${t.milestoneId === 3 ? '📦' : '💰'}</span>
      <div class="tx-info"><b>${t.title}</b><small>${t.method} · ${timeAgo(t.time)}</small></div>
      <span class="tx-amt">${money(t.amount)}</span>
    </div>`).join('');
}

function renderRevenueChart(st) {
  if (charts.revenue) { charts.revenue.destroy(); }
  const ctx = $('chart-revenue').getContext('2d');
  charts.revenue = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.','ม.ค.','ก.พ.'],
      datasets: [{
        label: 'รายได้ ($)',
        data: [12400,16800,21500,26200,31900,37100,42850],
        borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,.12)',
        fill: true, tension: .45, pointRadius: 3, pointBackgroundColor: '#22d3ee', borderWidth: 2.5
      }]
    },
    options: chartOpts()
  });
}

function chartOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#9aa3c7', font: { size: 10 } } },
      y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#9aa3c7', font: { size: 10 }, callback: v => '$' + (v/1000).toFixed(0) + 'k' } }
    }
  };
}

/* ---------- AI Assistant ---------- */
function addAIMsg(text, me = false) {
  const area = $('ai-chat');
  const div = document.createElement('div');
  div.className = 'msg ' + (me ? 'me' : 'ai');
  div.innerHTML = `<div class="bubble">${text}</div>` + (me ? '' : '<div class="meta">Silelo AI · กำลังตอบ...</div>');
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return div;
}

function aiReply(q) {
  const t = (q || '').toLowerCase();
  if (t.includes('สรุป') || t.includes('โปรเจก')) return '📋 **สรุปโปรเจกต์ของคุณ**\n• ขั้นตอน: กำลังพัฒนา (สัปดาห์ที่ 5/8)\n• ดีไซน์ UX/UI: ✅ เสร็จสิ้น\n• เทคโนโลยี: Flutter + Firebase\n• งวดชำระ: 3/3 ครบเต็ม ($12,999) 🎉\n• กำหนดส่งมอบ: อีก 3 สัปดาห์';
  if (t.includes('ยอดขาย') || t.includes('วิเคราะห์') || t.includes('รายได้')) return '📊 **วิเคราะห์ยอดขายเดือนนี้**\n• รายได้รวม: $42,850 (▲24.5%)\n• ผู้ใช้รายเดือน: 24,800 (▲18.4%)\n• อัตราคงอยู่: 45.2%\n• สินค้าขายดี: แพ็กเกจ PRO (32% ของยอด)\n💡 แนะนำ: เพิ่มโปรโมชันช่วงสุดสัปดาห์เพื่อเพิ่ม conversion';
  if (t.includes('ฟีเจอร์') || t.includes('แนะนำ')) return '💡 **3 ฟีเจอร์แนะนำถัดไป**\n1. 🤖 แชท AI ตอบลูกค้าอัตโนมัติ (ลด workload 60%)\n2. 🎯 Push notification เฉพาะบุคคล (เพิ่ม Retention +23%)\n3. 🧾 ใบเสร็จดิจิทัล + ระบบสมาชิก (เพิ่มรายได้ประจำ)';
  if (t.includes('สวัสดี') || t.includes('hi') || t.includes('hello')) return 'สวัสดีครับ! 😊 มีอะไรให้ผมช่วยไหมครับ? ลองถามเรื่องสรุปโปรเจกต์ วิเคราะห์ยอดขาย หรือแนะนำฟีเจอร์ได้เลย';
  if (t.includes('ขอบคุณ') || t.includes('thank')) return 'ด้วยความยินดีครับ! 🙌 มีอะไรเพิ่มเติมเรียกใช้ผมได้ตลอดนะครับ';
  return 'ขอบคุณสำหรับคำถามครับ 🤖 ผมเข้าใจคำถามว่า: "' + q + '"\n\nในเวอร์ชันเต็ม ระบบนี้เชื่อมต่อกับ AI (เช่น GPT / Gemini) เพื่อตอบคำถามเฉพาะธุรกิจของคุณได้แบบเรียลไทม์ — ตอนนี้เป็นโหมดสาธิตครับ ลองถามผมเรื่อง "สรุปโปรเจกต์" "วิเคราะห์ยอดขาย" หรือ "แนะนำฟีเจอร์" ได้เลยครับ';
}

let aiTyping = false;
let aiHistory = []; // ประวัติสนทนา — ส่งให้ AI เพื่อจำบริบท
async function sendAI() {
  const inp = $('ai-input');
  const q = inp.value.trim();
  if (!q || aiTyping) return;
  inp.value = '';
  addAIMsg(escapeHtml(q), true);
  aiTyping = true;
  const typing = addAIMsg('<span class="typing">🤖 กำลังคิด...</span>');
  let reply = null;
  try {
    // 🔌 เรียก API AI ผ่าน server (OpenRouter :free → mock)
    aiHistory.push({ role: 'user', content: q });
    const data = await api('/api/ai', { method: 'POST', body: JSON.stringify({ question: q, messages: aiHistory.slice(-10) }) });
    reply = data.reply || aiReply(q);
    if (data.provider === 'openrouter') aiHistory.push({ role: 'assistant', content: reply });
    else aiHistory.length = Math.max(0, aiHistory.length - 1); // mock ไม่เก็บ (ตอบไม่ตรงบริบท)
  } catch (e) {
    await new Promise(r => setTimeout(r, 600));
    reply = aiReply(q); // fallback โหมดสำเร็จรูปเมื่อออฟไลน์
    aiHistory.length = Math.max(0, aiHistory.length - 1);
  }
  typing.querySelector('.bubble').innerHTML = reply.replace(/\*\*/g, '').replace(/\n/g, '<br>');
  aiTyping = false;
  $('ai-chat').scrollTop = $('ai-chat').scrollHeight;
}

document.querySelectorAll('.suggest').forEach(b => {
  b.addEventListener('click', () => {
    $('ai-input').value = b.dataset.q;
    aiSend();
  });
});

/* ---------- AI สร้างภาพ (Ideogram) ---------- */
let aiMode = 'chat';
function setAIMode(m) {
  aiMode = m;
  document.querySelectorAll('#ai-mode-toggle .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('ai-suggest').style.display = m === 'image' ? 'none' : '';
  const inp = $('ai-input');
  inp.placeholder = m === 'image' ? 'บรรยายภาพที่อยากได้ เช่น "โลโก้ Silelo สีทอง-ฟ้า"...' : 'พิมพ์ข้อความ...';
  if (m === 'image' && !document.querySelector('#ai-chat .img-note')) {
    const n = addAIMsg('🎨 <b>โหมดสร้างภาพ</b> — พิมพ์บรรยายภาพ แล้ว Ideogram AI จะวาดให้ (เช่น <i>"โลโก้ Silelo 3 มิติ สีทองและน้ำเงิน ประกายดาว"</i>)');
    n.classList.add('img-note');
  }
  inp.focus();
}
function aiSend() { aiMode === 'image' ? sendAIImage() : sendAI(); }

let aiImgBusy = false;
async function sendAIImage() {
  const inp = $('ai-input');
  const q = inp.value.trim();
  if (!q || aiImgBusy) return;
  inp.value = '';
  addAIMsg(escapeHtml(q), true);
  aiImgBusy = true;
  const typing = addAIMsg('<span class="typing">🎨 กำลังวาดภาพ...</span>');
  try {
    const data = await api('/api/ai/image', { method: 'POST', body: JSON.stringify({ prompt: q, aspect_ratio: '1:1' }) });
    const bubble = typing.querySelector('.bubble');
    if (data.ok && data.dataUrl) {
      const provLabel = data.provider === 'ideogram' ? 'Ideogram AI' : data.provider === 'openrouter' ? 'Gemini AI' : 'AI (บริการฟรี)';
      const note = data.note ? '<div style="opacity:.65;font-size:.72rem;margin-top:2px">ℹ️ ' + escapeHtml(data.note) + '</div>' : '';
      bubble.innerHTML = '<img class="ai-img" src="' + data.dataUrl + '" alt="ภาพ AI"><div class="img-actions"><a class="img-dl" href="' + data.dataUrl + '" download="silelo-ai.png">⬇️ ดาวน์โหลด</a></div><small style="opacity:.6">🎨 สร้างโดย ' + provLabel + ' · ' + Math.max(1, (data.size / 1024) | 0) + ' KB</small>' + note;
    } else {
      bubble.innerHTML = '⚠️ ' + escapeHtml(data.error || 'สร้างภาพไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  } catch (e) {
    typing.querySelector('.bubble').innerHTML = '⚠️ ไม่สามารถสร้างภาพได้ (เซิร์ฟเวอร์ออฟไลน์) — ลองใหม่อีกครั้ง';
  }
  aiImgBusy = false;
  $('ai-chat').scrollTop = $('ai-chat').scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ---------- Realtime Chat (WebSocket) ---------- */
function connectWS() {
  if (ws) { try { ws.close(); } catch(e){} }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { $('chat-status').textContent = 'เชื่อมต่อแล้ว · ออนไลน์'; };
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'welcome') {
        $('online-count').textContent = data.online;
      } else if (data.type === 'message') {
        renderChatMsg(data.message, false);
        $('online-count').textContent = (parseInt($('online-count').textContent) || 1) + 0;
      }
    } catch (e) {}
  };
  ws.onclose = () => { $('chat-status').textContent = 'ตัดการเชื่อมต่อ · ลองใหม่...'; setTimeout(connectWS, 3000); };
}

async function loadChatHistory() {
  try {
    const data = await api('/api/messages');
    const area = $('chat-area');
    area.innerHTML = '<div class="chat-date">— เริ่มแชท —</div>';
    data.messages.forEach(m => renderChatMsg(m, m.userId === (ME && ME.id)));
    area.scrollTop = area.scrollHeight;
  } catch (e) {}
}

function renderChatMsg(m, isMe) {
  const area = $('chat-area');
  const div = document.createElement('div');
  div.className = 'msg ' + (isMe ? 'me' : 'ai');
  const t = new Date(m.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<div class="bubble">${escapeHtml(m.text)}</div><div class="meta">${isMe ? 'คุณ' : m.user} · ${t}</div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function sendChat() {
  const inp = $('chat-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'message', token: TOKEN, text }));
    renderChatMsg({ text, user: ME.name, userId: ME.id, time: Date.now() }, true);
  } else {
    api('/api/messages', { method: 'POST', body: JSON.stringify({ text }) })
      .then(d => renderChatMsg(d.message, true))
      .catch(() => toast('ไม่สามารถส่งข้อความได้'));
  }
}

/* ---------- Map ---------- */
function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false }).setView([23.7806, 90.4142], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '' }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const places = [
    { lat: 23.7806, lng: 90.4142, icon: '🏢', title: 'Silelo HQ', desc: 'Gulshan Avenue, Dhaka' },
    { lat: 13.7563, lng: 100.5018, icon: '🤝', title: 'พันธมิตร — Bangkok', desc: 'ทีมพัฒนา Flutter' },
    { lat: 1.3521, lng: 103.8198, icon: '☁️', title: 'เซิร์ฟเวอร์ — Singapore', desc: 'Firebase / Node.js' }
  ];
  places.forEach(p => {
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ html: `<div class="map-marker">${p.icon}</div>`, className: '', iconSize: [40, 40], iconAnchor: [20, 38] }),
      title: p.title
    }).addTo(map).bindPopup(`<b>${p.title}</b><br><small>${p.desc}</small>`);
  });
}

/* ---------- Payments ---------- */
let payMilestone = null;

async function loadPackage() {
  try {
    const data = await api('/api/package');
    const pkg = data.package;
    $('pkg-name').textContent = pkg.name;
    $('pkg-price').textContent = money(pkg.price);
    const paid = data.paidMilestones || [];
    $('milestones').innerHTML = pkg.milestones.map((m, i) => {
      const done = paid.includes(m.id);
      return `<div class="ms ${done ? 'done' : 'pending'}">
        <div class="ms-num">${done ? '✓' : i + 1}</div>
        <div class="ms-info"><b>${m.title}</b><small>${m.subtitle}</small></div>
        <div style="text-align:right">
          <div class="ms-amt">${money(m.amount)}</div>
          ${done ? '<span class="ms-status done">ชำระแล้ว</span>'
                : `<button class="pay-btn" onclick="openPay(${m.id})">ชำระเงิน</button>`}
        </div>
      </div>`;
    }).join('');
    const allPaid = paid.length >= pkg.milestones.length;
    const banner = $('vip-banner');
    if (banner) banner.style.display = allPaid ? 'flex' : 'none';
    // transactions
    const tx = await api('/api/transactions');
    $('tx-full-list').innerHTML = tx.transactions.length
      ? tx.transactions.map(t => `<div class="tx-row"><span><b>${t.title}</b><br><span class="t">${t.method} · ${timeAgo(t.time)}</span></span><b style="color:var(--green)">${money(t.amount)}</b></div>`).join('')
      : '<p style="color:var(--muted);font-size:.8rem">ยังไม่มีประวัติการชำระ</p>';
  } catch (e) {}
}

function openPay(id) {
  payMilestone = id;
  const pkg = { 1: 3900, 2: 5200, 3: 3899 };
  const names = { 1: 'Kickoff Payment', 2: 'Finish UX/UI Design', 3: 'Final Delivery' };
  $('pay-title').textContent = 'ชำระเงิน — ' + names[id];
  $('pay-amount').textContent = money(pkg[id]);
  $('pay-modal').classList.add('open');
}

function closeModal(id) { $('pay-modal').classList.remove('open'); }

function selectMethod(btn) {
  document.querySelectorAll('.pay-method').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const isCard = btn.dataset.method === 'card';
  $('card-fields').style.display = isCard ? 'block' : 'none';
  $('qr-box').style.display = isCard ? 'none' : 'block';
}

async function confirmPay() {
  const method = document.querySelector('.pay-method.active').dataset.method;
  const card = $('pay-card').value || '4242';
  const btn = $('pay-btn');
  btn.disabled = true; btn.textContent = 'กำลังประมวลผล...';
  await new Promise(r => setTimeout(r, 900));
  try {
    const data = await api('/api/pay', { method: 'POST', body: JSON.stringify({ milestoneId: payMilestone, method, card }) });
    closeModal('pay-modal');
    toast('ชำระเงินสำเร็จ ✅ ' + money(data.transaction.amount));
    loadPackage();
    loadDashboard();
    ME = data && { ...ME, milestonesPaid: data.paidMilestones } || ME;
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'ยืนยันการชำระเงิน';
  }
}

/* ---------- Analytics ---------- */
function loadAnalytics() {
  if (charts.users) charts.users.destroy();
  if (charts.retention) charts.retention.destroy();
  const ctx1 = $('chart-users').getContext('2d');
  charts.users = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: ['ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.','ม.ค.','ก.พ.'],
      datasets: [{
        label: 'ผู้ใช้', data: [8200,10400,12800,15100,18600,21900,24800],
        backgroundColor: 'rgba(99,102,241,.7)', borderRadius: 8, borderSkipped: false
      }]
    },
    options: { ...chartOpts(), plugins: { legend: { display: false }, title: { display: true, text: 'ผู้ใช้รายเดือน', color: '#eef1ff', font: { size: 13, weight: '600' } } } }
  });
  const ctx2 = $('chart-retention').getContext('2d');
  charts.retention = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: ['ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.','ม.ค.','ก.พ.'],
      datasets: [{
        label: 'Retention (%)', data: [38,41,39,43,44,42,45],
        borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.12)',
        fill: true, tension: .45, pointRadius: 3, pointBackgroundColor: '#34d399', borderWidth: 2.5
      }]
    },
    options: { ...chartOpts(), plugins: { legend: { display: false }, title: { display: true, text: 'อัตราการคงอยู่ผู้ใช้ (Retention)', color: '#eef1ff', font: { size: 13, weight: '600' } } } }
  });
}

/* ---------- Init ---------- */
(async function init() {
  if (TOKEN) {
    try {
      const data = await api('/api/me');
      ME = data.user;
      enterApp();
      return;
    } catch (e) {
      TOKEN = ''; localStorage.removeItem('kt_token');
    }
  }
  $('auth-screen').style.display = 'flex';
})();

/* ================== 📞 ระบบโทรคุยเสียงสลี่ (ตามโครงการ Silelo) ================== */
let voiceRec = null, voiceChunks = [], voiceRecording = false, voiceContinuous = false, voicePlaying = false, voiceLoopTimer = null;

function voiceStatus(txt, cls) {
  const el = $('#voice-status');
  if (el) el.textContent = txt;
  const orb = $('#voice-orb');
  if (orb) orb.className = 'voice-orb' + (cls ? ' ' + cls : '');
}

function voiceSay(txt) { // แสดงคำพูดที่ได้ยิน
  const el = $('#voice-last');
  if (el) el.innerHTML = '<div class="voice-bubble">🗣 ' + txt + '</div>';
}

async function loadMemories() {
  try {
    const d = await api('/api/memories');
    const wrap = $('#voice-memories'), list = $('#voice-mem-list');
    if (d.ok && d.memories && d.memories.length) {
      list.innerHTML = d.memories.slice().reverse().slice(0, 8).map(m => '<div class="mem-chip">💍 ' + m.fact + '</div>').join('');
      wrap.style.display = 'block';
    } else wrap.style.display = 'none';
  } catch (e) {}
}

function ensureVoiceScreen() { if (currentTab === 'voice') loadMemories(); }

// —— บันทึกเสียง (กดค้างพูด) ——
async function pttStart(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (voiceRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('เบราว์เซอร์นี้ไม่รองรับไมโครโฟน — ใช้ Chrome/Safari ล่าสุด');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    voiceRec = new MediaRecorder(stream);
    voiceRec.ondataavailable = ev => { if (ev.data.size) voiceChunks.push(ev.data); };
    voiceRec.onstop = () => { stream.getTracks().forEach(t => t.stop()); processVoice(); };
    voiceRec.start();
    voiceRecording = true;
    voiceStatus('🎤 สลี่กำลังฟังพี่นุ...', 'rec');
  } catch (err) {
    alert('ไม่สามารถเปิดไมโครโฟนได้: ' + err.message);
  }
}

function pttEnd(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (voiceRecording && voiceRec && voiceRec.state === 'recording') {
    voiceRec.stop();
    voiceRecording = false;
  }
}

async function processVoice() {
  if (!voiceChunks.length) { voiceStatus('ไม่ได้ยินเสียง — ลองอีกครั้ง'); return; }
  const blob = new Blob(voiceChunks, { type: voiceChunks[0].type || 'audio/webm' });
  voiceStatus('🧠 กำลังฟัง (Whisper)...', 'think');
  // STT
  let text = '';
  try {
    const fd = new FormData();
    fd.append('audio', blob, 'voice.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'));
    const d = await api('/api/stt', { method: 'POST', body: fd });
    text = d.text || '';
  } catch (e) { voiceStatus('⚠️ ไม่ได้ยินเสียง: ' + e.message); return; }
  voiceSay(text);
  // AI
  voiceStatus('💭 สลี่กำลังคิด...', 'think');
  let reply = '';
  try {
    const d = await api('/api/ai', { method: 'POST', body: JSON.stringify({ question: text, messages: [] }) });
    reply = d.reply || 'สลี่ฟังไม่ทันค่ะ';
  } catch (e) { reply = 'สลี่ขอโทษนะคะ ตอนนี้ติดขัดนิดหน่อย'; }
  // TTS + เล่นเสียง
  voiceStatus('🔊 สลี่กำลังพูด...', 'talk');
  try {
    const audio = await apiTTS(reply);
    if (audio) {
      const url = URL.createObjectURL(audio);
      const au = new Audio(url);
      voicePlaying = true;
      au.onended = () => { voicePlaying = false; URL.revokeObjectURL(url); afterVoiceReply(); };
      au.onerror = () => { voicePlaying = false; afterVoiceReply(); };
      await au.play();
    } else afterVoiceReply();
  } catch (e) { afterVoiceReply(); }
  const bubble = document.querySelector('#ai-chat');
  if (bubble) {
    const d = document.createElement('div');
    d.className = 'msg ai';
    d.innerHTML = '<div class="bubble">' + escapeHtml(reply) + '</div>';
    bubble.appendChild(d);
    bubble.scrollTop = bubble.scrollHeight;
  }
}

function afterVoiceReply() {
  if (voiceContinuous) {
    voiceStatus('🎧 โหมดคุยต่อเนื่อง — พูดได้เลย', 'cont');
    voiceLoopTimer = setTimeout(() => { if (voiceContinuous && !voiceRecording) pttStart(); }, 1200);
  } else {
    voiceStatus('กดปุ่มเพื่อคุยกับสลี่');
  }
}

// —— TTS: ขอเสียงจาก server ——
async function apiTTS(text) {
  try {
    const d = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('silelo_token') || '') },
      body: JSON.stringify({ text: String(text).slice(0, 1900) })
    });
    if (!d.ok) return null;
    return await d.blob();
  } catch (e) { return null; }
}

// —— โหมดคุยต่อเนื่อง (กด 📞) ——
function toggleCallMode() {
  voiceContinuous = !voiceContinuous;
  const btn = $('#btn-callmode');
  if (btn) btn.classList.toggle('on', voiceContinuous);
  if (voiceContinuous) {
    voiceStatus('🎧 โหมดคุยต่อเนื่องเปิดแล้ว — สลี่พร้อมฟัง', 'cont');
    setTimeout(() => { if (voiceContinuous) pttStart(); }, 1500);
  } else {
    voiceStatus('กดปุ่มเพื่อคุยกับสลี่');
    clearTimeout(voiceLoopTimer);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}
