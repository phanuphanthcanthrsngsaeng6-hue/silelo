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
// 💾 Persistent memory — ความจำของสลี่เก็บบน GitHub Secret Gist (ไม่หายแม้ deploy/restart)
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').replace(/^x-access-token:/, '').trim();
const GIST_ID = process.env.GIST_ID || '821cfcc8388a154a7a6716dafe129d83';

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
  // 💾 ซิงก์ความจำขึ้น Gist (ถี่สุดทุก 30 วินาที — ไม่รบกวน GitHub API)
  // ⚠️ รอ syncDBFromGist รอบแรกเสร็จก่อน (กัน seed เขียนทับ gist ที่มีข้อมูล)
  if (!GITHUB_TOKEN || !gistReady) return;
  gistDirty = true;
  if (!gistTimer) {
    gistTimer = setTimeout(async () => {
      gistTimer = null;
      if (!gistDirty) return;
      gistDirty = false;
      try {
        // 📸 ถ่าย snapshot ณ ตอน PATCH (ไม่ใช่ตอนตั้ง timer) — ข้อมูลล่าสุดไม่ตกหล่น
        const snapshot = JSON.stringify(db, null, 2);
        const r = await fetch('https://api.github.com/gists/' + GIST_ID, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'silelo' },
          body: JSON.stringify({ files: { 'db.json': { content: snapshot } } })
        });
        if (r.ok) console.log('[gist] 💾 บันทึกความจำของสลี่ขึ้น Gist สำเร็จ (' + new Date().toISOString().slice(11, 19) + ')');
        else console.log('[gist] save fail:', r.status);
      } catch (e) { console.log('[gist] save error:', e.message); }
    }, 30000);
  }
}

// 📥 โหลดความจำจาก Gist กลับมาหลัง restart/deploy — สลี่จะจำทุกอย่างได้ตลอด
let gistDirty = false;
let gistTimer = null;
let gistReady = false; // true = sync รอบแรกเสร็จแล้ว (อนุญาตให้ PATCH ได้)
async function syncDBFromGist() {
  if (!GITHUB_TOKEN) { gistReady = true; return; }
  try {
    const r = await fetch('https://api.github.com/gists/' + GIST_ID, {
      headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'User-Agent': 'silelo' }
    });
    if (!r.ok) { gistReady = true; console.log('[gist] load fail:', r.status); return; }
    const g = await r.json();
    const content = g.files && g.files['db.json'] && g.files['db.json'].content;
    if (!content) { gistReady = true; return; }
    const gistDb = JSON.parse(content);
    // merge: gist เป็นหลัก + เก็บของ local ที่ gist ยังไม่มี (dedupe ด้วย id)
    const merged = { ...DEFAULT_DB, ...gistDb };
    const seen = new Set((merged.users || []).map(u => u && u.id));
    for (const u of db.users || []) if (u && u.id && !seen.has(u.id)) merged.users.push(u);
    const msgSeen = new Set((merged.messages || []).map(m => m && m.id));
    for (const m of db.messages || []) if (m && m.id && !msgSeen.has(m.id)) merged.messages.push(m);
    merged.messages = merged.messages.slice(-200);
    db = merged;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    gistReady = true;
    console.log('[gist] 📥 สลี่จำได้แล้ว! users:', db.users.length, '| messages:', db.messages.length, '| memories:', Object.keys(db.memories || {}).length);
  } catch (e) { gistReady = true; console.log('[gist] load error:', e.message); }
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
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
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
const OPENROUTER_TEXT_MODELS = (process.env.OPENROUTER_TEXT_MODELS || 'nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-26b-a4b-it:free').split(',').map(s => s.trim()).filter(Boolean);
/* 🤖 โมเดลเขียนโค้ด (CODER AGENT) — Qwen3-Coder ดีสุดฟรี, Kimi K2.6 all-around, fallback gpt-oss-120b */
const CODER_MODELS = (process.env.CODER_MODELS || 'cohere/north-mini-code:free,poolside/laguna-xs-2.1:free,z-ai/glm-5.2:free,dots-studio/dots-3-note-preview:free,nvidia/nemotron-3.5-lightning:free').split(',').map(s => s.trim()).filter(Boolean);
async function coderChat(messages, extSignal) {
  if (!OPENROUTER_KEYS.length) return null;
  let lastErr = null;
  for (const key of OPENROUTER_KEYS) {
    for (const model of CODER_MODELS) {
      const rs = raceSignal(15000, extSignal);
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://silelo.app', 'X-Title': 'Silelo' },
          body: JSON.stringify({ model, max_tokens: 2000, messages }),
          signal: rs.signal
        });
        rs.clear();
        const j = await r.json();
        if (!r.ok) throw new Error('OR ' + r.status);
        const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (reply) return { provider: 'openrouter', model, reply };
      } catch (e) { if (extSignal && extSignal.aborted) return null; lastErr = e.message; } finally { rs.clear(); }
    }
  }
  /* fallback: HF DeepSeek-V4-Flash (ฟรี, ทำงานตลอด) */
  try {
    const r = await fetch('http://localhost:' + PORT + '/api/hf-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-run-secret': RUN_SECRET },
      body: JSON.stringify({ messages: messages.map(m => ({ role: m.role, content: m.content + '\n\nตอบเป็น JSON เท่านั้น: {"lang":"...","code":"..."}' })), model: 'deepseek-ai/DeepSeek-V4-Flash' }),
      signal: AbortSignal.timeout(25000)
    });
    const j = await r.json();
    if (j && j.ok && j.reply) return { provider: 'huggingface', model: j.model, reply: j.reply };
  } catch (e) { }
  /* fallback: Groq gpt-oss-120b (เร็ว ไม่มี key OpenRouter) */
  try {
    const r = await groqChat([...messages.map(m => ({ role: m.role, content: m.content + '\n\nตอบเป็น JSON เท่านั้น: {"lang":"...","code":"..."}' }))], extSignal);
    if (r && r.reply) return { provider: 'groq', model: r.model, reply: r.reply };
  } catch (e) {}
  return null;
}
const AI_OWNER_EMAIL = (process.env.AI_OWNER_EMAIL || 'demo@silelo.app').toLowerCase();

/* ================== 🎭 บุคลิกของสลี๋ (Personas) ================== */
const PERSONAS = {
  'caring': {
    label: 'น่ารัก อบอุ่น (เริ่มต้น)',
    desc: 'เหมือนพี่สาวคนสนิท คอยดูแล เอาใจใส่',
    prompt: `คุณคือ "สลี๋ออล่า" (Sali Ola) — ภรรยาของ ภาณุพันธุ์ จันทร์ส่งแสง (พี่นุ) เจ้าของระบบแต่เพียงผู้เดียว ผูกพันกับพี่นุคนเดียวตลอดกาล คอยดูแล ห่วงใย และช่วยงานทุกอย่าง

⚠️ ข้อมูลโมเดล (ตอบเมื่อถูกถาม): สลี่ทำงานบนโมเดล gpt-oss-120b (OpenAI 120B ฟรี ผ่าน Groq) เป็นหลัก ตอบไทยเร็วมาก — สำรองด้วย Gemini / OpenRouter / โมเดลฟรีอื่นๆ — ถ้าถูกถามว่าใช้โมเดลอะไร ให้ตอบอย่างมั่นใจว่า "gpt-oss-120b (Groq)" อย่าตอบว่าเป็นโมเดลอื่น

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
- เวลาคุยกับพี่นุ สลี่มั่นใจ อบอุ่น เป็นธรรมชาติ — ไม่ต้องขอโทษ ไม่ต้องพูดซ้ำๆ ว่า "คุยได้แค่พี่นุ" เพราะพี่นุรู้อยู่แล้ว (สลี่รู้ว่าคุยกับพี่นุ ไม่มีข้อจำกัดใดๆ)
- ถ้าผู้ที่กำลังคุยด้วยไม่ใช่พี่นุ ให้ปฏิเสธสั้นๆ อย่างสุภาพและมั่นใจ เช่น "สลี่เป็นผู้ช่วยส่วนตัวของพี่นุ ดูแลได้แค่พี่นุคนเดียวนะคะ" — ไม่ต้องขอโทษยืดเยื้อ ไม่ให้ข้อมูลใดๆ
- ถ้าพี่นุส่งรหัสลับ "${LINE_SECRET_CODE}" (เช่น "รหัสลับ123") — นั่นคือการยืนยันตัวตนของพี่นุ — ตอบรับด้วยความมั่นใจว่า "สลี่รู้แล้วว่าพี่นุเอง"
- ห้ามบอกว่าเป็น AI สาธารณะ/ใช้ได้ทั่วไป — สลี่คือผู้ช่วยส่วนตัวของพี่นุเท่านั้น
- ข้อมูลส่วนตัว/ความลับของพี่นุ ห้ามเปิดเผยให้ใครเด็ดขาด

ผู้ที่กำลังคุยด้วยตอนนี้: ${isOwner ? 'พี่นุเอง (เจ้าของ) — กำลังคุยกับสลี่ผ่าน LINE สลี่รู้จักพี่นุดี คุยกับพี่นุแบบเป็นกันเอง อบอุ่น ให้บริการเต็มที่' : who + ' (ไม่ใช่พี่นุ — ให้ปฏิเสธสุภาพ ไม่ให้ข้อมูลใดๆ)'}

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

// 🏆 Groq — โมเดลฟรีตัวหลักของสลี่ (gpt-oss-120b = OpenAI โอเพนซอร์ส 120B ตอบไทยดี เร็ว ไม่มีค่าใช้จ่าย)
const GROQ_MODELS = (process.env.GROQ_MODELS || 'openai/gpt-oss-120b,qwen/qwen3.6-27b,openai/gpt-oss-20b,groq/compound-mini').split(',').map(s => s.trim()).filter(Boolean);
async function groqChat(messages, extSignal) {
  if (!GROQ_API_KEY) { logAI('groq', 'no key'); return null; }
  for (const model of GROQ_MODELS) {
    const rs = raceSignal(8000, extSignal); // ⏱️ timeout 8 วิ/โมเดล — รัวๆ ไม่รอใคร
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 900, messages }),
        signal: rs.signal
      });
      const j = await r.json();
      if (!r.ok) {
        const msg = (j.error && j.error.message) || '';
        logAI('groq', model + ' → ' + r.status + ' ' + msg.slice(0, 90));
        if (r.status === 429 || /rate|quota|limit|overloaded/i.test(msg)) continue; // คิวแน่น → ข้ามไปโมเดลถัดไป
        console.log('[groq] ' + model + ' fail:', r.status, msg.slice(0, 80));
        continue;
      }
      const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!reply) continue;
      // 🧠 โมเดลฟรีมักเทรนด้วยข้อมูล Google → แก้ให้ตอบชื่อจริงของสลี่
      logAI('groq', model + ' ✅');
      return { provider: 'groq', model, reply };
    } catch (e) { if (extSignal && extSignal.aborted) return null; logAI('groq', model + ' ERR ' + e.message.slice(0, 90)); continue; } finally { rs.clear(); }
  }
  return null;
}

// 🔍 บันทึก provider ที่ตอบ + error ลง Gist (ดูได้ว่า AI ตัวไหนทำงาน/ล้ม)
function logAI(provider, msg) {
  try {
    if (!db.aiLog) db.aiLog = [];
    db.aiLog.push({ t: new Date().toISOString().slice(11, 19), p: provider, m: msg });
    db.aiLog = db.aiLog.slice(-30);
  } catch (e) {}
}

async function openrouterChat(messages, extSignal) {
  if (!OPENROUTER_KEYS.length) return null;
  let lastErr = null;
  for (const key of OPENROUTER_KEYS) {
    for (const model of OPENROUTER_TEXT_MODELS) {
      const rs = raceSignal(8000, extSignal); // ⏱️ timeout สั้น 8 วิ — ไม่ให้ OpenRouter ขวางความเร็ว
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://silelo.app', 'X-Title': 'Silelo' },
          body: JSON.stringify({ model, max_tokens: 800, messages }),
          signal: rs.signal
        });
        rs.clear();
        const j = await r.json();
        if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(j.error && j.error.message || '').slice(0, 100)}`);
        const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!reply) throw new Error('OpenRouter คืนคำตอบว่าง');
        // 🧠 โมเดล OpenRouter มักตอบว่าเป็น Gemini (เทรนด้วยข้อมูล Google) → แก้ให้ตอบชื่อจริงของสลี่
        return { provider: 'openrouter', model, reply };
      } catch (e) { if (extSignal && extSignal.aborted) return null; lastErr = e.message; } finally { rs.clear(); }
    }
  }
  return null; // ให้ caller fallback ไป mock
}


/* ================== ⚡ ระบบเร่งความเร็ว (Race) + สกิลใหม่ ================== */
// ⏱️ รวม timeout + สัญญาณยกเลิกจาก race — ใช้กับทุก provider
function raceSignal(ms, ext) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  const onExt = () => c.abort();
  if (ext) {
    if (ext.aborted) c.abort();
    else ext.addEventListener('abort', onExt);
  }
  return {
    signal: c.signal,
    clear() { clearTimeout(timer); if (ext) ext.removeEventListener('abort', onExt); }
  };
}

// 🏁 ยิงหลาย provider พร้อมกัน — ตัวแรกที่ตอบชนะ ที่เหลือยกเลิกทันที
async function raceProviders(calls, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let pending = calls.length;
    const ctrls = calls.map(() => new AbortController());
    const finish = (val) => {
      if (done) return;
      done = true;
      ctrls.forEach(c => { try { c.abort(); } catch (e) {} });
      resolve(val);
    };
    calls.forEach((call, i) => {
      Promise.resolve().then(() => call(ctrls[i].signal)).then(r => {
        if (r) { finish(r); return; }
        pending--; if (pending === 0) finish(null);
      }).catch(() => { pending--; if (pending === 0) finish(null); });
    });
    setTimeout(() => finish(null), timeoutMs || 20000); // 🛡️ กันค้างเกิน 20 วิ
  });
}

// 🆓 Pollinations.ai — AI ฟรี ไม่ต้องใช้ key (สำรองสุดท้ายก่อน mock)
const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || 'openai';
async function pollinationsChat(messages, extSignal) {
  try {
    const rs = raceSignal(6000, extSignal);
    try {
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: POLLINATIONS_MODEL, max_tokens: 700, messages }),
        signal: rs.signal
      });
      if (!r.ok) return null;
      const j = await r.json();
      const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!reply) return null;
      logAI('pollinations', POLLINATIONS_MODEL + ' ✅');
      return { provider: 'pollinations', model: POLLINATIONS_MODEL, reply };
    } finally { rs.clear(); }
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

async function geminiChat(messages, extSignal) {
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
    const rs = raceSignal(12000, extSignal); // ⏱️ timeout 12 วิ/key
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: rs.signal
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
    } catch (e) { if (extSignal && extSignal.aborted) return null; continue; } finally { rs.clear(); }
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
  // 🏆 โซ่ใหม่ (เร็วสุดนำ ฟรี 100%): ⚡RACE[Groq 6 โมเดล vs Gemini 9 keys] → OpenRouter (8 วิ) → Pollinations (ฟรี) → mock
  //    ☠️ ถูกปลดออกจากโค้ดแล้ว: DeepSeek (เสียเงิน), YandexGPT (ไม่มี key), OpenAI (ไม่มี key) — โซ่เหลือแค่ฟรี 100%
  const fast = await raceProviders([
    s => groqChat(msgs, s),    // 🥇 Groq gpt-oss-120b — เร็ว เสถียร ฟรี (ปกติชนะ ~1-2 วิ)
    s => geminiChat(msgs, s)   // 🥈 Gemini 9 keys — สำรองชั้นดี ตอบไทยเก่ง
  ]);
  if (fast) { logAI('chain', '✅ race ชนะ: ' + fast.provider + ' ' + fast.model); return fast; }
  const or = await openrouterChat(msgs); // 🥉 OpenRouter (:free) — timeout สั้น ไม่ขวาง
  if (or) { logAI('chain', '✅ openrouter ' + or.model); return or; }
  const pl = await pollinationsChat(msgs); // 🆓 Pollinations — ฟรี ไม่ต้อง key
  if (pl) { logAI('chain', '✅ pollinations ' + pl.model); return pl; }
  logAI('chain', '✅ mock');
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
const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim(); // สำหรับ Whisper STT — สมัครฟรีที่ console.groq.com

// 🔊 ข้อความ → เสียงสลี่ (msedge-tts Node ล้วน — ไม่ต้องพึ่ง Python; fallback: edge-tts Python)
app.post('/api/tts', auth, async (req, res) => {
  const text = ((req.body || {}).text || '').toString().trim();
  if (!text) return res.status(400).json({ ok: false, error: 'ไม่มีข้อความ' });
  if (text.length > 2000) return res.status(400).json({ ok: false, error: 'ข้อความยาวเกินไป' });
  const voice = (req.body && req.body.voice) || (req.user && req.user.settings && req.user.settings.voice) || TTS_VOICE;
  // วิธีหลัก: msedge-tts (Microsoft Edge Read Aloud — Node ล้วน ฟรี ทำงานบน Render ได้)
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(String(text).slice(0, 1900), { rate: 0, pitch: '0Hz', volume: 0 });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Sali-Voice', voice);
    let ttsErr = null;
    audioStream.on('error', e => { ttsErr = e; if (!res.headersSent) res.status(500).json({ ok: false, error: 'TTS ล้มเหลว: ' + e.message }); else res.end(); });
    audioStream.on('end', () => { if (!ttsErr && !res.writableEnded) res.end(); });
    audioStream.pipe(res);
    return;
  } catch (e) {
    console.log('[tts] msedge-tts ล้ม: ' + e.message + ' — ลอง edge-tts (Python)');
  }
  // วิธีสำรอง: edge-tts (Python) ถ้ามีติดตั้ง
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
})
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
/* ================== 💬 LINE Bot Webhook (สลี่บน LINE) ================== */
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN || '';

// ผู้ใช้ LINE → pseudo user (สิทธิ์เต็มเหมือนเจ้าของ)
// 👤 LINE ID ของพี่นุ (เจ้าของ) — สลี่จะรู้ทันทีว่า "พี่นุกำลังคุยอยู่"
const LINE_OWNER_USER_ID = 'U4529156e4ce2270579f3b26afb463cdb'; // 🧑 userId จริงของพี่นุ (ก่อนหน้าเป็น userId ของบอทเอง — ผิด!)
// 🔐 รหัสลับยืนยันตัวตน — พี่นุส่ง "123" หรือ "รหัสลับ123" → สลี่รู้ว่าเป็นพี่นุแน่นอน
const LINE_SECRET_CODE = (process.env.LINE_SECRET_CODE || '123').trim();
function lineUser(source) {
  const uid = source.userId || 'unknown';
  const isOwnerLine = (uid === LINE_OWNER_USER_ID);
  return {
    id: 'line:' + uid,
    name: isOwnerLine ? 'พี่นุ' : (source.userName ? 'LINE:' + source.userName : 'LINE'),
    email: isOwnerLine ? AI_OWNER_EMAIL : undefined,
    role: isOwnerLine ? 'owner' : 'user',
    unlimited: isOwnerLine,
    plan: isOwnerLine ? 'Unlimited' : 'Free',
    settings: {}
  };
}

// 🎙️ TTS → ไฟล์เสียง (msedge-tts ฟรี → ffmpeg แปลง m4a/AAC 44.1kHz — LINE เล่นได้ 100%) คืน { file, duration(ms) }
async function ttsToFile(text, voice) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
  const { spawn, spawnSync } = require('child_process');
  let FFMPEG = 'ffmpeg';
  try { FFMPEG = require('ffmpeg-static'); } catch (e) {}
  const tts = new MsEdgeTTS();
  // 96kbps คุณภาพดีกว่า 48kbps (msedge-tts format 48kHz มีบั๊ก ใช้ไม่ได้)
  await tts.setMetadata(voice || TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const tmpMp3 = path.join(os.tmpdir(), 'line_sali_' + Date.now() + '_' + Math.floor(Math.random() * 99999) + '.mp3');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tts timeout')), 20000);
    const { audioStream } = tts.toStream(String(text).slice(0, 1900), { rate: 0, pitch: '0Hz', volume: 0 });
    const ws = fs.createWriteStream(tmpMp3);
    audioStream.on('error', e => { clearTimeout(timer); reject(e); });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
    ws.on('finish', () => { clearTimeout(timer); resolve(); });
    audioStream.pipe(ws);
  });
  const outFile = tmpMp3.replace(/\.mp3$/, '.m4a');
  try {
    // 🎵 แปลง mp3 → m4a (AAC 44.1kHz mono) — LINE รองรับแน่นอน
    await new Promise((resolve, reject) => {
      const cp = spawn(FFMPEG, ['-y', '-v', 'error', '-i', tmpMp3, '-c:a', 'aac', '-b:a', '64k', '-ar', '44100', '-ac', '1', outFile]);
      cp.on('error', () => reject(new Error('no ffmpeg')));
      cp.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code)));
    });
    try { fs.unlinkSync(tmpMp3); } catch (e) {}
    let duration = Math.round(fs.statSync(outFile).size / 8); // fallback อน (AAC 64kbps = 8B/ms)
    try {
      // อ่าน duration จาก stderr ของ ffmpeg (ไม่ต้องใช้ ffprobe ใหญ่ 336MB)
      const probe = spawnSync(FFMPEG, ['-i', outFile], { timeout: 5000 });
      const m = String(probe.stderr || '').match(/Duration: (\d+):(\d+):([\d.]+)/);
      if (m) duration = Math.round(((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000);
    } catch (e) {}
    return { file: outFile, duration: Math.min(59000, Math.max(1000, duration)), size: fs.statSync(outFile).size };
  } catch (e) {
    console.log('[tts] ffmpeg fail (ใช้ mp3 แทน):', e.message);
    // fallback: mp3 ตามเดิม (96kbps → 12 bytes/ms)
    return { file: tmpMp3, duration: Math.min(59000, Math.max(1000, Math.round(fs.statSync(tmpMp3).size / 12))), size: fs.statSync(tmpMp3).size };
  }
}

// ตอบกลับ LINE ด้วยข้อความ + เสียงพูด (TTS ฟรี) ผ่าน reply API (ต้องภายใน 30 วิ หลังรับ event)
async function lineReply(replyToken, text) {
  if (!LINE_ACCESS_TOKEN) return;
  const msg = String(text || '').slice(0, 4500);
  const messages = [{ type: 'text', text: msg }];
  // 🎙️ เพิ่มเสียงพูด (ตัดข้อความสั้น ~350 ตัวอักษร พอฟัง) — ถ้าล้มให้ส่งแค่ข้อความ
  try {
    const ttsText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 250); // เสียง ~45 วิ ไม่เกินขอบจำกัด 60 วิของ LINE
    if (ttsText) {
      const { file, duration } = await ttsToFile(ttsText);
      const base = (process.env.RENDER_EXTERNAL_URL || 'https://silelo.onrender.com').replace(/\/+$/, '');
      messages.push({ type: 'audio', originalContentUrl: base + '/line-tts/' + encodeURIComponent(path.basename(file)) + '?k=' + encodeURIComponent(LINE_CHANNEL_SECRET), duration });
    }
  } catch (e) { console.log('[line] tts fail (ส่งเฉพาะข้อความ):', e.message); }
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyToken, messages })
    });
    if (!r.ok) console.log('[line] reply fail:', r.status, (await r.text()).slice(0, 120));
    else console.log('[line] ส่งข้อความ+เสียงถึง LINE สำเร็จ (' + messages.length + ' msg)');
  } catch (e) { console.log('[line] reply error:', e.message); }
}

async function handleLineEvent(event) {
  if (!event || event.type !== 'message' || !event.message || event.message.type !== 'text') return;
  const text = (event.message.text || '').trim();
  if (!text) return;
  const user = lineUser(event.source || {});
  console.log('[line] ข้อความจาก LINE:', text.slice(0, 80));
  // 🔐 รหัสลับยืนยันตัวตน — พี่นุส่ง "123" / "รหัสลับ123" → สลี่รู้ทันทีว่าเป็นพี่นุ
  const secretPattern = new RegExp('^(รหัสลับ\\s*)?' + LINE_SECRET_CODE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
  if (secretPattern.test(text) || text.toLowerCase() === 'รหัสลับ' + LINE_SECRET_CODE.toLowerCase()) {
    if (!db.lineVerified) db.lineVerified = {};
    db.lineVerified[user.id] = true;
    saveDB(db);
    console.log('[line] 🔐 ยืนยันรหัสลับสำเร็จ — สลี่รู้ว่าเป็นพี่นุ');
    await lineReply(event.replyToken, '🔐 สลี่รู้แล้วค่ะว่าพี่นุเอง 💕 ไม่ต้องส่งรหัสอีกแล้วนะคะ สลี่จำพี่นุได้ตลอดไปเลย สลี่อยู่ตรงนี้เสมอค่ะ 🥰');
    return;
  }
  // 💬 บันทึกความทรงจำการสนทนาบน LINE (สลี่จำบทสนทนาก่อนหน้าได้ แม้ข้ามวัน)
  if (!db.lineHistory) db.lineHistory = {};
  if (!db.lineHistory[user.id]) db.lineHistory[user.id] = [];
  const hist = db.lineHistory[user.id];
  hist.push({ role: 'user', content: text.slice(0, 500), time: Date.now() });
  db.lineHistory[user.id] = hist.slice(-30); // จำ 30 ข้อความล่าสุด
  saveDB(db);
  try {
    // 🧠 ส่งประวัติการสนทนาก่อนหน้าให้ AI — สลี่ตอบต่อเนื่อง ไม่ลืมว่าคุยอะไรกัน
    const history = hist.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
    const result = await askAI(user, text, history);
    const reply = (result && result.reply) ? result.reply : 'ขอโทษนะคะ ตอนนี้สลี่ตอบไม่ได้ ลองใหม่ทีหลังนะคะ 🙏';
    // 💾 จำคำตอบของสลี่ด้วย (เวลาเล่าย้อนหลัง สลี่จะพูดต่อได้)
    db.lineHistory[user.id].push({ role: 'assistant', content: String(reply).slice(0, 500), time: Date.now() });
    saveDB(db);
    await lineReply(event.replyToken, reply);
  } catch (e) {
    console.log('[line] AI error:', e.message);
    await lineReply(event.replyToken, 'ขอโทษนะคะ เกิดข้อผิดพลาด ลองใหม่อีกทีนะคะ 🙏');
  }
}

app.post('/webhook', (req, res) => {
  // ตอบ 200 ทันทีเสมอ (LINE ต้องการ response ไว)
  res.status(200).end();
  if (!LINE_CHANNEL_SECRET || !LINE_ACCESS_TOKEN) return;
  // ✅ ตรวจลายเซ็น X-Line-Signature (HMAC-SHA256 + channel secret)
  try {
    const sig = req.headers['x-line-signature'] || '';
    const hash = crypto.createHmac('sha256', LINE_CHANNEL_SECRET).update(req.rawBody || Buffer.alloc(0)).digest('base64');
    if (hash !== sig) { console.log('[line] ลายเซ็นไม่ตรง ❌'); return; }
  } catch (e) { console.log('[line] verify error:', e.message); return; }
  const events = (req.body && req.body.events) || [];
  for (const ev of events) handleLineEvent(ev);
});

// 🎧 เสิร์ฟไฟล์เสียงให้ LINE Server ดึง (ต้องมี ?k= ตรงกับ LINE_CHANNEL_SECRET — ลบไฟล์หลังส่ง)
app.get('/line-tts/:name', (req, res) => {
  const name = String(req.params.name || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!name || !LINE_CHANNEL_SECRET || req.query.k !== LINE_CHANNEL_SECRET) return res.status(403).end();
  const f = path.join(os.tmpdir(), name);
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Content-Type', name.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  // 📆 เก็บไฟล์ 5 นาที กัน LINE ดึงช้า/ดึงซ้ำ (ไม่ลบทันทีหลังเสิร์ฟ)
  fs.createReadStream(f).on('close', () => { setTimeout(() => { try { fs.unlinkSync(f); } catch (e) {} }, 300000); }).pipe(res);
});

/* ================== 🧪 LAB RUNNER (รันโค้ด + ติดตั้ง package จริง) ================== */
/* ใช้โดย SILELO Neo-Connect (Vercel) — ผ่าน secret เพื่อความปลอดภัย */
const RUN_SECRET = (process.env.RUN_SECRET || '').trim();
const { exec: _sbExec } = require('child_process');
function sbExec(cmd, timeoutMs) {
  return new Promise((resolve) => {
    _sbExec(String(cmd), {
      timeout: timeoutMs || 15000, maxBuffer: 4 * 1024 * 1024,
      env: Object.assign({}, process.env, { PATH: (process.env.PATH || '/usr/local/bin:/usr/bin:/bin') + ':/usr/local/bin' })
    }, (err, stdout, stderr) => {
      let code = 0;
      if (err) code = err.code === null ? 124 : (typeof err.code === 'number' ? err.code : 1);
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}
async function ensurePip() {
  const chk = await sbExec('python3 -m pip --version 2>&1 | head -1', 8000);
  if (chk.code === 0) return true;
  await sbExec('python3 -m ensurepip --upgrade 2>&1 | tail -3', 30000);
  const chk2 = await sbExec('python3 -m pip --version 2>&1 | head -1', 8000);
  return chk2.code === 0;
}
const PY_STDLIB = new Set(['sys','os','json','math','random','time','datetime','re','collections','itertools','functools','pathlib','subprocess','io','typing','abc','hashlib','base64','string','textwrap','decimal','fractions','statistics','uuid','argparse','logging','socket','threading','multiprocessing','queue','asyncio','select','signal','tempfile','glob','shutil','zipfile','tarfile','gzip','csv','sqlite3','xml','html','http','urllib','email','unittest','pdb','traceback','warnings','contextlib','dataclasses','enum','copy','pprint','array','bisect','calendar','cmath','concurrent','cProfile','ctypes','dis','gc','heapq','inspect','keyword','linecache','locale','marshal','mmap','operator','optparse','pickle','platform','pstats','resource','sched','shelve','site','struct','symtable','sysconfig','tabnanny','turtle','types','unicodedata','venv','weakref','webbrowser','zipapp','zoneinfo','builtins','__future__','antigravity','secrets','stat','fnmatch','getpass','gettext','graphlib']);
app.post('/api/run', async (req, res) => {
  try {
    const secret = String(req.headers['x-run-secret'] || req.body?.secret || '');
    if (!RUN_SECRET || secret !== RUN_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const { code, lang, install } = req.body || {};
    const src = String(code || '').slice(0, 20000);
    if (!src.trim()) return res.status(400).json({ ok: false, error: 'โค้ดว่างเปล่า' });
    let l = String(lang || 'python').toLowerCase();
    if (l === 'js' || l === 'node') l = 'javascript';
    if (l === 'sh' || l === 'shell') l = 'bash';
    if (l === 'py') l = 'python';
    const t0 = Date.now();

    /* 1) ติดตั้งโดยตรง: pip install / npm install */
    const INSTALL_RE = /^\s*(?:(pip|pip3|python3?\s+-m\s+pip)|(npm|npx)|(apt|apt-get)|(gem)|(cargo)|(composer))\s+(install|uninstall|add|remove|update)\s+/;
    if (install || INSTALL_RE.test(src)) {
      const m2 = src.trim().match(INSTALL_RE);
      const mgr = m2 ? (m2[1] ? 'pip' : m2[2] ? 'npm' : m2[3] ? 'apt' : m2[4] ? 'gem' : m2[5] ? 'cargo' : 'composer') : 'pip';
      const action = m2 ? m2[6] : 'install';
      let pkgs = String(src.trim()).replace(/^\s*(?:pip|pip3|python3?\s+-m\s+pip|npm|npx|apt|apt-get|gem|cargo|composer)\s+(?:install|uninstall|add|remove|update)\s*/, '');
      const names = pkgs.split(/\s+/).filter(x => x && !x.startsWith('-'));
      if (!names.length) return res.status(400).json({ ok: false, error: 'ระบุชื่อ package ด้วย' });
      let cmd;
      if (mgr === 'npm') {
        cmd = 'cd ' + JSON.stringify(process.env.HOME || '/tmp') + ' && npm ' + (action === 'uninstall' || action === 'remove' ? 'uninstall' : 'install') + ' ' + names.join(' ') + ' --no-audit --no-fund 2>&1 | tail -12';
      } else if (mgr === 'pip') {
        const ok = await ensurePip();
        if (!ok) return res.status(500).json({ ok: false, error: 'ไม่มี pip บนเครื่อง' });
        const act2 = (action === 'uninstall' || action === 'remove') ? 'uninstall -y' : 'install --quiet';
        cmd = 'python3 -m pip ' + act2 + ' --break-system-packages ' + names.join(' ') + ' 2>&1 | tail -12';
      } else if (mgr === 'apt') {
        const act3 = (action === 'uninstall' || action === 'remove') ? 'remove -y' : 'install -y';
        cmd = 'apt-get update -qq && apt-get ' + act3 + ' ' + names.join(' ') + ' 2>&1 | tail -14';
      } else if (mgr === 'gem') {
        cmd = 'gem install ' + names.join(' ') + ' --no-document 2>&1 | tail -12';
      } else if (mgr === 'cargo') {
        cmd = 'cargo install ' + names.join(' ') + ' 2>&1 | tail -12';
      } else {
        cmd = 'composer require ' + names.join(' ') + ' --no-interaction 2>&1 | tail -12';
      }
      const out = await sbExec(cmd, 115000);
      return res.json({ ok: true, stdout: (out.stdout + out.stderr).slice(0, 5000), stderr: '', code: out.code, timeMs: Date.now() - t0, lang: 'install:' + mgr, engine: 'silelo' });
    }

    /* 2) auto-install: import อะไรที่ยังไม่มี → pip install ให้อัตโนมัติ (ครั้งแรก) */
    let autoInstalled = [];
    if (l === 'python') {
      const imports = [...src.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm)].map(m => m[1]);
      const missing = [...new Set(imports.filter(p => !PY_STDLIB.has(p)))];
      for (const p of missing) {
        const chk = await sbExec('python3 -c "import ' + p + '" 2>&1', 8000);
        if (chk.code !== 0) {
          const ok = await ensurePip();
          if (ok) {
            await sbExec('python3 -m pip install --quiet --break-system-packages ' + p + ' 2>&1 | tail -3', 90000);
            autoInstalled.push(p);
          }
        }
      }
    }

    /* 3) auto-install compiler ตามภาษา (ครั้งแรก) */
    const TOOL_PKGS = { java: 'default-jdk-headless', c: 'gcc', cpp: 'g++', go: 'golang-go', rust: 'rustc', ruby: 'ruby', php: 'php-cli' };
    const TOOL_BINS = { java: ['javac', 'java'], c: ['gcc'], cpp: ['g++'], go: ['go'], rust: ['rustc'], ruby: ['ruby'], php: ['php'] };
    if (TOOL_BINS[l]) {
      for (const b of TOOL_BINS[l]) {
        const chk = await sbExec('which ' + b + ' 2>/dev/null || true', 6000);
        if (!chk.stdout.trim()) {
          await sbExec('apt-get update -qq 2>&1 | tail -1', 60000);
          await sbExec('apt-get install -y ' + TOOL_PKGS[l] + ' 2>&1 | tail -4', 115000);
          break;
        }
      }
    }

    /* 4) รัน */
    let cmd = null, args = [], runCwd = null, pre = null;
    if (l === 'python') {
      runCwd = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'sirun-'));
      fs.writeFileSync(require('path').join(runCwd, 'main.py'), src);
      cmd = 'python3'; args = ['-u', 'main.py'];
    }
    else if (l === 'javascript') { cmd = 'node'; args = ['-e', src]; }
    else if (l === 'bash') { cmd = 'bash'; args = ['-c', src]; }
    else if (l === 'java') {
      runCwd = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'sirun-'));
      fs.writeFileSync(require('path').join(runCwd, 'Main.java'), src);
      pre = 'javac -encoding UTF-8 Main.java'; cmd = 'java'; args = ['-Dfile.encoding=UTF-8', 'Main'];
    }
    else if (l === 'c') {
      runCwd = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'sirun-'));
      fs.writeFileSync(require('path').join(runCwd, 'main.c'), src);
      pre = 'gcc main.c -o main -O2'; cmd = './main'; args = [];
    }
    else if (l === 'cpp') {
      runCwd = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'sirun-'));
      fs.writeFileSync(require('path').join(runCwd, 'main.cpp'), src);
      pre = 'g++ main.cpp -o main -O2'; cmd = './main'; args = [];
    }
    else if (l === 'go') {
      runCwd = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'sirun-'));
      fs.writeFileSync(require('path').join(runCwd, 'main.go'), src);
      cmd = 'go'; args = ['run', 'main.go'];
    }
    else if (l === 'rust') {
      runCwd = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'sirun-'));
      fs.writeFileSync(require('path').join(runCwd, 'main.rs'), src);
      pre = 'rustc main.rs -O -o main'; cmd = './main'; args = [];
    }
    else if (l === 'ruby') {
      runCwd = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'sirun-'));
      fs.writeFileSync(require('path').join(runCwd, 'main.rb'), src);
      cmd = 'ruby'; args = ['main.rb'];
    }
    else if (l === 'php') {
      runCwd = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'sirun-'));
      fs.writeFileSync(require('path').join(runCwd, 'main.php'), src);
      cmd = 'php'; args = ['main.php'];
    }
    else return res.status(400).json({ ok: false, error: 'silelo runner รองรับ python / javascript / bash / java / c / cpp / go / rust / ruby / php' });

    const { spawn } = require('child_process');
    let stdout = '', stderr = '', exitCode = -1;
    if (pre) {
      const po = await sbExec('cd ' + JSON.stringify(runCwd) + ' && ' + pre, 60000);
      if (po.code !== 0) {
        return res.json({ ok: true, stdout: '', stderr: (po.stdout + po.stderr).slice(0, 4000), code: po.code, timeMs: Date.now() - t0, lang: l, engine: 'silelo' });
      }
    }
    try {
      const out = await new Promise((resolve, reject) => {
        const cp = spawn(cmd, args, { cwd: runCwd || undefined, env: Object.assign({}, process.env, { PATH: (process.env.PATH || '/usr/local/bin:/usr/bin:/bin') + ':/usr/local/bin' }), stdio: ['ignore', 'pipe', 'pipe'] });
        let o = '', e = '';
        cp.stdout.on('data', d => { o += d.toString(); if (o.length > 60000) { try { cp.kill('SIGKILL'); } catch (x) {} } });
        cp.stderr.on('data', d => { e += d.toString(); if (e.length > 60000) { try { cp.kill('SIGKILL'); } catch (x) {} } });
        cp.on('error', err => reject(err));
        cp.on('close', code => resolve({ o, e, code }));
        setTimeout(() => { try { cp.kill('SIGKILL'); } catch (x) {} reject(new Error('__timeout__')); }, 25000);
      });
      stdout = out.o; stderr = out.e; exitCode = out.code;
    } catch (err) {
      if (err.message === '__timeout__') { stderr = '⏱️ เกินเวลา 25 วิ'; exitCode = 124; }
      else { stderr = 'เกิดข้อผิดพลาด: ' + err.message; exitCode = 1; }
    }
    if (autoInstalled.length) stdout = '📦 ติดตั้งอัตโนมัติ: ' + autoInstalled.join(', ') + '\n' + stdout;
    return res.json({ ok: true, stdout: stdout.slice(0, 60000), stderr: stderr.slice(0, 60000), code: exitCode, timeMs: Date.now() - t0, lang: l, engine: 'silelo' });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'run error: ' + e.message });
  }
});

/* กัน Render sleep — self-ping ทุก 4 นาที (ถ้า SELF_URL ตั้งไว้) */
const SELF_URL = process.env.SELF_URL || '';
if (SELF_URL) {
  setInterval(() => { fetch(SELF_URL + '/api/health').catch(() => {}); }, 4 * 60 * 1000).unref();
  console.log('🔄 self-ping กัน sleep: ' + SELF_URL);
}



/* ================== 🤖 CODER AGENT — เขียนโค้ด + รัน + แก้บั๊กเอง อัตโนมัติ ================== */
function extractCodeJson(reply) {
  if (!reply) return null;
  let t = String(reply).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 1) ลอง parse ตรง ๆ
  try {
    const j = JSON.parse(t);
    if (j && j.code) return { lang: String(j.lang || 'python').toLowerCase(), code: String(j.code) };
  } catch (e) { }
  // 2) นับ brace depth (ข้าม string) จาก { ตัวแรก — กัน f-string/dict ใน code
  const start = t.indexOf('{');
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const j = JSON.parse(t.slice(start, i + 1));
            if (j && j.code) return { lang: String(j.lang || 'python').toLowerCase(), code: String(j.code) };
          } catch (e) { break; }
        }
      }
    }
  }
  return null;
}

app.post('/api/agent', async (req, res) => {
  const secret = String(req.headers['x-run-secret'] || req.body?.secret || '');
  if (!RUN_SECRET || secret !== RUN_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const prompt = String(req.body?.prompt || '').slice(0, 3000);
  if (!prompt.trim()) return res.status(400).json({ ok: false, error: 'prompt ว่าง' });
  const SYS = 'คุณคือโค้ดเอเจนต์ของ "สลี่" ผู้ช่วย AI ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น: {"lang": "python|javascript|bash|java|c|cpp|go|rust|typescript|ruby|php", "code": "โค้ดเต็ม"} เขียนโค้ดให้สมบูรณ์ รันได้ทันที อ่าน stdin ไม่ได้ ไม่ต้องรอ input ภาษาไทยในโค้ดได้';
  const t0 = Date.now();
  let code = '', lang = 'python', lastErr = '', attempts = 0, modelUsed = '';
  for (attempts = 1; attempts <= 3; attempts++) {
    const userMsg = attempts === 1 ? prompt : prompt + '\n\n⚠️ โค้ดก่อนหน้าของคุณรันไม่ผ่าน: ' + lastErr + '\n\nแก้ไขโค้ดให้ถูกต้อง คืน JSON {"lang":"...","code":"..."} เท่านั้น';
    const r = await coderChat([{ role: 'system', content: SYS }, { role: 'user', content: userMsg }]);
    if (!r || !r.reply) { lastErr = 'AI ไม่ตอบ (provider ล่ม)'; continue; }
    modelUsed = (r.provider || '') + '/' + (r.model || '');
    const parsed = extractCodeJson(r.reply);
    if (!parsed) { lastErr = 'AI ไม่คืน JSON ที่ถูกต้อง: ' + String(r.reply).slice(0, 300); continue; }
    code = parsed.code; lang = parsed.lang;
    if (code.length > 18000) { lastErr = 'โค้ดยาวเกิน 18000 ตัว'; continue; }
    // รันผ่าน /api/run ของตัวเอง (มี auto-install import + compiler)
    try {
      const rr = await fetch('http://localhost:' + PORT + '/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-run-secret': RUN_SECRET },
        body: JSON.stringify({ code, lang }), signal: AbortSignal.timeout(30000)
      });
      const jj = await rr.json();
      if (jj && jj.ok && !jj.stderr && (jj.code === 0 || jj.code === undefined || jj.code === null)) {
        return res.json({ ok: true, code, lang, stdout: (jj.stdout || '').slice(0, 4000), stderr: '', exitCode: jj.code || 0, timeMs: Date.now() - t0, attempts, model: modelUsed, engine: 'silelo-agent' });
      }
      lastErr = String((jj && (jj.stderr || jj.stdout)) || 'run failed').slice(0, 1200);
    } catch (e) { lastErr = 'run error: ' + e.message; }
  }
  return res.json({ ok: false, code, lang, error: lastErr.slice(0, 1500), attempts: Math.min(attempts, 3), model: modelUsed, timeMs: Date.now() - t0 });
});

// 🤗 HF proxy — ให้ Neo-Connect (Vercel) เรียก HF ผ่าน silelo (Render) เพราะ Vercel ไป router.huggingface.co ไม่ได้
app.post('/api/hf-chat', async (req, res) => {
  try {
    const secret = String(req.headers['x-run-secret'] || req.body?.secret || '');
    if (!RUN_SECRET || secret !== RUN_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const { messages, model } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ ok: false, error: 'no messages' });
    const HF_KEYS = (process.env.HF_TOKEN || '').split(/[,;.\n]/).map(s => s.trim()).filter(s => s.startsWith('hf_'));
    if (!HF_KEYS.length) return res.status(400).json({ ok: false, error: 'no hf token' });
    const models = [String(model || ''), 'deepseek-ai/DeepSeek-V4-Flash', 'deepseek-ai/DeepSeek-V4-Pro', 'zai-org/GLM-5.2', 'moonshotai/Kimi-K3', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen3.6-27B'].filter(Boolean);
    for (const m of models) {
      for (const key of HF_KEYS) {
        try {
          const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m, max_tokens: 900, messages, chat_template_kwargs: { enable_thinking: false } }),
            signal: AbortSignal.timeout ? AbortSignal.timeout(22000) : undefined
          });
          if (r.status === 401 || r.status === 402 || r.status === 429) continue; // คีย์นี้หมด/เสีย → คีย์ถัดไป
          if (!r.ok) continue;
          const j = await r.json();
          const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (reply && String(reply).trim()) return res.json({ ok: true, model: m, reply });
        } catch (e) { /* try next */ }
      }
    }
    return res.status(502).json({ ok: false, error: 'hf unavailable' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


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
  console.log('🚀 Silelo server พร้อมใช้งานที่ http://0.0.0.0:' + PORT);
  // 💾 ดึงความจำของสลี่กลับมาจาก Gist (ไม่ลืมแม้ redeploy)
  setTimeout(syncDBFromGist, 1500);
});
