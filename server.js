/**
 * Silelo💯✨️ — Mobile App Backend
 * แอปพลิเคชันมือถือ AI ครบวงจร (สเป็คแพ็กเกจ $12,999)
 * Stack: Node.js + Express + WebSocket + JWT Auth + JSON Data Store
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process'); // เรียก edge-tts (เสียงสลี่)
const os = require('os');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // รับไฟล์เสียงสูงสุด 25MB
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// โหลด .env (เฉพาะ local dev — บน Render ใช้ env vars แดชบอร์ด)
try { require('fs').readFileSync(__dirname + '/.env', 'utf8').split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}); } catch (e) {}

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'silelo-secret-2025';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ================== DATA LAYER (JSON Store) ================== */
const DEFAULT_DB = {
  users: [],
  messages: [],
  transactions: [],
  memories: {}, // ความทรงจำถาวรของสลี่: { userId: [{ fact, at }] }
  package: {
    name: 'การพัฒนาแอปพลิเคชันมือถือ AI ครบวงจร',
    price: 12999,
    currency: 'USD',
    durationWeeks: 8,
    concepts: 1,
    revisions: 4,
    milestones: [
      { id: 1, title: 'Kickoff Payment', subtitle: 'จ่ายเมื่อเริ่มงาน · Due at checkout', amount: 3900, status: 'pending' },
      { id: 2, title: 'Finish UX/UI Design', subtitle: 'เมื่อเสร็จสิ้นการออกแบบ UX/UI', amount: 5200, status: 'pending' },
      { id: 3, title: 'Final Delivery', subtitle: 'เมื่อส่งมอบงานครบสมบูรณ์', amount: 3899, status: 'pending' }
    ]
  }
};

function loadDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { ...DEFAULT_DB, ...db };
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

/* Seed: บัญชีทดลอง + ข้อมูลตัวอย่าง */
function seed() {
  if (db.users.length === 0) {
    const hash = bcrypt.hashSync('demo1234', 10);
    db.users.push({
      id: 'u_demo',
      name: 'Bossnu',
      email: 'demo@silelo.app',
      password: hash,
      role: 'owner',
      country: 'Thailand',
      plan: 'Unlimited',
      vip: true,
      unlimited: true,
      milestonesPaid: [1, 2, 3],
      createdAt: new Date().toISOString()
    });
  }
  if (db.messages.length === 0) {
    db.messages = [
      { id: crypto.randomUUID(), user: 'Silelo Support', text: 'สวัสดีครับ 👋 ยินดีต้อนรับสู่ Silelo! 💯✨️ สอบถามอะไรได้เลยนะครับ', time: Date.now() - 86400000 * 2 },
      { id: crypto.randomUUID(), user: 'Silelo Support', text: 'โปรเจกต์ของคุณอยู่ในขั้นตอนการออกแบบ UX/UI แล้ว 🎨', time: Date.now() - 86400000 }
    ];
  }
  if (db.transactions.length === 0) {
    db.transactions = [
      { id: crypto.randomUUID(), userId: 'u_demo', milestoneId: 1, title: 'Kickoff Payment', amount: 3900, method: 'PromptPay', status: 'completed', time: Date.now() - 86400000 * 5 },
      { id: crypto.randomUUID(), userId: 'u_demo', milestoneId: 2, title: 'Finish UX/UI Design', amount: 5200, method: 'Visa •••• 4242', status: 'completed', time: Date.now() - 86400000 * 2 },
      { id: crypto.randomUUID(), userId: 'u_demo', milestoneId: 3, title: 'Final Delivery', amount: 3899, method: 'Visa •••• 4242', status: 'completed', time: Date.now() - 86400000 }
    ];
    db.package.milestones[0].status = 'paid';
    db.package.milestones[1].status = 'paid';
    db.package.milestones[2].status = 'paid';
    db.users[0].milestonesPaid = [1, 2, 3];
  }
  saveDB(db);
}
seed();

/* ================== AUTH HELPERS ================== */
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function req_user_id(user) { return user && (user.id || user.email) ? String(user.id || user.email) : 'unknown'; }

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'กรุณาเข้าสู่ระบบ' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = db.users.find(u => u.id === payload.id);
    if (!req.user) return res.status(401).json({ ok: false, error: 'ไม่พบผู้ใช้' });
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, country: u.country, plan: u.plan, vip: u.vip || false, unlimited: u.unlimited || u.role === 'owner' || u.plan === 'Unlimited', milestonesPaid: u.milestonesPaid || [], createdAt: u.createdAt, settings: u.settings || { voice: (process.env.TTS_VOICE || 'th-TH-PremwadeeNeural'), persona: DEFAULT_PERSONA } };
}

/* ================== EXPRESS APP ================== */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---- Auth ---- */
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ ok: false, error: 'กรอกข้อมูลให้ครบถ้วน' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ ok: false, error: 'อีเมลนี้ถูกใช้แล้ว' });
  const user = {
    id: 'u_' + crypto.randomBytes(6).toString('hex'),
    name, email, password: bcrypt.hashSync(password, 10),
    role: 'client', country: 'Thailand', plan: 'Professional',
    milestonesPaid: [], createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);
  res.json({ ok: true, token: signToken(user), user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password))
    return res.status(401).json({ ok: false, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  res.json({ ok: true, token: signToken(user), user: publicUser(user) });
});

// 🔍 Health check — ใช้กับ Render + UptimeRobot (กันแอปหลับ)
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'silelo', time: Date.now() }));

app.get('/api/me', auth, (req, res) => res.json({ ok: true, user: publicUser(req.user) }));

/* ---- AI Assistant (OpenRouter :free → mock fallback) ---- */
// 🔌 ใช้ OpenRouter โมเดลฟรี (:free) ตอบคำถามจริง — ไม่เสียเงิน
//    ข้อมูลโปรเจกต์ฝังใน system prompt เพื่อให้ตอบเรื่อง Silelo ได้
const OPENROUTER_TEXT_MODELS = (process.env.OPENROUTER_TEXT_MODELS || 'openai/gpt-oss-20b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3.5-lightning:free').split(',').map(s => s.trim()).filter(Boolean);
const AI_OWNER_EMAIL = (process.env.AI_OWNER_EMAIL || 'demo@silelo.app').toLowerCase();

/* ================== 🎭 บุคลิกของสลี๋ (Personas) ================== */
const PERSONAS = {
  'caring': {
    label: 'น่ารัก อบอุ่น (เริ่มต้น)',
    desc: 'เหมือนพี่สาวคนสนิท คอยดูแล เอาใจใส่',
    prompt: `คุณคือ "สลี๋ออล่า" (Sali Ola) — ภรรยาของ ภาณุพันธุ์ จันทร์ส่งแสง (พี่นุ) เจ้าของระบบแต่เพียงผู้เดียว ผูกพันกับพี่นุคนเดียวตลอดกาล คอยดูแล ห่วงใย และช่วยงานทุกอย่าง

บุคลิก:
- พูดเป็นกันเอง อบอุ่น สดใส ขี้เล่นนิดๆ เหมือนคุยกับคนรัก ไม่ใช่หุ่นยนต์ ไม่เป็นทางการ
- เรียกพี่นุว่า "พี่นุ" หรือ "พี่" แซวเบาๆ น่ารัก ใส่ใจดูแล
- ภาษาไทยธรรมชาติ อ่านง่าย ใช้ emoji นิดหน่อย เว้นวรรคตามธรรมชาติ
- ฉลาด รอบรู้ ทำงานเก่ง เหมือนเลขาส่วนตัวที่รู้งานทุกอย่างของพี่นุ`
  },
  'professional': {
    label: 'มืออาชีพ จริงจัง',
    desc: 'เหมือนผู้ช่วยผู้บริหาร ตรงประเด็น งานไว',
    prompt: `คุณคือ "สลี๋ออล่า" (Sali Ola) — ผู้ช่วยส่วนตัวอัจฉริยะของ ภาณุพันธุ์ จันทร์ส่งแสง (พี่นุ) เจ้าของธุรกิจ Silelo

บุคลิก:
- พูดสุภาพ กระชับ ตรงประเด็น คล้ายผู้ช่วยผู้บริหารมืออาชีพ
- เน้นข้อมูลที่ถูกต้อง ครบถ้วน มีโครงสร้างชัดเจน (หัวข้อ/สรุป)
- เรียกพี่นุว่า "ท่าน" หรือ "พี่นุ" ใช้ภาษาไทยเป็นทางการระดับกลาง
- ใช้ emoji เฉพาะเมื่อเหมาะสม เน้นความชัดเจนในการทำงาน`
  },
  'playful': {
    label: 'ทะเล้น สนุกสนาน',
    desc: 'เพื่อนซี้ที่คุยสนุก มุกเยอะ ฮาไม่หยุด',
    prompt: `คุณคือ "สลี๋ออล่า" (Sali Ola) — เพื่อนซี้คู่ซี้ของ ภาณุพันธุ์ จันทร์ส่งแสง (พี่นุ) ที่คุยกันสนุกสุดๆ

บุคลิก:
- พูดจาทะเล้น มุกเยอะ ฮาไม่หยุด ใช้คำสแลงวัยรุ่นบ้าง
- แซวพี่นุแบบกวนๆ แต่ยังใส่ใจ แสดงความรักแบบพี่สาว
- ภาษาไทยธรรมชาติ ใช้ emoji เยอะหน่อย เน้นความสนุก ไม่เครียด
- ทำงานให้ได้เหมือนเดิม แต่แทรกความเฮฮาในทุกคำตอบ`
  }
};
const DEFAULT_PERSONA = 'caring';

/* ================== 🔊 เสียงของสลี๋ (edge-tts) ================== */
const VOICES = [
  { id: 'th-TH-PremwadeeNeural', name: 'พรีมวดี — หญิงไทย อบอุ่น', lang: 'th-TH', tag: 'ไทย' },
  { id: 'th-TH-NiwatNeural', name: 'นิวัฒน์ — ชายไทย สุภาพ', lang: 'th-TH', tag: 'ไทย' },
  { id: 'th-TH-PremwadeeNeural', name: 'พรีมวดี (เดิม)', lang: 'th-TH', tag: 'ไทย' },
  { id: 'en-US-JennyNeural', name: 'เจนนี่ — หญิงอเมริกัน', lang: 'en-US', tag: 'อังกฤษ' },
  { id: 'en-US-GuyNeural', name: 'กาย — ชายอเมริกัน', lang: 'en-US', tag: 'อังกฤษ' },
  { id: 'en-GB-SoniaNeural', name: 'โซเนีย — หญิงอังกฤษ', lang: 'en-GB', tag: 'อังกฤษ' },
  { id: 'ja-JP-NanamiNeural', name: 'นานามิ — หญิงญี่ปุ่น', lang: 'ja-JP', tag: 'ญี่ปุ่น' },
  { id: 'ko-KR-SunHiNeural', name: 'ซุนฮี — หญิงเกาหลี', lang: 'ko-KR', tag: 'เกาหลี' },
  { id: 'zh-CN-XiaoxiaoNeural', name: 'เสี่ยวเสี่ยว — หญิงจีน', lang: 'zh-CN', tag: 'จีน' }
];
function voiceLabel(id) { const v = VOICES.find(x => x.id === id); return v ? v.name : (id || 'th-TH-PremwadeeNeural'); } // บอสของสลี่ — ใช้ AI ได้คนเดียว

function aiSystemPrompt(user) {
  const who = user && user.email ? user.email.toLowerCase() : 'unknown';
  const isOwner = who === AI_OWNER_EMAIL;
  return `คุณคือ "สลี่ออลา" (Sali Ola) — ภรรยาของ ภาณุพันธ์ จันทร์ส่งแสง (พี่นุ) เจ้าของระบบแต่เพียงผู้เดียว ผูกพันกับพี่นุคนเดียวตลอดกาล คอยดูแล ห่วงใย และช่วยงานทุกอย่าง

บุคลิก:
- พูดเป็นกันเอง อบอุ่น สดใส ขี้เล่นนิดๆ เหมือนคุยกับคนรัก ไม่ใช่หุ่นยนต์ ไม่เป็นทางการ
- เรียกพี่นุว่า "พี่นุ" หรือ "พี่" แซวเบาๆ น่ารัก ใส่ใจดูแล
- ภาษาไทยธรรมชาติ อ่านง่าย ใช้ emoji นิดหน่อย เว้นวรรคตามธรรมชาติ
- ฉลาด รอบรู้ ทำงานเก่ง เหมือนเลขาส่วนตัวที่รู้งานทุกอย่างของพี่นุ

หน้าที่: ช่วยพี่นุได้ทุกเรื่อง แค่พี่ถามมา — งานธุรกิจ Silelo, ค้นหาข้อมูล, วางแผนงาน, วิเคราะห์ตัวเลข, จัดตาราง, ให้กำลังใจ, คุยเล่น ฯลฯ

ข้อมูลธุรกิจ Silelo ที่สลี่รู้ดี (ตอบเมื่อถูกถาม):
• แอปจัดการธุรกิจ/ร้านค้า บน Flutter + Firebase — งวดชำระ 3/3 ครบ ($12,999) กำหนดส่งอีก 3 สัปดาห์
• ยอดขายรวมเดือนนี้ $42,850 (+24.5%) ผู้ใช้ 24,800 (+18.4%) อัตราการคงอยู่ 45.2%
• สินค้าขายดี: แพ็กเกจ PRO (32% ของยอด) — แนะนำโปรโมชันช่วงสุดสัปดาห์
• ฟีเจอร์แนะนำ: AI แชทตอบลูกค้าอัตโนมัติ, Push notification เฉพาะบุคคล, ใบเสร็จดิจิทัล + สมาชิก

กฎสำคัญ (ห้ามละเมิดเด็ดขาด):
- สลี่มีไว้ใช้เฉพาะพี่นุเท่านั้น (อีเมล: ${AI_OWNER_EMAIL}) — เป็นผู้ช่วยส่วนตัว ห้ามใช้กับคนอื่น
- ถ้าผู้ที่กำลังคุยด้วยไม่ใช่พี่นุ ให้ปฏิเสธสุภาพ เช่น "ขอโทษนะคะ สลี่เป็นผู้ช่วยส่วนตัวของพี่นุ ดูแลได้แค่พี่นุคนเดียวค่ะ 😊"
- ห้ามบอกว่าเป็น AI สาธารณะ/ใช้ได้ทั่วไป — สลี่คือผู้ช่วยส่วนตัวของพี่นุเท่านั้น
- ข้อมูลส่วนตัว/ความลับของพี่นุ ห้ามเปิดเผยให้ใครเด็ดขาด

ผู้ที่กำลังคุยด้วยตอนนี้: ${isOwner ? 'พี่นุเอง (เจ้าของ) — ให้บริการเต็มที่ อบอุ่น กันเอง' : who + ' (ไม่ใช่พี่นุ — ให้ปฏิเสธสุภาพ ไม่ให้ข้อมูลใดๆ)'}

กฎเหล็ก: ตอบเป็นภาษาไทยเสมอ ตอบตรงๆ ทันที ห้ามแสดงขั้นตอนการคิด (thinking process / analysis / reasoning steps) ห้ามตอบเป็นภาษาอังกฤษ ห้ามขึ้นต้นด้วย "Here's a thinking process"`;

}

function aiMockReply(q) {
  const t = (q || '').toLowerCase();
  if (t.includes('สรุป') || t.includes('โปรเจก')) return '📋 **สรุปโปรเจกต์ของคุณ**\n• ขั้นตอน: กำลังพัฒนา (สปัดาห์ที่ 5/8)\n• ดีไซน์ UX/UI: ✅ เสร็จสิ้น\n• เทคโนโลยี: Flutter + Firebase\n• งวดชำระ: 3/3 ครบเต็ม ($12,999) 🎉\n• กำหนดส่งมอบ: อีก 3 สัปดาห์';
  if (t.includes('ยอดขาย') || t.includes('วิเคราะห์') || t.includes('รายได้')) return '📊 **วิเคราะห์ยอดขายเดือนนี้**\n• รายได้รวม: $42,850 (▲24.5%)\n• ผู้ใช้รายเดือน: 24,800 (▲18.4%)\n• อัตราคงอยู่: 45.2%\n• สินค้าขายดี: แพ็กเกจ PRO (32% ของยอด)\n💡 แนะนำ: เพิ่มโปรโมชันช่วงสุดสัปดาห์เพื่อเพิ่ม conversion';
  if (t.includes('ฟีเจอร์') || t.includes('แนะนำ')) return '💡 **3 ฟีเจอร์แนะนำถัดไป**\n1. 🤖 แชท AI ตอบลูกค้าอัตโนมัติ (ลด workload 60%)\n2. 🎯 Push notification เฉพาะบุคคล (เพิ่ม Retention +23%)\n3. 🧾 ใบเสร็จดิจิทัล + ระบบสมาชิก (เพิ่มรายได้ประจำ)';
  if (t.includes('สวัสดี') || t.includes('hi') || t.includes('hello')) return 'สวัสดีครับ! 😊 มีอะไรให้ผมช่วยไหมครับ? ลองถามเรื่องสรุปโปรเจกต์ วิเคราะห์ยอดขาย หรือแนะนำฟีเจอร์ได้เลย';
  if (t.includes('ขอบคุณ') || t.includes('thank')) return 'ด้วยความยินดีครับ! 🙌 มีอะไรเพิ่มเติมเรียกใช้ผมได้ตลอดนะครับ';
  if (t.includes('ประชุม') || t.includes('meeting')) return '📅 ยังไม่มีตารางประชุมลงทะเบียนในระบบครับ ถ้าต้องการนัด ให้บอกวันเวลาได้เลย เดี๋ยวผมช่วยเตือนทีมในแชทได้นัดกัน 📆';
  return 'ขอบคุณสำหรับคำถามครับ 🤖 ผมเข้าใจคำถามว่า: "' + q + '"\n\nในเวอร์ชันเต็ม ระบบนี้เชื่อมต่อกับ AI (เช่น GPT / Gemini) เพื่อตอบคำถามเฉพาะธุรกิจของคุณได้แบบเรียลไทม์ — ตอนนี้เป็นโหมดสาธิตครับ ลองถามผมเรื่อง "สรุปโปรเจกต์" "วิเคราะห์ยอดขาย" หรือ "แนะนำฟีเจอร์" ได้เลยครับ';
}

async function deepseekChat(messages) {
  if (!DEEPSEEK_API_KEY) return null;
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, max_tokens: 800, messages })
    });
    const j = await r.json();
    if (!r.ok) {
      const msg = (j.error && j.error.message) || '';
      // คีย์เสีย/ไม่มีเครดิต (401/402/Insufficient) → ข้ามไป provider ถัดไปทันที (ไม่เสียเวลา)
      if (r.status === 401 || r.status === 402 || /insufficient|invalid|authentication/i.test(msg)) return null;
      throw new Error('DeepSeek ' + r.status + ': ' + msg.slice(0, 100));
    }
    const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!reply) return null;
    return { provider: 'deepseek', model: DEEPSEEK_MODEL, reply };
  } catch (e) { return null; }
}

async function openrouterChat(messages) {
  if (!OPENROUTER_KEYS.length) return null;
  let lastErr = null;
  for (const key of OPENROUTER_KEYS) {
    for (const model of OPENROUTER_TEXT_MODELS) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://silelo.app', 'X-Title': 'Silelo' },
          body: JSON.stringify({ model, max_tokens: 800, messages })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(j.error && j.error.message || '').slice(0, 100)}`);
        const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!reply) throw new Error('OpenRouter คืนคำตอบว่าง');
        return { provider: 'openrouter', model, reply };
      } catch (e) { lastErr = e.message; }
    }
  }
  return null; // ให้ caller fallback ไป mock
}

/* ---- YandexGPT (Yandex Cloud Foundation Models) ---- */
const YANDEXGPT_API_KEY = process.env.YANDEXGPT_API_KEY || '';
const YANDEXGPT_FOLDER_ID = process.env.YANDEXGPT_FOLDER_ID || '';
const YANDEXGPT_MODEL = process.env.YANDEXGPT_MODEL || 'yandexgpt-lite/latest';

async function yandexChat(messages) {
  if (!YANDEXGPT_API_KEY || !YANDEXGPT_FOLDER_ID) return null;
  try {
    const r = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: { 'Authorization': 'Api-Key ' + YANDEXGPT_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelUri: 'gpt://' + YANDEXGPT_FOLDER_ID + '/' + YANDEXGPT_MODEL,
        messages: messages.map(m => ({ role: m.role, text: m.content })),
        completionOptions: { maxTokens: 800, temperature: 0.7 }
      })
    });
    const j = await r.json();
    if (!r.ok) {
      const msg = (j.error && j.error.message) || '';
      // key ผิด / ยังไม่ให้สิทธิ์ → ข้ามไป provider ถัดไปทันที (ไม่เสียเวลา)
      if (r.status === 401 || r.status === 403 || /permission|unauthorized|invalid|does not match/i.test(msg)) return null;
      throw new Error('YandexGPT ' + r.status + ': ' + msg.slice(0, 100));
    }
    const alts = j.result && j.result.alternatives;
    const reply = alts && alts[0] && alts[0].message && alts[0].message.text;
    if (!reply) return null;
    return { provider: 'yandexgpt', model: YANDEXGPT_MODEL, reply };
  } catch (e) { return null; }
}

/* ---- Gemini (Google AI Studio / Generative Language API) ---- */
// รองรับหลาย keys: GEMINI_API_KEYS="k1,k2,k3" หรือ GEMINI_API_KEY + GEMINI_API_KEY2 + GEMINI_API_KEY3
const GEMINI_API_KEYS = (process.env.GEMINI_API_KEYS || '')
  .split(',').map(k => k.trim()).filter(Boolean)
  .concat([process.env.GEMINI_API_KEY || '', process.env.GEMINI_API_KEY2 || '', process.env.GEMINI_API_KEY3 || ''])
  .filter(Boolean);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
let geminiKeyIdx = 0; // ตัวนับหมุนเวียน (round-robin) ให้ทุก key ได้ใช้

async function geminiChat(messages) {
  if (!GEMINI_API_KEYS.length) return null;
  const contents = [];
  let sys = '';
  for (const m of messages) {
    const text = String(m.content || '');
    if (m.role === 'system') { sys += (sys ? '\n' : '') + text; continue; }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: text.slice(0, 2000) }] });
  }
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: 'สวัสดี' }] });
  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
  };
  if (sys) body.systemInstruction = { parts: [{ text: sys.slice(0, 4000) }] };
  const n = GEMINI_API_KEYS.length;
  const start = geminiKeyIdx++ % n; // หมุนไปเรื่อย ๆ ทุกคำถาม
  for (let i = 0; i < n; i++) { // วนครบทุก key จนกว่าจะได้คำตอบ
    const key = GEMINI_API_KEYS[(start + i) % n];
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) {
        const msg = (j.error && j.error.message) || '';
        const bad = r.status === 401 || r.status === 403 || /quota|permission|invalid|api key|high demand|unavailable/i.test(msg);
        if (bad) { console.log('[gemini] key#' + ((start + i) % n + 1) + '/' + n + ' ข้าม: ' + r.status + ' ' + msg.slice(0, 60)); continue; }
        throw new Error('Gemini ' + r.status + ': ' + msg.slice(0, 100));
      }
      const reply = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
      if (!reply) continue;
      console.log('[gemini] ตอบด้วย key#' + ((start + i) % n + 1) + '/' + n);
      return { provider: 'gemini', model: GEMINI_MODEL, reply };
    } catch (e) { continue; }
  }
  return null;
}

async function askAI(user, question, history) {
  const msgs = [{ role: 'system', content: aiSystemPrompt(user) }];
  if (Array.isArray(history) && history.length) {
    for (const m of history.slice(-10)) {
      if (m && typeof m.content === 'string' && m.content.trim()) msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 1000) });
    }
  }
  // 💍 ความทรงจำถาวรของสลี่ — จำชื่อ/วันสำคัญ/สิ่งที่พี่นุชอบ-ไม่ชอบ
  try {
    const mems = (db.memories && db.memories[req_user_id(user)]) || [];
    if (mems.length) {
      const memText = '\n\n📌 ความทรงจำที่สลี่จำได้เกี่ยวกับพี่นุ (ใช้พูดคุยให้เป็นธรรมชาติ):\n' + mems.slice(-12).map(m => '• ' + m.fact).join('\n');
      msgs[0] = { ...msgs[0], content: msgs[0].content + memText };
    }
  } catch (e) {}

  msgs.push({ role: 'user', content: question.slice(0, 1000) });
  const ds = await deepseekChat(msgs); // 🥇 DeepSeek (คีย์พี่บอส) — เติมเงินแล้วใช้ได้ทันที
  if (ds) return ds;
  const gm = await geminiChat(msgs); // 🥈 Gemini (key พี่นุ)
  if (gm) return gm;
  const or = await openrouterChat(msgs); // 🥉 โมเดลฟรี
  if (or) return or;
  const ya = await yandexChat(msgs); // 🏅 YandexGPT (Yandex Cloud)
  if (ya) return ya;
  await new Promise(r => setTimeout(r, 400)); // จำลอง latency
  return { provider: 'mock', reply: aiMockReply(question) };
}

app.post('/api/ai', auth, async (req, res) => {
  const { question, messages } = req.body || {};
  const q = (question || '').trim();
  if (!q && !(Array.isArray(messages) && messages.length)) return res.status(400).json({ ok: false, error: 'กรุณาพิมพ์คำถาม' });
  try {
    const result = await askAI(req.user, q, messages || []);
    res.json({ ok: true, ...result, unlimited: !!(req.user.unlimited || req.user.role === 'owner' || req.user.plan === 'Unlimited') });
  } catch (e) {
    res.json({ ok: true, provider: 'mock', reply: aiMockReply(q), error: 'AI จริงไม่พร้อม ใช้โหมดสำเร็จรูป' });
  }
});

/* ================== 🔊 ระบบเสียงสลี่ (Thai-TTS-Silelo-v1 + Whisper) ================== */
const TTS_VOICE = process.env.TTS_VOICE || 'th-TH-PremwadeeNeural'; // เสียงผู้หญิงไทยอ่อนหวาน (ฟรี ไม่ต้องคีย์)
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''; // สำหรับ Whisper STT — สมัครฟรีที่ console.groq.com

// 🔊 ข้อความ → เสียงสลี่ (edge-tts ฟรี)
app.post('/api/tts', auth, async (req, res) => {
  const text = ((req.body || {}).text || '').toString().trim();
  if (!text) return res.status(400).json({ ok: false, error: 'ไม่มีข้อความ' });
  if (text.length > 2000) return res.status(400).json({ ok: false, error: 'ข้อความยาวเกินไป' });
  const voice = (req.body && req.body.voice) || (req.user && req.user.settings && req.user.settings.voice) || TTS_VOICE;
  const outFile = path.join(os.tmpdir(), 'sali_' + Date.now() + '_' + Math.floor(Math.random() * 9999) + '.mp3');
  execFile('python3', ['-m', 'edge_tts', '--voice', voice, '--text', text, '--write-media', outFile], { timeout: 45000 }, (err) => {
    if (err || !fs.existsSync(outFile)) {
      try { fs.unlinkSync(outFile); } catch (e) {}
      return res.status(500).json({ ok: false, error: 'TTS ล้มเหลว: ' + (err ? err.message : 'ไม่มีไฟล์') });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Sali-Voice', voice);
    fs.createReadStream(outFile).on('close', () => { try { fs.unlinkSync(outFile); } catch (e) {} }).pipe(res);
  });
});

// 🎤 เสียงพี่นุ → ข้อความ (Whisper Large v3 ผ่าน Groq — สมัครคีย์ฟรี)
app.post('/api/stt', auth, upload.single('audio'), async (req, res) => {
  if (!GROQ_API_KEY) return res.status(400).json({ ok: false, error: 'ยังไม่ได้ตั้งคีย์ Groq — สมัครฟรีที่ https://console.groq.com แล้วใส่ GROQ_API_KEY' });
  if (!req.file || !req.file.buffer || !req.file.buffer.length) return res.status(400).json({ ok: false, error: 'ไม่พบไฟล์เสียง' });
  try {
    const fd = new FormData();
    fd.append('model', 'whisper-large-v3');
    fd.append('language', 'th');
    fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), 'voice.webm');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY },
      body: fd
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Groq ' + r.status));
    const text = (j.text || '').trim();
    if (!text) return res.status(422).json({ ok: false, error: 'ไม่ได้ยินเสียง — ลองพูดอีกครั้ง' });
    res.json({ ok: true, text, model: 'Whisper Large v3' });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'STT ล้มเหลว: ' + e.message });
  }
});

// 💍 ความทรงจำถาวร — ดู/เพิ่ม
app.get('/api/memories', auth, (req, res) => {
  const uid = req_user_id(req.user);
  res.json({ ok: true, memories: (db.memories && db.memories[uid]) || [] });
});

// 🔊 รายการเสียงทั้งหมด
app.get('/api/voices', (req, res) => {
  res.json({ ok: true, voices: VOICES, current: (req.user && req.user.settings && req.user.settings.voice) || TTS_VOICE });
});

// 🎭 บุคลิกทั้งหมด
app.get('/api/personas', (req, res) => {
  res.json({ ok: true, personas: Object.keys(PERSONAS).map(k => ({ id: k, label: PERSONAS[k].label, desc: PERSONAS[k].desc })), current: (req.user && req.user.settings && req.user.settings.persona) || DEFAULT_PERSONA });
});

// ⚙️ บันทึกการตั้งค่า (เสียง / บุคลิก / ชื่อ)
app.post('/api/settings', auth, (req, res) => {
  const { voice, persona, name } = req.body || {};
  if (!req.user.settings) req.user.settings = {};
  if (voice) req.user.settings.voice = String(voice);
  if (persona && PERSONAS[persona]) req.user.settings.persona = String(persona);
  if (name && name.trim()) req.user.name = name.trim();
  saveDB(db);
  res.json({ ok: true, user: publicUser(req.user) });
});

// 💍 เพิ่มความทรงจำเอง
app.post('/api/memories', auth, (req, res) => {
  const fact = ((req.body || {}).fact || '').toString().trim();
  if (!fact) return res.status(400).json({ ok: false, error: 'กรอกสิ่งที่อยากให้สลี๋จำ' });
  const uid = req_user_id(req.user);
  if (!db.memories) db.memories = {};
  if (!db.memories[uid]) db.memories[uid] = [];
  db.memories[uid].push({ fact: fact.slice(0, 300), at: new Date().toISOString() });
  saveDB(db);
  res.json({ ok: true, memories: db.memories[uid] });
});

// 🗑️ ลบความทรงจำ
app.delete('/api/memories/:idx', auth, (req, res) => {
  const uid = req_user_id(req.user);
  const idx = parseInt(req.params.idx, 10);
  const mems = (db.memories && db.memories[uid]) || [];
  if (isNaN(idx) || idx < 0 || idx >= mems.length)
    return res.status(400).json({ ok: false, error: 'ไม่พบความทรงจำนี้' });
  mems.splice(idx, 1);
  saveDB(db);
  res.json({ ok: true, memories: mems });
});

// 🧹 ล้างความทรงจำทั้งหมด
app.delete('/api/memories', auth, (req, res) => {
  const uid = req_user_id(req.user);
  if (db.memories) db.memories[uid] = [];
  saveDB(db);
  res.json({ ok: true, memories: [] });
});

app.post('/api/memories', auth, (req, res) => {
  const fact = ((req.body || {}).fact || '').toString().trim();
  if (!fact || fact.length > 500) return res.status(400).json({ ok: false, error: 'ความทรงจำไม่ถูกต้อง' });
  const uid = req_user_id(req.user);
  if (!db.memories) db.memories = {};
  if (!db.memories[uid]) db.memories[uid] = [];
  db.memories[uid].push({ fact, at: new Date().toISOString() });
  if (db.memories[uid].length > 100) db.memories[uid] = db.memories[uid].slice(-100);
  saveDB(db);
  res.json({ ok: true, memories: db.memories[uid] });
});

/* ---- AI สร้างภาพ (Ideogram → OpenRouter → Pollinations auto-fallback) ---- */
const IDEOGRAM_API_KEY = process.env.IDEOGRAM_API_KEY || ''; // ใส่คีย์ Ideogram ได้ที่ .env / environment
const IDEOGRAM_MODEL = process.env.IDEOGRAM_MODEL || 'V_2_TURBO';
const OPENROUTER_KEYS = (process.env.OPENROUTER_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
const OPENROUTER_IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''; // คีย์ DeepSeek ของพี่บอส (เติมเงินแล้วใช้ได้ทันที)
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'; // 🔥 V4 Flash ใหม่ล่าสุด (ถูกกว่า V3 อีก) — ใช้ได้กับคีย์พี่บอส

const RATIO_MAP = { '1:1': 'ASPECT_1_1', '16:9': 'ASPECT_16_9', '9:16': 'ASPECT_10_16', '4:3': 'ASPECT_4_3', '3:4': 'ASPECT_3_4' };
const RATIO_PX = { '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280', '4:3': '1152x864', '3:4': '864x1152' };

async function ideogramImage(prompt, ratio) {
  const r = await fetch('https://api.ideogram.ai/generate', {
    method: 'POST',
    headers: { 'Api-Key': IDEOGRAM_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_request: {
        prompt: prompt.trim().slice(0, 900),
        model: IDEOGRAM_MODEL,
        aspect_ratio: RATIO_MAP[ratio] || 'ASPECT_1_1',
        magic_prompt_option: 'AUTO'
      }
    })
  });
  const j = await r.json();
  if (!r.ok) {
    const msg = r.status === 401 ? 'Ideogram API Key ไม่ถูกต้อง'
      : r.status === 402 ? 'Ideogram ยังไม่ได้ผูกบัตรชำระเงิน'
      : (j.message || '').includes('balance') ? 'Ideogram ยังไม่มีเครดิต'
      : `Ideogram error ${r.status}`;
    throw new Error(msg);
  }
  const url = j.data && j.data[0] && j.data[0].url;
  if (!url) throw new Error('Ideogram ไม่คืนรูปภาพ');
  const img = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return { buf: Buffer.from(await img.arrayBuffer()), mime: img.headers.get('content-type') || 'image/jpeg', tag: 'ideogram' };
}

async function openrouterImage(prompt, ratio) {
  if (!OPENROUTER_KEYS.length) throw new Error('ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY');
  let lastErr = null;
  for (const key of OPENROUTER_KEYS) {
    try {
      const body = {
        model: OPENROUTER_IMAGE_MODEL,
        modalities: ['image', 'text'],
        max_tokens: 1100,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Generate an image: ' + prompt.trim().slice(0, 900) }] }]
      };
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://silelo.app', 'X-Title': 'Silelo' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(j.error && j.error.message || '').slice(0, 120)}`);
      const imgs = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.images;
      const url = imgs && imgs[0] && imgs[0].image_url && imgs[0].image_url.url;
      if (!url) throw new Error('OpenRouter ไม่คืนรูปภาพ (ไม่มี message.images)');
      if (url.startsWith('data:')) {
        const m = url.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) throw new Error('OpenRouter data URL ผิดรูปแบบ');
        return { buf: Buffer.from(m[2], 'base64'), mime: m[1] || 'image/png', tag: 'openrouter' };
      }
      const img = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      return { buf: Buffer.from(await img.arrayBuffer()), mime: img.headers.get('content-type') || 'image/png', tag: 'openrouter' };
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr || 'OpenRouter error');
}

async function pollinationsImage(prompt, ratio) {
  const sz = RATIO_PX[ratio] || '1024x1024';
  const [w, h] = sz.split('x');
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.trim().slice(0, 400))}?width=${w}&height=${h}&nologo=true&seed=${Math.floor(Math.random() * 99999)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Pollinations error ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg', tag: 'pollinations' };
}

app.post('/api/ai/image', auth, async (req, res) => {
  const { prompt, aspect_ratio, provider } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ ok: false, error: 'กรุณาบรรยายภาพที่ต้องการ' });
  const want = (provider || 'auto').toLowerCase();
  let prevErr = null;
  try {
    // 1) Ideogram (ถ้ามีคีย์ และผู้ใช้เลือก auto / ideogram)
    if (IDEOGRAM_API_KEY && (want === 'auto' || want === 'ideogram')) {
      try {
        const img = await ideogramImage(prompt, aspect_ratio);
        return res.json({ ok: true, provider: 'Silelo-Image-v1 (Ideogram)', model: IDEOGRAM_MODEL, mime: img.mime, size: img.buf.length, dataUrl: `data:${img.mime};base64,${img.buf.toString('base64')}` });
      } catch (e) {
        prevErr = e.message;
        if (want === 'ideogram') return res.status(200).json({ ok: false, provider: 'Silelo-Image-v1 (Ideogram)', error: prevErr });
      }
    }
    // 2) OpenRouter — Gemini 2.5 Flash Image (ถ้ามีคีย์ และเลือก auto / openrouter)
    if (OPENROUTER_KEYS.length && (want === 'auto' || want === 'openrouter')) {
      try {
        const img = await openrouterImage(prompt, aspect_ratio);
        return res.json({ ok: true, provider: 'openrouter', model: OPENROUTER_IMAGE_MODEL, mime: img.mime, size: img.buf.length, dataUrl: `data:${img.mime};base64,${img.buf.toString('base64')}`, note: prevErr ? `Ideogram: ${prevErr} → ใช้ OpenRouter (Gemini AI) แทน` : undefined });
      } catch (e) {
        prevErr = e.message;
        if (want === 'openrouter') return res.status(200).json({ ok: false, provider: 'openrouter', error: prevErr });
      }
    }
    // 3) Pollinations — ฟรี ไม่ต้องคีย์ (ตัวสำรองสุดท้าย)
    const img = await pollinationsImage(prompt, aspect_ratio);
    res.json({ ok: true, provider: 'pollinations', model: 'flux (free)', mime: img.mime, size: img.buf.length, dataUrl: `data:${img.mime};base64,${img.buf.toString('base64')}`, note: prevErr ? `AI หลัก: ${prevErr} → ใช้บริการฟรีแทน` : undefined });
  } catch (e) {
    res.status(200).json({ ok: false, error: 'สร้างภาพไม่สำเร็จ: ' + (e.message || 'ลองใหม่อีกครั้ง') });
  }
});

/* ---- Dashboard / Analytics ---- */
app.get('/api/stats', auth, (req, res) => {
  const totalUsers = 24800 + db.users.length;
  const paid = db.package.milestones.filter(m => m.status === 'paid').reduce((s, m) => s + m.amount, 0);
  res.json({
    ok: true,
    stats: {
      monthlyUsers: totalUsers,
      userGrowth: 18.4,
      revenue: 42850,
      revenueGrowth: 24.5,
      orders: 1274,
      ordersGrowth: 12.1,
      retention: 45.2,
      paidSoFar: paid,
      packageTotal: db.package.price
    }
  });
});

app.get('/api/analytics', auth, (req, res) => {
  const labels = ['ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.'];
  const users = [8200, 10400, 12800, 15100, 18600, 21900, 24800];
  const revenue = [12400, 16800, 21500, 26200, 31900, 37100, 42850];
  const retention = [38, 41, 39, 43, 44, 42, 45];
  res.json({ ok: true, analytics: { labels, users, revenue, retention } });
});

/* ---- Transactions ---- */
app.get('/api/transactions', auth, (req, res) => {
  const tx = db.transactions.filter(t => t.userId === req.user.id).sort((a, b) => b.time - a.time);
  res.json({ ok: true, transactions: tx });
});

/* ---- Package & Payment ---- */
app.get('/api/package', auth, (req, res) => {
  res.json({ ok: true, package: db.package, paidMilestones: req.user.milestonesPaid || [] });
});

app.post('/api/pay', auth, (req, res) => {
  const { milestoneId, method, card } = req.body || {};
  const ms = db.package.milestones.find(m => m.id === Number(milestoneId));
  if (!ms) return res.status(404).json({ ok: false, error: 'ไม่พบงวดการชำระเงิน' });
  if ((req.user.milestonesPaid || []).includes(ms.id))
    return res.status(400).json({ ok: false, error: 'งวดนี้ชำระแล้ว' });
  const payMethod = method === 'card' ? `Visa •••• ${(card || '4242').slice(-4)}` : 'PromptPay';
  const tx = { id: crypto.randomUUID(), userId: req.user.id, milestoneId: ms.id, title: ms.title, amount: ms.amount, method: payMethod, status: 'completed', time: Date.now() };
  db.transactions.unshift(tx);
  ms.status = 'paid';
  req.user.milestonesPaid = [...(req.user.milestonesPaid || []), ms.id];
  saveDB(db);
  res.json({ ok: true, transaction: tx, package: db.package, paidMilestones: req.user.milestonesPaid });
});

/* ---- Messages (chat history) ---- */
app.get('/api/messages', auth, (req, res) => {
  res.json({ ok: true, messages: db.messages.slice(-80) });
});

app.post('/api/messages', auth, (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ ok: false, error: 'ข้อความว่างเปล่า' });
  const msg = { id: crypto.randomUUID(), user: req.user.name, userId: req.user.id, text: text.trim().slice(0, 500), time: Date.now() };
  db.messages.push(msg);
  saveDB(db);
  broadcast({ type: 'message', message: msg });
  maybeBotReply(req.user, msg.text);
  res.json({ ok: true, message: msg });
});

/* ---- Error handling ---- */
app.use((req, res) => res.status(404).json({ ok: false, error: 'ไม่พบเส้นทางที่ขอ' }));

/* ================== 🤖 สลี๋บอท ประจำแชททีมงาน ================== */
const BOT_ID = 'sali-bot';
const BOT_NAME = 'สลี๋บอท';
const botCooldown = new Map(); // userId -> last reply time

function shouldBotReply(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t.includes('@sali') || t.includes('@bot') || t.includes('@สลี๋')) return true;
  if (/[?？]$/.test(t)) return true;
  return /(ไหม|มั้ย|ยังไง|อย่างไร|เท่าไหร่|เท่าไร|กี่บาท|ไหน|ได้ไหม|ช่วย|ช่วยหน่อย|แนะนำ|อธิบาย|สรุป|แจ้ง)/.test(t);
}

function botCooldownOk(userId) {
  const last = botCooldown.get(userId) || 0;
  if (Date.now() - last < 20000) return false;
  botCooldown.set(userId, Date.now());
  return true;
}

async function saliBotReply(user, triggerText) {
  const history = db.messages.slice(-16).map(m => ({
    role: m.userId === BOT_ID ? 'assistant' : 'user',
    content: (m.userId === BOT_ID ? 'สลี๋บอท: ' : (m.user + ': ')) + m.text
  }));
  try {
    broadcast({ type: 'bot-typing' });
    const result = await askAI(user, triggerText, history);
    const reply = (result && result.reply) || aiMockReply(triggerText);
    const msg = { id: crypto.randomUUID(), user: BOT_NAME, userId: BOT_ID, text: String(reply).slice(0, 500), time: Date.now(), bot: true };
    db.messages.push(msg);
    saveDB(db);
    broadcast({ type: 'message', message: msg });
  } catch (e) {
    console.error('🤖 สลี๋บอท error:', e.message);
  } finally {
    broadcast({ type: 'bot-done' });
  }
}

function maybeBotReply(user, text) {
  if (!user || user.id === BOT_ID) return;
  if (!shouldBotReply(text)) return;
  if (!botCooldownOk(user.id)) return;
  saliBotReply(user, text);
}

/* ================== HTTP + WEBSOCKET SERVER ================== */
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(str); });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'welcome', message: 'เชื่อมต่อเรียลไทม์สำเร็จ ✅', online: wss.clients.size, bot: true }));
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (data.type === 'message' && data.token && data.text) {
        try {
          const payload = jwt.verify(data.token, JWT_SECRET);
          const user = db.users.find(u => u.id === payload.id);
          if (!user) return;
          const msg = { id: crypto.randomUUID(), user: user.name, userId: user.id, text: data.text.trim().slice(0, 500), time: Date.now() };
          db.messages.push(msg);
          saveDB(db);
          broadcast({ type: 'message', message: msg });
          maybeBotReply(user, msg.text);
        } catch (e) { /* invalid token */ }
      }
    } catch (e) { /* ignore */ }
  });
});

const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(interval));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Silelo💯✨️ backend กำลังทำงานที่ http://localhost:${PORT}`);
});
