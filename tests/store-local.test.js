import { describe, it, expect, beforeEach } from "vitest";
import { localStore } from "../src/lib/store.js";

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
let store, ids;
beforeEach(() => {
  let n = 0;
  ids = () => "id" + ++n;
  store = localStore({ storage: memStorage(), newId: ids });
});
const all = (c) => { let v; store.sub(c, {}, (x) => (v = x))(); return v; };

describe("localStore", () => {
  it("inc บวกเพิ่มจากค่าปัจจุบัน", async () => {
    await store.set("items/a", { qty: 5 });
    await store.update("items/a", { qty: store.inc(2.5) });
    expect(all("items")[0].qty).toBe(7.5);
  });
  it("push ต่อท้ายอาร์เรย์ ไม่ทับของเดิม", async () => {
    await store.set("docs/d", { payments: [{ amount: 100 }] });
    await store.update("docs/d", { payments: store.push({ amount: 50 }) });
    expect(all("docs")[0].payments).toEqual([{ amount: 100 }, { amount: 50 }]);
  });
  it("run: ถ้า throw กลางทาง ไม่มีอะไรถูกเขียน", async () => {
    await store.set("items/a", { qty: 5 });
    await expect(store.run(async (tx) => {
      tx.update("items/a", { qty: 1 });
      tx.set("docs/x", { no: "RC1" });
      throw new Error("ของไม่พอ");
    })).rejects.toThrow("ของไม่พอ");
    expect(all("items")[0].qty).toBe(5);
    expect(all("docs")).toEqual([]);
  });
  it("run: เขียนทั้งหมดเมื่อสำเร็จ และ get เห็นค่าล่าสุด", async () => {
    await store.set("items/a", { qty: 5 });
    await store.run(async (tx) => {
      const it = await tx.get("items/a");
      tx.update("items/a", { qty: it.qty - 2 });
      tx.set("moves/m", { qty: 2 });
    });
    expect(all("items")[0].qty).toBe(3);
    expect(all("moves")).toHaveLength(1);
  });
  it("run: update สินค้าที่ไม่มีอยู่ → ล้มทั้งชุด", async () => {
    await expect(store.run(async (tx) => { tx.set("docs/x", {}); tx.update("items/zzz", { qty: 1 }); })).rejects.toThrow();
    expect(all("docs")).toEqual([]);
  });
  it("costIn คำนวณทุนเฉลี่ยลง items (โหมดทดลอง)", async () => {
    await store.set("items/a", { qty: 10, cost: 300 });
    await store.costIn("a", { oq: 10, a: 10, c: 330, at: 1 });
    expect(all("items")[0].cost).toBe(315);
  });
  it("audit ใส่ผู้บันทึกตอน set และใน run", async () => {
    const s = localStore({ storage: memStorage(), audit: (p, v) => ({ ...v, by: "สมชาย" }) });
    await s.set("docs/a", { no: 1 });
    await s.run(async (tx) => tx.set("docs/b", { no: 2 }));
    let v; s.sub("docs", {}, (x) => (v = x));
    expect(v.map((d) => d.by)).toEqual(["สมชาย", "สมชาย"]);
  });
  it("sub คืนฟังก์ชันยกเลิก", async () => {
    let calls = 0; const un = store.sub("items", {}, () => calls++);
    un(); await store.set("items/a", { qty: 1 });
    expect(calls).toBe(1);
  });
});
