import { describe, it, expect } from "vitest";
import { isApproved, statusOf } from "../src/lib/approval.js";

const fakeFetch = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const doc = (s) => ({ fields: { status: { stringValue: s } } });
const base = { projectId: "p", uid: "u1", token: "t" };

describe("isApproved (กันคนที่ยังไม่อนุมัติยิง api/read-doc)", () => {
  it("approved = ผ่าน", async () => {
    expect(await isApproved({ ...base, fetchImpl: fakeFetch(200, doc("approved")) })).toBe(true);
  });
  it("pending / disabled = ไม่ผ่าน", async () => {
    expect(await isApproved({ ...base, fetchImpl: fakeFetch(200, doc("pending")) })).toBe(false);
    expect(await isApproved({ ...base, fetchImpl: fakeFetch(200, doc("disabled")) })).toBe(false);
  });
  it("ไม่มีโปรไฟล์ (404) / rules ไม่ให้อ่าน (403) = ไม่ผ่าน", async () => {
    expect(await isApproved({ ...base, fetchImpl: fakeFetch(404, {}) })).toBe(false);
    expect(await isApproved({ ...base, fetchImpl: fakeFetch(403, {}) })).toBe(false);
  });
  it("เครือข่ายล้ม = ไม่ผ่าน", async () => {
    expect(await isApproved({ ...base, fetchImpl: async () => { throw new Error("down"); } })).toBe(false);
  });
  it("ข้อมูลไม่ครบ = ไม่ผ่าน โดยไม่เรียก fetch", async () => {
    let called = false; const f = async () => { called = true; };
    expect(await isApproved({ projectId: "p", uid: "", token: "t", fetchImpl: f })).toBe(false);
    expect(called).toBe(false);
  });
  it("อ่านโปรไฟล์ของ uid นั้นด้วย token ของผู้ใช้เอง", async () => {
    let seen;
    await isApproved({ ...base, fetchImpl: async (url, opt) => { seen = { url, auth: opt.headers.Authorization }; return { ok: true, json: async () => doc("approved") }; } });
    expect(seen.url).toBe("https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/users/u1");
    expect(seen.auth).toBe("Bearer t");
  });
  it("statusOf กับข้อมูลแปลกๆ", () => {
    expect(statusOf(null)).toBeFalsy();
    expect(statusOf({ fields: {} })).toBeFalsy();
  });
});
