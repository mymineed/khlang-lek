import { describe, it, expect } from "vitest";
import { extractJson } from "../src/lib/json.js";

describe("extractJson", () => {
  it("JSON ล้วน", () => {
    expect(extractJson('{"seller":"ร้าน A","lines":[]}')).toEqual({ seller: "ร้าน A", lines: [] });
  });
  it("มี ```json ครอบ และมีข้อความนำหน้า", () => {
    expect(extractJson('นี่คือผล:\n```json\n{"total":1200}\n```')).toEqual({ total: 1200 });
  });
  it("ไม่ใช่ JSON / พัง / เป็น array = null", () => {
    expect(extractJson("อ่านไม่ได้")).toBeNull();
    expect(extractJson('{"a":')).toBeNull();
    expect(extractJson("[1,2]")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});
