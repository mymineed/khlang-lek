import { describe, it, expect } from "vitest";
import { docPrefix, maxDocSeq, nextSeq, formatDocNo } from "../src/lib/docno.js";

describe("docPrefix", () => {
  it("แยกตามประเภทและปีเดือน", () => {
    expect(docPrefix("receipt", "2026-10-12")).toBe("RC2610");
    expect(docPrefix("quote", "2026-01-31")).toBe("QT2601");
    expect(docPrefix("credit", "2026-12-01")).toBe("DN2612");
  });
  it("ประเภทไม่รู้จัก = RC", () => {
    expect(docPrefix("xxx", "2026-10-12")).toBe("RC2610");
  });
});

describe("maxDocSeq", () => {
  const docs = [{ no: "RC2610-001" }, { no: "RC2610-012" }, { no: "RC2609-099" }, { no: "QT2610-050" }, { no: undefined }];
  it("หาเลขสูงสุดของ prefix เดียวกันเท่านั้น", () => {
    expect(maxDocSeq(docs, "RC2610")).toBe(12);
    expect(maxDocSeq(docs, "QT2610")).toBe(50);
  });
  it("ไม่มีเอกสาร = 0", () => {
    expect(maxDocSeq([], "RC2610")).toBe(0);
  });
});

describe("nextSeq", () => {
  it("ตัวนับนำหน้า ใช้ตัวนับ", () => expect(nextSeq(20, 12)).toBe(21));
  it("เอกสารเก่าเลขสูงกว่าตัวนับ (ก่อนมีตัวนับ) ใช้เลขเอกสาร", () => expect(nextSeq(0, 12)).toBe(13));
  it("ยังไม่มีอะไรเลย = 1", () => expect(nextSeq(undefined, 0)).toBe(1));
});

describe("formatDocNo", () => {
  it("เติม 0 ให้ครบ 3 หลัก", () => expect(formatDocNo("RC2610", 7)).toBe("RC2610-007"));
  it("เกิน 999 ไม่ตัดทิ้ง", () => expect(formatDocNo("RC2610", 1234)).toBe("RC2610-1234"));
});
