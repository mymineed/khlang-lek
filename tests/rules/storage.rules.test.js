// รันด้วย `npm run test:rules` (Storage + Firestore emulator)
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";

let env;
const img = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-khlang-lek",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
});
afterAll(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("users/staff").set({ uid: "staff", role: "staff", status: "approved" });
    await ctx.firestore().doc("users/pending").set({ uid: "pending", role: "staff", status: "pending" });
    await ctx.storage().ref("receipts/old.jpg").put(img, { contentType: "image/jpeg" });
  });
});

const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();

describe("storage receipts/", () => {
  it("ไม่ล็อกอิน: อัปโหลด/อ่านไม่ได้", async () => {
    await assertFails(st(null).ref("receipts/a.jpg").put(img, { contentType: "image/jpeg" }));
    await assertFails(st(null).ref("receipts/old.jpg").getMetadata());
  });
  it("pending: อัปโหลดไม่ได้", async () => {
    await assertFails(st("pending").ref("receipts/a.jpg").put(img, { contentType: "image/jpeg" }));
  });
  it("approved: อัปโหลดรูปและอ่านได้", async () => {
    await assertSucceeds(st("staff").ref("receipts/a.jpg").put(img, { contentType: "image/jpeg" }));
    await assertSucceeds(st("staff").ref("receipts/old.jpg").getMetadata());
  });
  it("approved: ไฟล์ที่ไม่ใช่รูป / นอก receipts/ ไม่ได้", async () => {
    await assertFails(st("staff").ref("receipts/a.html").put(img, { contentType: "text/html" }));
    await assertFails(st("staff").ref("other/a.jpg").put(img, { contentType: "image/jpeg" }));
  });
  it("ลบไฟล์ไม่ได้", async () => {
    await assertFails(st("staff").ref("receipts/old.jpg").delete());
  });
});
