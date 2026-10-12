// isApproved เรียก Firestore REST จริงบน emulator ภายใต้ rules จริง (npm run test:rules)
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { isApproved } from "../../src/lib/approval.js";

const projectId = "demo-khlang-lek-approval";
const baseUrl = "http://127.0.0.1:8080";
// emulator รับ JWT ที่ไม่ได้เซ็น
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokenFor = (uid) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: uid, user_id: uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: "password" } })}.`;
};

let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("users/ok").set({ uid: "ok", role: "staff", status: "approved" });
    await db.doc("users/wait").set({ uid: "wait", role: "staff", status: "pending" });
    await db.doc("users/off").set({ uid: "off", role: "staff", status: "disabled" });
  });
});
afterAll(() => env?.cleanup());

describe("isApproved ผ่าน Firestore REST + rules", () => {
  it("อนุมัติแล้ว = ผ่าน", async () => {
    expect(await isApproved({ projectId, uid: "ok", token: tokenFor("ok"), baseUrl })).toBe(true);
  });
  it("pending / disabled / ไม่มีโปรไฟล์ = ไม่ผ่าน", async () => {
    for (const uid of ["wait", "off", "nobody"]) expect(await isApproved({ projectId, uid, token: tokenFor(uid), baseUrl })).toBe(false);
  });
  it("ใช้ token ของคนอื่นอ่านโปรไฟล์ที่อนุมัติแล้วไม่ได้", async () => {
    expect(await isApproved({ projectId, uid: "ok", token: tokenFor("wait"), baseUrl })).toBe(false);
  });
});
