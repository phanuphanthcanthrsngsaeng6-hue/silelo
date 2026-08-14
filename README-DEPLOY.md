# 🚀 คู่มือ Deploy Silelo 💯✨ ขึ้น Render — ลิงก์ถาวร แอปไม่หลับ

> ใช้เวลาประมาณ **10 นาที** ฟรี ไม่ต้องใช้บัตรเครดิต
> ผลลัพธ์: ลิงก์ `https://silelo.onrender.com` **ถาวรตลอดชีพ** เปิดได้ทุกที่ทุกเวลา

---

## 🧰 เตรียมของ (2 อัน ฟรีทั้งคู่)

| อัน | ไปที่ | ใช้ทำอะไร |
|---|---|---|
| 1️⃣ GitHub | https://github.com/signup | เก็บโค้ด (ฟรี) |
| 2️⃣ Render | https://render.com | รันแอป (ฟรี) |

---

## ขั้นตอนที่ 1 — สร้าง GitHub repo

1. เข้า https://github.com/new
2. **Repository name:** `silelo`
3. เลือก **Public** (จำเป็น — Render ฟรีต้อง Public)
4. กด **Create repository**
5. ในหน้า repo กดปุ่ม **"uploading an existing file"** (อยู่ใต้ Quick setup)
6. ลากไฟล์ทั้งหมดจาก zip `silelo-render-deploy.zip` ใส่ (ต้อง **unzip ก่อน** แล้วลากเฉพาะข้างใน เช่น `server.js`, `public/`, `package.json` ฯลฯ **ห้ามลากตัว zip เข้าไป**)
7. กด **Commit changes**

✅ ได้ GitHub repo ที่มีโค้ด Silelo แล้ว

---

## ขั้นตอนที่ 2 — สมัคร Render + เชื่อม GitHub

1. เข้า https://dashboard.render.com/register
2. สมัครด้วย **GitHub** (กด "Sign up with GitHub" — เร็วสุด)
3. ยืนยันอีเมลให้เรียบร้อย

---

## ขั้นตอนที่ 3 — Deploy (ปุ่มเดียวจบ)

1. ที่หน้า Dashboard กด **"New +"** → เลือก **"Blueprint"**
2. เลือก repo `silelo` ที่เพิ่งสร้าง → กด **"Connect"**
3. Render อ่าน `render.yaml` ให้อัตโนมัติ — จะเห็นบริการชื่อ `silelo`
4. กด **"Apply"** → **"Create Resources"**
5. ✅ **ไม่ต้องกรอกคีย์ใดๆ** — render.yaml มี API keys ครบแล้ว (Groq STT + OpenRouter AI + DeepSeek)
   - ถ้า Render ถาม `OPENROUTER_API_KEY` (บางเวอร์ชัน) วางคีย์นี้ลงไปได้เลย (2 คีย์ คั่นด้วยคอมม่าอยู่แล้ว):

```
<ใส่คีย์ OpenRouter ตอน Render ถาม>
```

6. กด **Deploy** — รอ build ~3-5 นาที (ดู log ได้)

---

## ขั้นตอนที่ 4 — ได้ลิงก์ถาวร 🎉

หลัง deploy เสร็จ Render จะให้ URL:

```
https://silelo.onrender.com
```

- เปิดเลย → หน้า Login → กด **"เข้าชมแบบทดลอง"** → ใช้แอปได้ทันที
- AI แชท (สลี่) + สร้างภาพ ทำงานครบ

---

## ขั้นตอนที่ 5 — กันแอปหลับ (สำคัญ!)

Render ฟรีจะพักแอปหลังไม่มีการใช้งาน 15 นาที — วิธีกันหลับ ฟรี:

1. สมัคร https://uptimerobot.com (ฟรี — อีเมลเดียว)
2. **Add New Monitor** → เลือก **HTTP(S)**
3. URL: `https://silelo.onrender.com/api/health`
4. Interval: **Every 5 minutes**
5. กด Create

UptimeRobot จะ ping ทุก 5 นาที → แอป **ไม่หลับตลอด 24 ชม.** (ฟรี 50 monitors)

---

## 🔁 อัปเดตเวอร์ชันใหม่

แก้โค้ด → push ขึ้น GitHub → Render **auto-deploy เอง** (ตั้งไว้แล้วใน blueprint) → รอ 2 นาที

```bash
git add -A
git commit -m "อัปเดตฟีเจอร์ใหม่"
git push origin main
```

---

## ⚙️ ตั้งค่าอื่นๆ (เลือกได้)

| ค่า | ตั้งที่ไหน | ค่าเริ่มต้น |
|---|---|---|
| เจ้าของแอป (สลี่รับใช้คนเดียว) | Render → Environment → `AI_OWNER_EMAIL` | `demo@silelo.app` |
| โมเดลแชท | `OPENROUTER_TEXT_MODELS` | `openai/gpt-oss-20b:free,nvidia/nemotron-3-ultra-550b-a55b:free` |
| โมเดลสร้างภาพ | `OPENROUTER_IMAGE_MODEL` | `google/gemini-2.5-flash-image` |
| คีย์ Ideogram (ถ้ามี) | `IDEOGRAM_API_KEY` | ว่าง (ใช้ Gemini/Pollinations แทน) |

---

## 🩺 เช็คสุขภาพแอป

```
https://silelo.onrender.com/api/health
```
ตอบ `{"ok": true, "app": "silelo", ...}` = แอปแข็งแรงดี

---

**เสร็จแล้ว!** 🔥 แอป Silelo พร้อมใช้ถาวร เปิด 24 ชม. ไม่หลับ ไม่ต้องเปิดเครื่อง

## 🔊 ระบบเสียงสลี่ (ใหม่)
- **TTS (เสียงสลี่พูด)**: ฟรี ไม่ต้องคีย์ — ใช้ `th-TH-PremwadeeNeural` (ผู้หญิงไทย อ่อนหวาน)
- **STT (ฟังพี่นุ)**: ต้องมีคีย์ Groq ฟรี → https://console.groq.com → ตั้ง `GROQ_API_KEY`
- ปุ่ม **โทร** ในแถบเมนูด้านล่าง: กดค้าง 🎤 = พูด / กด 📞 = โหมดคุยต่อเนื่อง
- ความทรงจำถาวร: สลี่จำสิ่งที่พี่นุสอนผ่าน `/api/memories`
