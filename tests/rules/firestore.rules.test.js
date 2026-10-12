// รันด้วย `npm run test:rules` (ต้องมี Java เพื่อเปิด Firestore emulator) — ไม่แตะ Firestore ของจริง
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";

let env;
const USERS = {
  owner: { role: "owner", status: "approved" },
  staff: { role: "staff", status: "approved" },
  pending: { role: "staff", status: "pending" },
  disabled: { role: "staff", status: "disabled" },
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-khlang-lek",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
afterAll(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, p] of Object.entries(USERS)) await db.doc(`users/${uid}`).set({ uid, email: `${uid}@x.th`, ...p });
    await db.doc("items/i1").set({ name: "เหล็กกล่อง", qty: 10 });
    await db.doc("settings/shop").set({ name: "ร้านทดสอบ" });
    await db.doc("itemCosts/i1").set({ cost: 100 });
  });
});

const as = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

describe("ไม่ล็อกอิน", () => {
  it("อ่าน/เขียนอะไรไม่ได้เลย", async () => {
    const db = as(null);
    await assertFails(db.doc("items/i1").get());
    await assertFails(db.collection("items").get());
    await assertFails(db.doc("items/i2").set({ name: "x" }));
    await assertFails(db.doc("settings/shop").get());
    await assertFails(db.collection("users").get());
  });
});

describe("pending / disabled", () => {
  for (const uid of ["pending", "disabled"]) {
    it(`${uid}: อ่าน/เขียนข้อมูลร้านไม่ได้`, async () => {
      const db = as(uid);
      await assertFails(db.collection("items").get());
      await assertFails(db.doc("docs/d1").set({ total: 1 }));
      await assertFails(db.doc("settings/shop").get());
    });
    it(`${uid}: อ่านโปรไฟล์ตัวเองได้ (เพื่อรอการอนุมัติ)`, async () => {
      await assertSucceeds(as(uid).doc(`users/${uid}`).get());
    });
    it(`${uid}: อนุมัติตัวเอง/ตั้งตัวเองเป็นเจ้าของไม่ได้`, async () => {
      await assertFails(as(uid).doc(`users/${uid}`).update({ status: "approved" }));
      await assertFails(as(uid).doc(`users/${uid}`).update({ role: "owner" }));
    });
  }
  it("ล็อกอินแล้วแต่ยังไม่มีโปรไฟล์ = ห้าม", async () => {
    await assertFails(as("nobody").collection("items").get());
  });
});

describe("ลูกน้อง (approved staff)", () => {
  it("อ่าน/เขียนข้อมูลหน้าร้านได้", async () => {
    const db = as("staff");
    await assertSucceeds(db.collection("items").get());
    await assertSucceeds(db.doc("docs/d1").set({ total: 100 }));
    await assertSucceeds(db.doc("moves/m1").set({ at: 1 }));
    await assertSucceeds(db.doc("settings/shop").get());
    await assertSucceeds(db.doc("counters/RC2610").set({ last: 1 }));
  });
  it("แก้ตั้งค่าร้าน / ประวัติราคาไม่ได้", async () => {
    const db = as("staff");
    await assertFails(db.doc("settings/shop").set({ name: "แฮก" }));
    await assertFails(db.doc("prices/p1").set({ at: 1 }));
  });
  it("อ่าน itemCosts ไม่ได้", async () => {
    await assertFails(as("staff").doc("itemCosts/i1").get());
  });
  it("ดูรายชื่อผู้ใช้/โปรไฟล์คนอื่นไม่ได้", async () => {
    await assertFails(as("staff").collection("users").get());
    await assertFails(as("staff").doc("users/owner").get());
  });
  it("เปลี่ยน role/status ของตัวเองไม่ได้ แต่แก้ชื่อได้", async () => {
    const db = as("staff");
    await assertFails(db.doc("users/staff").update({ role: "owner" }));
    await assertFails(db.doc("users/staff").update({ status: "disabled" }));
    await assertSucceeds(db.doc("users/staff").update({ displayName: "สมชาย" }));
  });
  it("collection ที่ไม่อยู่ในรายการ = ห้าม", async () => {
    await assertFails(as("staff").doc("secret/x").set({ a: 1 }));
  });
});

describe("สมัครใหม่", () => {
  const p = (uid, extra) => ({ uid, email: `${uid}@x.th`, role: "staff", status: "pending", ...extra });
  it("สร้างโปรไฟล์ตัวเองเป็น staff/pending ได้", async () => {
    await assertSucceeds(as("new1").doc("users/new1").set(p("new1")));
  });
  it("สร้างตัวเองเป็น owner หรือ approved ไม่ได้", async () => {
    await assertFails(as("new1").doc("users/new1").set(p("new1", { role: "owner" })));
    await assertFails(as("new1").doc("users/new1").set(p("new1", { status: "approved" })));
  });
  it("สร้างโปรไฟล์ให้คนอื่นไม่ได้", async () => {
    await assertFails(as("new1").doc("users/new2").set(p("new2")));
  });
});

describe("เจ้าของ", () => {
  it("อ่าน/เขียนได้ทุกอย่างรวมต้นทุน", async () => {
    const db = as("owner");
    await assertSucceeds(db.doc("itemCosts/i1").get());
    await assertSucceeds(db.doc("settings/shop").set({ name: "ร้านใหม่" }));
    await assertSucceeds(db.doc("prices/p1").set({ at: 1 }));
  });
  it("จัดการผู้ใช้ได้", async () => {
    const db = as("owner");
    await assertSucceeds(db.collection("users").orderBy("createdAt", "desc").get());
    await assertSucceeds(db.doc("users/pending").update({ status: "approved", role: "staff" }));
    await assertSucceeds(db.doc("users/staff").update({ status: "disabled" }));
    await assertSucceeds(db.doc("users/disabled").delete());
  });
});
