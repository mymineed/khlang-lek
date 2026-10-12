// dbStore กับ Firestore emulator + rules จริง (npm run test:rules) — ไม่แตะ Firestore ของจริง
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import { dbStore } from "../../src/lib/store.js";

const FieldValue = firebase.firestore.FieldValue;
let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-khlang-lek-store",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
afterAll(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("users/owner").set({ uid: "owner", role: "owner", status: "approved" });
    await db.doc("users/s1").set({ uid: "s1", role: "staff", status: "approved" });
    await db.doc("users/s2").set({ uid: "s2", role: "staff", status: "approved" });
    await db.doc("items/a").set({ name: "เหล็กกล่อง", qty: 10, unit: "เส้น" });
  });
});

const dbOf = (uid) => env.authenticatedContext(uid).firestore();
const storeOf = (uid, owner = false) => dbStore(dbOf(uid), { FieldValue, isOwner: () => owner, warn: () => {} });
const raw = async (path) => { let v; await env.withSecurityRulesDisabled(async (ctx) => { const s = await ctx.firestore().doc(path).get(); v = s.exists ? s.data() : null; }); return v; };
const count = async (col) => { let n; await env.withSecurityRulesDisabled(async (ctx) => { n = (await ctx.firestore().collection(col).get()).size; }); return n; };
const until = async (fn, ms = 8000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 100)); } };

// ขายออกแบบเดียวกับ move("out") ใน main.js
const sellOut = (store, n) => store.run(async (tx) => {
  const it = await tx.get("items/a");
  if (n > it.qty) throw new Error("ของไม่พอ");
  tx.update("items/a", { qty: it.qty - n });
  tx.set("moves/" + Math.random().toString(36).slice(2), { type: "out", qty: n, itemId: "a" });
});

describe("สองเครื่องเขียนพร้อมกัน (บัคข้อ 1, 2)", () => {
  it("ขายพร้อมกันสองเครื่อง สต็อกถูกต้อง ไม่ทับกัน", async () => {
    await Promise.all([sellOut(storeOf("s1"), 3), sellOut(storeOf("s2"), 3)]);
    expect((await raw("items/a")).qty).toBe(4);
    expect(await count("moves")).toBe(2);
  });
  it("ขายพร้อมกันจนของไม่พอ เครื่องหนึ่งต้องล้ม ไม่ติดลบ", async () => {
    const r = await Promise.allSettled([sellOut(storeOf("s1"), 7), sellOut(storeOf("s2"), 7)]);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect((await raw("items/a")).qty).toBe(3);
    expect(await count("moves")).toBe(1);
  });
  it("inc รับเข้าพร้อมกัน ไม่หาย", async () => {
    const a = storeOf("s1"), b = storeOf("s2");
    await Promise.all([a.update("items/a", { qty: a.inc(5) }), b.update("items/a", { qty: b.inc(2) })]);
    expect((await raw("items/a")).qty).toBe(17);
  });
  it("รับชำระพร้อมกันสองเครื่อง ได้ครบทั้งสองรายการ", async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc("docs/d").set({ type: "credit", total: 1000, payments: [] }));
    const a = storeOf("s1"), b = storeOf("s2");
    await Promise.all([
      a.update("docs/d", { payments: a.push({ amount: 300, at: 1 }) }),
      b.update("docs/d", { payments: b.push({ amount: 200, at: 2 }) }),
    ]);
    expect((await raw("docs/d")).payments.map((p) => p.amount).sort()).toEqual([200, 300]);
  });
  it("run ล้มกลางทาง ไม่มีอะไรถูกเขียน (บัคข้อ 3)", async () => {
    await expect(storeOf("s1").run(async (tx) => {
      await tx.get("items/a");
      tx.update("items/a", { qty: 0 });
      tx.set("docs/x", { no: "RC2610-001" });
      throw new Error("ตัดไม่ได้");
    })).rejects.toThrow("ตัดไม่ได้");
    expect((await raw("items/a")).qty).toBe(10);
    expect(await raw("docs/x")).toBeNull();
  });
  it("nextSeq ออกเลขพร้อมกัน 5 ใบ ไม่ซ้ำ", async () => {
    const ns = await Promise.all(["s1", "s2", "s1", "s2", "owner"].map((u) => storeOf(u).nextSeq("RC2610", 3)));
    expect([...ns].sort((x, y) => x - y)).toEqual([4, 5, 6, 7, 8]);
  }, 60000); // transaction ชนกันจะ retry พร้อม backoff
});

describe("แยกต้นทุน (ทาง ข)", () => {
  it("ลูกน้องอ่าน itemCosts ไม่ได้", async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc("itemCosts/a").set({ cost: 300 }));
    await assertFails(dbOf("s1").doc("itemCosts/a").get());
    await assertFails(dbOf("s1").collection("itemCosts").get());
    await assertSucceeds(dbOf("owner").doc("itemCosts/a").get());
  });
  it("ลูกน้องบันทึกซื้อเข้า: เพิ่ม pending ได้ แต่ตั้งทุนเองไม่ได้", async () => {
    await assertSucceeds(storeOf("s1").costIn("a", { oq: 10, a: 10, c: 330, at: 1 }));
    await assertSucceeds(storeOf("s2").costIn("a", { oq: 20, a: 5, c: 340, at: 2 }));
    expect((await raw("itemCosts/a")).pending).toHaveLength(2);
    await assertFails(dbOf("s1").doc("itemCosts/a").set({ cost: 1 }, { merge: true }));
    await assertFails(dbOf("s1").doc("itemCosts/a").set({ pending: [] }, { merge: true }));
  });
  it("ลูกน้องแก้สินค้าที่มีช่องทุน: ทุนไม่ถูกเขียนที่ไหนเลย", async () => {
    await storeOf("s1").set("items/a", { name: "เหล็กกล่อง", qty: 10, unit: "เส้น", cost: 0 });
    expect(await raw("items/a")).not.toHaveProperty("cost");
    expect(await raw("itemCosts/a")).toBeNull();
  });
  it("ลูกน้องเขียน cost ลง items ตรงๆ ไม่ได้ และลบ cost เดิมไม่ได้", async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc("items/old").set({ name: "เก่า", qty: 1, cost: 250 }));
    await assertFails(dbOf("s1").doc("items/a").update({ cost: 1 }));
    await assertFails(dbOf("s1").doc("items/new").set({ name: "x", qty: 1, cost: 1 }));
    await assertFails(dbOf("s1").doc("items/old").set({ name: "เก่า", qty: 2 }));
    await assertSucceeds(dbOf("s1").doc("items/old").update({ qty: 2 }));
    // set ผ่าน store (merge) ต้องไม่ลบทุนเดิม
    await storeOf("s1").set("items/old", { name: "เก่า", qty: 3, cost: 0 });
    expect((await raw("items/old")).cost).toBe(250);
  });
  it("เจ้าของแก้ทุน: เขียนไป itemCosts ไม่ใช่ items", async () => {
    await storeOf("owner", true).set("items/a", { name: "เหล็กกล่อง", qty: 10, unit: "เส้น", cost: 320 });
    expect(await raw("items/a")).not.toHaveProperty("cost");
    expect((await raw("itemCosts/a")).cost).toBe(320);
  });
  it("เจ้าของเปิดแอป: ย้ายทุนเดิม + คำนวณ pending ของลูกน้อง แล้วเห็นทุนที่ถูกต้อง", async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc("items/a").update({ cost: 300 }));
    await storeOf("s1").costIn("a", { oq: 10, a: 10, c: 330, at: 1 });
    const seen = [];
    const un = storeOf("owner", true).sub("items", {}, (v) => seen.push(v.find((i) => i.id === "a").cost));
    await until(async () => { const c = await raw("itemCosts/a"); const i = await raw("items/a"); return c && c.cost === 315 && !(c.pending || []).length && !("cost" in i); });
    expect(seen[0]).toBe(315); // เห็นทุนเฉลี่ยทันทีตั้งแต่ก่อนคำนวณเสร็จ
    expect(seen.at(-1)).toBe(315);
    un();
  });
  it("ลูกน้องเห็นสินค้าแต่ไม่เห็นทุน (หลังย้ายแล้ว)", async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc("itemCosts/a").set({ cost: 300 }));
    let v; const un = storeOf("s1").sub("items", {}, (x) => (v = x));
    await until(async () => v);
    expect(v[0]).not.toHaveProperty("cost");
    un();
  });
});
