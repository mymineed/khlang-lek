// Vercel serverless function: อ่านรูปบิล/เอกสารด้วย Claude แล้วตอบเป็น JSON
// ใช้ API key ของร้าน (ANTHROPIC_API_KEY ใน Vercel env) — key อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น
import Anthropic from "@anthropic-ai/sdk";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { extractJson } from "../src/lib/json.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const MAX_IMAGES = 6;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const firebaseJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

// ต้องล็อกอิน Firebase ของร้านนี้เท่านั้น กันคนนอกยิง API ใช้เครดิตร้าน
async function verifyUser(req) {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!projectId || !token) return null;
  try {
    const { payload } = await jwtVerify(token, firebaseJwks, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    return payload.sub ? payload : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "method_not_allowed" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ code: "not_configured" });
  if (!(await verifyUser(req))) return res.status(401).json({ code: "not_granted" });

  const { prompt, images } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 60000)
    return res.status(400).json({ code: "bad_request" });
  if (!Array.isArray(images) || !images.length || images.length > MAX_IMAGES
      || images.some(i => !IMAGE_TYPES.has(i?.media_type) || typeof i?.data !== "string"))
    return res.status(400).json({ code: "image_rejected" });

  const client = new Anthropic();
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      messages: [{
        role: "user",
        content: [
          ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
          { type: "text", text: prompt },
        ],
      }],
    });
    if (msg.stop_reason === "refusal") return res.status(422).json({ code: "refused" });
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    const data = extractJson(text);
    if (!data) return res.status(502).json({ code: "bad_output" });
    return res.status(200).json({ data });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ code: "rate_limited" });
    if (err instanceof Anthropic.BadRequestError) return res.status(400).json({ code: "image_rejected" });
    if (err instanceof Anthropic.AuthenticationError) return res.status(503).json({ code: "not_configured" });
    console.error("read-doc failed:", err);
    return res.status(502).json({ code: "upstream_error" });
  }
}
