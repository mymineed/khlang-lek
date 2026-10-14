import { describe, it, expect } from "vitest";
import { buildPlan, monthlyDates, startOfDay } from "../src/lib/cashplan.js";

const d = (y, m, day, h = 12) => new Date(y, m - 1, day, h).getTime();
const NOW = d(2026, 10, 14, 9); // พุธ 14 ต.ค. 2026 09:00

describe("monthlyDates (รายการประจำเดือน)", () => {
  it("ได้วันที่ในช่วง รวมวันนี้", () => {
    const from = startOfDay(NOW), to = from + 56 * 864e5;
    expect(monthlyDates(14, from, to).map((t) => new Date(t).getDate())).toEqual([14, 14]);
  });
  it("วันที่ผ่านไปแล้วในเดือนนี้ ไม่นับ เริ่มเดือนหน้า", () => {
    const from = startOfDay(NOW), to = from + 30 * 864e5;
    expect(monthlyDates(5, from, to).map((t) => [new Date(t).getMonth() + 1, new Date(t).getDate()])).toEqual([[11, 5]]);
  });
  it("วันที่ 31 ในเดือนที่มี 30 วัน → วันสุดท้ายของเดือน", () => {
    const from = d(2026, 11, 1, 0), to = d(2026, 12, 1, 0);
    expect(monthlyDates(31, from, to).map((t) => new Date(t).getDate())).toEqual([30]);
  });
  it("กุมภาพันธ์", () => {
    const from = d(2027, 2, 1, 0), to = d(2027, 3, 1, 0);
    expect(monthlyDates(30, from, to).map((t) => new Date(t).getDate())).toEqual([28]);
  });
});

describe("buildPlan", () => {
  it("ไม่มีอะไรเลย = ยอดตั้งต้นทุกสัปดาห์", () => {
    const p = buildPlan({ now: NOW, opening: 5000 });
    expect(p.weeks).toHaveLength(8);
    expect(p.weeks.every((w) => w.balance === 5000)).toBe(true);
    expect(p.final).toBe(5000);
  });
  it("ลูกหนี้นับตามวันครบกำหนด ยอดสะสมถูก", () => {
    const p = buildPlan({ now: NOW, opening: 1000, receivables: [{ amt: 300, due: d(2026, 10, 15) }, { amt: 200, due: d(2026, 10, 22) }] });
    expect(p.weeks[0].in).toBe(300);
    expect(p.weeks[1].in).toBe(200);
    expect(p.weeks[1].balance).toBe(1500);
  });
  it("ลูกหนี้เกินกำหนด แยกไว้ ไม่นับรวมในยอด", () => {
    const p = buildPlan({ now: NOW, opening: 0, receivables: [{ amt: 900, due: d(2026, 10, 1), title: "ช่างเอ" }] });
    expect(p.overdueIn.total).toBe(900);
    expect(p.overdueIn.items[0].title).toBe("ช่างเอ");
    expect(p.final).toBe(0);
  });
  it("ลูกหนี้ครบกำหนดวันนี้ ยังนับ (ไม่ถือว่าเกิน)", () => {
    const p = buildPlan({ now: NOW, receivables: [{ amt: 100, due: d(2026, 10, 14, 0) }] });
    expect(p.weeks[0].in).toBe(100);
    expect(p.overdueIn.total).toBe(0);
  });
  it("เจ้าหนี้เกินกำหนด นับในสัปดาห์แรก", () => {
    const p = buildPlan({ now: NOW, opening: 1000, payables: [{ amt: 400, due: d(2026, 9, 30) }, { amt: 100, due: d(2026, 11, 1) }] });
    expect(p.weeks[0].out).toBe(400);
    expect(p.weeks[0].items[0].kind).toBe("pay-overdue");
    expect(p.weeks[2].out).toBe(100);
    expect(p.final).toBe(500);
  });
  it("รายการประจำ + ครั้งเดียว และหาสัปดาห์ที่เงินต่ำสุด", () => {
    const p = buildPlan({
      now: NOW, opening: 10000,
      recurring: [{ name: "ค่าแรง", amount: 6000, day: 25, dir: "out" }],
      oneoff: [{ name: "ซื้อเหล็กล็อตใหญ่", amount: 8000, date: d(2026, 10, 20), dir: "out" }, { name: "เก่า", amount: 999, date: d(2026, 10, 1), dir: "out" }],
    });
    // 20 ต.ค. (สัปดาห์ 0) -8000 → 2000, 25 ต.ค. (สัปดาห์ 1) -6000 → -4000, 25 พ.ย. (สัปดาห์ 6) -6000 → -10000
    expect(p.weeks[0].balance).toBe(2000);
    expect(p.weeks[1].balance).toBe(-4000);
    expect(p.weeks[6].out).toBe(6000);
    expect(p.lowest).toEqual({ balance: -10000, week: 6 });
    expect(p.weeks.flatMap((w) => w.items).some((i) => i.title === "เก่า")).toBe(false);
  });
  it("รายการเกิน 8 สัปดาห์ไม่นับ", () => {
    const p = buildPlan({ now: NOW, receivables: [{ amt: 500, due: d(2027, 1, 30) }] });
    expect(p.final).toBe(0);
  });
  it("ปัดเศษ 2 ตำแหน่ง ไม่มีเศษทศนิยมสะสม", () => {
    const p = buildPlan({ now: NOW, opening: 0.1, receivables: [{ amt: 0.2, due: d(2026, 10, 15) }] });
    expect(p.final).toBe(0.3);
  });
  it("จำนวนเงิน 0 หรือติดลบ ไม่นับ", () => {
    const p = buildPlan({ now: NOW, oneoff: [{ name: "x", amount: -5, date: d(2026, 10, 16), dir: "in" }, { name: "y", amount: 0, date: d(2026, 10, 16), dir: "out" }] });
    expect(p.weeks[0].items).toHaveLength(0);
  });
});
