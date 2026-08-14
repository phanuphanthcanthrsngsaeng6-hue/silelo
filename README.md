# 💯✨️ Silelo — แอปพลิเคชันมือถือ AI ครบวงจร

แอปพลิเคชันมือถือตัวอย่างที่สร้างตามสเป็คแพ็กเกจ **$12,999** ของ Silelo💯✨️
เป็นแอป **ข้ามแพลตฟอร์ม (Cross-platform)** แบบ PWA — ใช้งานได้จริงบน **iOS และ Android**
พร้อมติดตั้งลงหน้าจอโทรศัพท์ได้ (Add to Home Screen)

---

## 🚀 เริ่มใช้งาน

```bash
cd kites-app
npm install
npm start
# เปิด http://localhost:8080
```

### บัญชีทดลอง
| อีเมล | รหัสผ่าน | สถานะ |
|---|---|---|
| `demo@silelo.app` | `demo1234` | **บัญชีหลัก (Owner)** — Plan `Unlimited` · ไร้ขีดจำกัด 100% · จ่ายครบ 3/3 งวด ($12,999) |

---

## 🔌 AI แชทจริง (OpenRouter :free → mock)

**`POST /api/ai`** ต่อ OpenRouter แล้ว — ตอบคำถาม ค้นหา พูดคุย ได้จริง **ฟรี 100%**
โดยใช้โมเดลฟรี `openai/gpt-oss-20b:free` (สำรอง `nvidia/nemotron-3-ultra-550b-a55b:free`)
พร้อม system prompt ที่รู้ข้อมูลโปรเจกต์ Silelo (สรุปโปรเจกต์ / ยอดขาย / ฟีเจอร์) + จำบริบทสนทนาได้

```bash
# เปลี่ยนโมเดลได้ (คั่นหลายตัวด้วยคอมม่า — ตัวแรกที่ใช้ได้จะถูกใช้)
export OPENROUTER_TEXT_MODELS=openai/gpt-oss-20b:free,nvidia/nemotron-3-ultra-550b-a55b:free
npm start
```

ถ้า OpenRouter ออฟไลน์ → fallback เป็นโหมดสำเร็จรูป (mock) อัตโนมัติ

---
## 🎨 AI สร้างภาพ (Ideogram → OpenRouter Gemini → Pollinations auto)

ในหน้า **AI** มีปุ่มสลับโหมด **💬 แชท / 🎨 สร้างภาพ** — พิมพ์บรรยายภาพแล้ว AI จะวาดให้ทันที
(แสดงผลในแชท + ปุ่มดาวน์โหลด) — **ใช้งานได้ทันที ไม่ต้องตั้งค่าอะไร** (มีบริการฟรีเป็นตัวสำรอง)

**ลำดับผู้ให้บริการ (auto-fallback อัตโนมัติ):**
1. **Ideogram** — ตั้ง `IDEOGRAM_API_KEY` (คุณภาพดีที่สุดด้านตัวอักษรในภาพ)
2. **OpenRouter + Google Gemini 2.5 Flash Image** — คีย์ `sk-or-v1-...` ฝังในโค้ดแล้ว (ภาพละ ~$0.04)
3. **Pollinations.ai** — ฟรี 100% ไม่ต้องคีย์ (ตัวสำรองสุดท้าย — ใช้ได้เสมอ)

```bash
export IDEOGRAM_API_KEY=คีย์ของคุณ        # ไม่บังคับ — ไม่มีก็ได้
export OPENROUTER_API_KEY=sk-or-v1-...   # คีย์หลัก,คีย์สำรอง คั่นด้วยคอมม่า
export OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image
npm start
```

> 📌 **หมายเหตุคีย์ OpenRouter (free tier)**: คีย์ที่ฝังในโค้ดเป็นบัญชี free —
> มีโควต้าเครดิตจำกัด (~$0.5) ภาพละ ~$0.04 จะหมดหลังใช้งานไม่กี่ภาพ
> จากนั้นระบบจะสลับไปใช้ **Pollinations ฟรี** อัตโนมัติ
> **แนะนำ**: เติมเครดิต $5–10 ที่ https://openrouter.ai/settings/credits
> จะได้สร้างภาพ Gemini ต่อเนื่อง ~130–250 ภาพ
> (ถ้าใช้ `openai/gpt-5-image-mini` ได้คุณภาพระดับมืออาชีพ ราคาใกล้เคียงกัน)

---

## ✨ ฟีเจอร์ (ตามสเป็ค)

| ฟีเจอร์ | รายละเอียด |
|---|---|
| 🔐 **Auth** | สมัคร/เข้าสู่ระบบ ด้วย JWT + bcrypt (รหัสผ่านเข้ารหัส) |
| 📊 **Dashboard** | สถิติผู้ใช้/รายได้/การชำระ + กราฟ Chart.js |
| 🤖 **AI Assistant** | แชทบอทตอบคำถาม: สรุปโปรเจกต์, วิเคราะห์ยอดขาย, แนะนำฟีเจอร์ |
| 💬 **แชท Real-time** | WebSocket — ข้อความ sync ระหว่างผู้ใช้ทันที |
| 📍 **แผนที่** | Leaflet + ตำแหน่งสำนักงาน/พันธมิตร/เซิร์ฟเวอร์ |
| 💰 **ชำระเงิน** | แพ็กเกจ $12,999 · 3 งวด ($3,900/$5,200/$3,899) · บัตร/PromptPay (Sandbox) |
| 📈 **Analytics** | กราฟผู้ใช้รายเดือน + Retention + Insight อัตโนมัติ |
| ⚙️ **ตั้งค่า** | โปรไฟล์, การแจ้งเตือน, โหมดมืด |
| 📱 **PWA** | Manifest + Service Worker — ติดตั้งได้ offline |

---

## 🛠 เทคโนโลยี

- **Frontend:** HTML/CSS/JS (Mobile-first UI) + Chart.js + Leaflet
- **Backend:** Node.js + Express
- **ฐานข้อมูล:** JSON Data Store (สลับเป็น PostgreSQL/Firebase ได้ทันที)
- **เรียลไทม์:** WebSocket (`ws`)
- **Auth:** JWT + bcryptjs

## 📁 โครงสร้าง

```
kites-app/
├── server.js          # Backend: API + WebSocket + Auth
├── package.json
├── data/db.json       # ฐานข้อมูล (สร้างอัตโนมัติ)
└── public/
    ├── index.html     # App Shell
    ├── style.css      # สไตล์มือถือ
    ├── app.js         # ตรรกะแอป
    ├── manifest.json  # PWA
    ├── sw.js          # Service Worker
    └── icon-*.png     # ไอคอนแอป
```

## 🔌 REST API

| Method | Path | คำอธิบาย |
|---|---|---|
| POST | `/api/register` | สมัครสมาชิก |
| POST | `/api/login` | เข้าสู่ระบบ |
| GET | `/api/me` | ข้อมูลผู้ใช้ (Auth) |
| GET | `/api/stats` | สถิติ dashboard |
| GET | `/api/analytics` | ข้อมูลกราฟ |
| GET | `/api/transactions` | ประวัติการชำระ |
| GET | `/api/package` | แพ็กเกจ + งวดชำระ |
| POST | `/api/pay` | ชำระเงิน (Sandbox) |
| GET/POST | `/api/messages` | ประวัติ/ส่งข้อความ |
| WS | `/` | แชทเรียลไทม์ |

---

**หมายเหตุ:** ระบบชำระเงินเป็นโหมด Sandbox เพื่อสาธิต — ในเวอร์ชันโปรดักชันสามารถเชื่อมต่อ
Stripe/PromptPay API, ฐานข้อมูล PostgreSQL, และ Firebase Auth ได้โดยตรง
