# CLAUDE.md — คลังเหล็ก (ระบบสต็อก/ขาย/การเงินร้านเหล็ก)

> ไฟล์นี้ให้ Claude Code อ่านอัตโนมัติทุกครั้งที่เปิด session ใน repo นี้
> ข้อความที่เขียนว่า "ตรวจจาก repo" คือยังไม่ยืนยัน ให้เช็กกับโค้ดจริงก่อนเชื่อ แล้วแก้ไฟล์นี้ให้ตรง

## โปรเจ็คนี้คืออะไร
เว็บแอปจัดการสต็อก ซื้อเข้า ขาย ออกเอกสาร ลูกหนี้ และการเงินของร้านค้าเหล็ก UI ภาษาไทย ใช้บนมือถือเป็นหลัก
พอร์ตมาจากอาร์ติแฟกต์ใน claude.ai (ไฟล์เดียว ~2,750 บรรทัด) ต้นฉบับอยู่ที่ `reference/original.html` **ห้ามแก้ไฟล์นั้น**
แผนงานเต็มอยู่ที่ `docs/PLAN.md` (เฟส 1–10) — **ยังไม่มีไฟล์นี้ใน repo** ให้ใช้เป็นเกณฑ์ตรวจว่างานครบหรือยัง

## Stack
- Vite + vanilla JS (ยังไม่ใช่ React ตั้งใจไม่เขียนใหม่)
- Firebase: Firestore, Auth, Storage — ใช้ **compat SDK** (`firebase/compat/*` ใน `src/lib/firebase.js`)
- Vercel: deploy อัตโนมัติจาก `main`, มี serverless function `api/read-doc.js` เรียก Anthropic API (Claude Haiku 5.5) อ่านบิล — ฝั่งเว็บเรียกผ่าน capability `sample` ใน `src/lib/claude-shim.js` และต้องส่ง Firebase ID token มาด้วย
- ไลบรารี: `xlsx` (SheetJS), `qrcode-generator`

## คำสั่งที่ใช้บ่อย
- `npm install`
- `npm run dev` — รันเครื่องตัวเอง
- `npm run build` — ต้องผ่านก่อนเปิด PR ทุกครั้ง
- `npm test` — Vitest (เทสต์อยู่ใน `tests/`, ฟังก์ชันคำนวณที่แยกออกมาอยู่ใน `src/lib/`)
- `npm run test:rules` — เทสต์ rules + `dbStore` บน Firestore/Storage emulator (`tests/rules/`, ต้องมี Java) ไม่แตะของจริง

## กฎการทำงาน (สำคัญ)
1. **ห้าม push เข้า `main` ตรงๆ** Vercel deploy ขึ้นของจริงที่ลูกค้าใช้อยู่ทันที ให้ทำบน branch แยก (`fix/...`, `feat/...`) แล้วเปิด PR รอผมอนุมัติ Vercel จะมี preview URL ให้ทดสอบ
2. **ห้ามใส่ secret ในโค้ดหรือ commit** (`ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `.env`) ค่าเหล่านี้อยู่ใน Vercel env เท่านั้น ใน client ใช้ได้เฉพาะ `VITE_FIREBASE_*`
3. **แก้ให้น้อยที่สุด** ห้ามเปลี่ยนดีไซน์ ข้อความภาษาไทย หรือตรรกะธุรกิจ โดยไม่ได้ขอ ถ้าเจอสิ่งที่ควรปรับ ให้รายงานก่อน ไม่ต้องแก้เอง
4. **ห้ามลบหรือแก้ข้อมูลใน Firestore ของจริง** ทดสอบกับ emulator หรือโปรเจ็ค Firebase แยก
5. ทุกอย่างที่แตะเงิน/สต็อกต้องมีเทสต์: คำนวณน้ำหนักเหล็ก, ตัดแบ่งเหล็ก (cut planner), ต้นทุน-กำไร, ยอดหนี้และการตัดชำระ (ใบเก่าสุดก่อน), เลขที่เอกสาร (`nextNo`)
6. commit message สั้น ชัดเจน หนึ่งเรื่องต่อหนึ่ง commit

## สถาปัตยกรรมที่ต้องรู้
- **ชั้น storage** (`src/lib/store.js`): `store` มี `sub/set/update/del` path รูปแบบ `collection/id`; มี `localStore` (localStorage, ไว้ dev) และ `dbStore` (Firestore)
  - `store.run(fn)` = transaction (อ่านค่าล่าสุดแล้วเขียนทั้งหมดพร้อมกัน) ใช้กับทุกอย่างที่ลดสต็อก/ตัดเหล็ก/ออกบิล; `store.inc(n)` / `store.push(v)` = เพิ่มจำนวน/ต่อท้ายอาร์เรย์โดยไม่ทับเครื่องอื่น (ใช้กับรับเข้าและรับชำระ)
  - ต้นทุนอยู่ที่ `itemCosts/{itemId}` ไม่ใช่ `items.cost`: เจ้าของอ่านได้คนเดียว ลูกน้องบันทึกซื้อเข้าด้วย `store.costIn` (ต่อท้าย `pending`) แล้วเครื่องเจ้าของคำนวณทุนเฉลี่ย (`src/lib/item-costs.js`) เจ้าของเปิดแอปครั้งแรกจะย้าย `items.cost` เดิมไปให้อัตโนมัติ
  - บิลที่ลูกน้องออกไม่มีทุน บรรทัดจะมี `costLater:true` รายงานกำไรใช้ทุนปัจจุบันของสินค้าแทน (`lineCost`)
- **Collections**: `items, moves, buys, docs, cash, settings, closes, counts, prices, orders, customers` + `users`, `itemCosts` (ต้นทุน), `counters` (เลขที่เอกสาร)
- **Shim**: โค้ดเดิมเรียก `claude.use("db" | "user" | "assets" | "downloads" | "sample")` ซึ่งเดิมมาจาก claude.ai ตอนนี้ถูกแทนด้วย `window.claude` shim ที่ต่อ Firebase/Vercel (ดู `src/lib/claude-shim.js`)
- **สิทธิ์**: เจ้าของเห็นต้นทุน-กำไร ลูกน้องไม่เห็น ต้องบังคับที่ `firestore.rules` ด้วย ไม่ใช่แค่ซ่อนใน UI (CSS `.owner`, `isStaff()`)
- **ข้อมูลร้าน** (ชื่อ ที่อยู่ เบอร์ เลขผู้เสียภาษี) อยู่ใน `settings/shop` ห้ามฝังค่าของลูกค้ารายใดไว้ในโค้ดหรือในพรอมต์อ่านบิล

## บัญชีของลูกค้า (ตั้งค่าครั้งเดียว)
- **GitHub**: repo นี้ให้ลูกค้าเข้าถึง แล้วลูกค้าเชื่อม GitHub ที่ claude.ai/connect-github + ติดตั้ง Claude GitHub App ให้ repo นี้ จากนั้นเปิด session ใน claude.ai/code เลือก repo นี้
- **Firebase**: โปรเจ็กต์ของลูกค้า เปิด Firestore + Auth (อีเมล/รหัสผ่าน) + Storage แล้วเอา web config ใส่ Vercel env
- **Anthropic API**: บัญชี Claude Console ของลูกค้า สร้าง API key แล้วใส่ Vercel env
- **Vercel env ที่ต้องมี**
  - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` (ค่าสาธารณะ ถูกใส่ในหน้าเว็บ)
  - `ANTHROPIC_API_KEY` — **ห้ามขึ้นต้นด้วย `VITE_`** ไม่งั้นหลุดไปอยู่ในหน้าเว็บ
  - (ไม่บังคับ) `ANTHROPIC_MODEL` ถ้าจะเปลี่ยนรุ่น, `FIREBASE_PROJECT_ID` ถ้าไม่อยากให้ function อ่านจาก `VITE_FIREBASE_PROJECT_ID`
- เปลี่ยน env แล้วต้อง **Redeploy** ค่า `VITE_*` ถึงจะเข้าไปในหน้าเว็บ

## สถานะความปลอดภัย (เช็กลิสต์ก่อนใช้งานจริง)
Firebase project: `jin-replit1` — rules ใหม่ deploy แล้ว (2026-10-12) ผ่าน Firebase console (ตรวจจากภายนอกแล้ว: ไม่ล็อกอินอ่าน Firestore ได้ 403) เจ้าของล็อกอินและเห็นข้อมูล/ต้นทุนปกติ
**แก้ rules ใน repo แล้วต้อง deploy ใหม่เสมอ** (`firebase deploy --only firestore:rules,storage --project jin-replit1` หรือวางใน Firebase console) และ deploy หลัง Vercel ขึ้นโค้ดที่เข้ากันแล้วเท่านั้น

1. ✅ `store.sub(...)` เริ่มหลังล็อกอินและได้รับอนุมัติแล้ว (`startSubs()` ใน `src/main.js`)
2. ✅ `firestore.rules` + `storage.rules`: ไม่ล็อกอิน / `pending` / `disabled` = ห้าม, ผู้ใช้ห้ามแก้ `role`/`status` ของตัวเอง (เทสต์ใน `tests/rules/`)
3. ✅ ลบเงื่อนไขอีเมลมี `dev`/`zined` → owner อัตโนมัติแล้ว
4. ✅ ต้นทุนแยกไป `itemCosts` (owner อ่านได้คนเดียว), shim `isOwner()` อ่านจาก role จริง — ตามที่เลือก: ราคาในบิลซื้อ (`buys`) และทุนในบิลขาย (`docs.lines.cost`) ลูกน้องยังอ่านได้
5. ✅ PIN `8888`/`1111` ไม่ได้ใช้ตรวจสิทธิ์แล้ว (ใช้ล็อกอินอีเมล) จึงเลิกเขียนลง `settings/shop` แทนการบังคับเปลี่ยน
6. ✅ `nextNo` จองเลขผ่าน transaction ที่ `counters/{prefix}`
7. ✅ ไม่มี Firebase config ฝังในโค้ด ใช้ `VITE_FIREBASE_*` จาก Vercel env อย่างเดียว ถ้าไม่ตั้ง แอปจะเป็นโหมดทดลอง (เก็บในเครื่อง)

ยังไม่ได้ลองบนของจริง: ขาย/รับเข้า/รับชำระ, บัญชีลูกน้อง, อ่านบิล (`api/read-doc.js` ต้องตั้ง `ANTHROPIC_API_KEY`), Storage rules (ยังไม่ได้ตรวจจากภายนอก)

## งานแรกของ session แรก (รีวิวสถานะ)
1. อ่าน `docs/PLAN.md` แล้วเทียบกับโค้ดจริงทีละเฟส ทำตารางสรุป ✅ ทำแล้ว / ⚠️ ทำไม่ครบ / ❌ ยังไม่ทำ พร้อมไฟล์และบรรทัดที่อ้างอิง
2. รัน `npm install && npm run build` รายงาน error/warning
3. ตรวจ secret หลุด: `grep -rn "sk-ant\|private_key\|service_account" --exclude-dir=node_modules --exclude-dir=.git .` และตรวจ `dist/`
4. ตรวจ `firestore.rules` / `storage.rules` ว่าลูกน้องอ่าน collection ต้นทุน/กำไรไม่ได้ และคนไม่ล็อกอินอ่านอะไรไม่ได้
5. ตรวจว่า `DEFAULT_SHOP` (ชื่อร้าน/เบอร์ลูกค้ารายแรก) ถูกเอาออกจากโค้ดและพรอมต์แล้ว
6. เสนอรายการเทสต์ที่ควรเพิ่มตามลำดับความเสี่ยง แล้ว**รอผมเลือก**ก่อนเริ่มเขียน

## นิยามว่า "เสร็จ"
`npm run build` ผ่าน, เทสต์ผ่าน, ทดสอบบน Vercel preview แล้ว, ไม่มี secret ใน bundle, PR มีคำอธิบายว่าแก้อะไรและทดสอบอย่างไร
