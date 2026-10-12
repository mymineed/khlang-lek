import { describe, it, expect } from "vitest";
import { applyCostEntry, applyPending, costOf, mergeItemCosts, lineCost } from "../src/lib/item-costs.js";

describe("applyCostEntry (ทุนเฉลี่ยถ่วงน้ำหนัก แบบเดียวกับตอนซื้อเข้าเดิม)", () => {
  it("มีของเดิมและทุนเดิม → เฉลี่ยถ่วงน้ำหนัก", () => {
    // 10 เส้น ทุน 300 + ซื้อเพิ่ม 10 เส้น ทุน 330 → 315
    expect(applyCostEntry(300, { oq: 10, a: 10, c: 330 })).toBe(315);
  });
  it("ไม่มีของเดิม → ใช้ทุนล็อตใหม่", () => {
    expect(applyCostEntry(300, { oq: 0, a: 5, c: 330 })).toBe(330);
  });
  it("ไม่มีทุนเดิม → ใช้ทุนล็อตใหม่", () => {
    expect(applyCostEntry(0, { oq: 10, a: 5, c: 330 })).toBe(330);
  });
  it("ปัดเศษ 2 ตำแหน่ง", () => {
    expect(applyCostEntry(100, { oq: 1, a: 2, c: 50 })).toBe(66.67);
    expect(applyCostEntry(0, { oq: 0, a: 3, c: 100 / 3 })).toBe(33.33);
  });
});

describe("applyPending", () => {
  it("ใช้รายการตามลำดับเวลา ไม่ใช่ลำดับในอาร์เรย์", () => {
    const pending = [
      { oq: 20, a: 10, c: 360, at: 2 }, // ทีหลัง
      { oq: 10, a: 10, c: 330, at: 1 }, // ก่อน
    ];
    // 300 → (10*300+10*330)/20 = 315 → (20*315+10*360)/30 = 330
    expect(applyPending(300, pending)).toBe(330);
  });
  it("ไม่มี pending = ทุนเดิม", () => {
    expect(applyPending(250, undefined)).toBe(250);
    expect(applyPending(undefined, [])).toBe(0);
  });
});

describe("costOf / mergeItemCosts", () => {
  it("itemCosts มาก่อน items.cost เดิม", () => {
    expect(costOf({ cost: 100 }, { cost: 120 })).toBe(120);
  });
  it("ยังไม่ย้าย ใช้ items.cost เดิม + pending", () => {
    expect(costOf({ cost: 100 }, { pending: [{ oq: 1, a: 1, c: 200, at: 1 }] })).toBe(150);
  });
  it("ไม่มีข้อมูลทุนเลย = 0", () => {
    expect(costOf({}, undefined)).toBe(0);
  });
  it("merge ใส่ cost ให้ทุกรายการ", () => {
    const out = mergeItemCosts([{ id: "a", qty: 1 }, { id: "b", qty: 2, cost: 5 }], { a: { cost: 9 } });
    expect(out).toEqual([{ id: "a", qty: 1, cost: 9 }, { id: "b", qty: 2, cost: 5 }]);
  });
});

describe("lineCost (ต้นทุนบรรทัดขายในรายงานกำไร)", () => {
  const item = { id: "a", cost: 300 };
  it("มีทุนในบิลแล้ว ใช้ทุนในบิล", () => {
    expect(lineCost({ cost: 280, costLater: true }, item)).toBe(280);
  });
  it("บิลที่ลูกน้องออก (costLater) ใช้ทุนปัจจุบันของสินค้า", () => {
    expect(lineCost({ cost: 0, costLater: true }, item)).toBe(300);
  });
  it("บรรทัดตัดเหล็กของลูกน้อง ใช้สัดส่วนที่ตัด", () => {
    expect(lineCost({ cost: 0, costLater: true, cut: { ratio: 0.25 } }, item)).toBe(75);
  });
  it("บิลเก่าที่ไม่มีทุนและไม่ได้ทำเครื่องหมาย = 0 (เหมือนเดิม)", () => {
    expect(lineCost({ cost: 0 }, item)).toBe(0);
  });
  it("ไม่พบสินค้า = 0", () => {
    expect(lineCost({ cost: 0, costLater: true }, undefined)).toBe(0);
  });
});
