// ดึง JSON object ออกจากข้อความที่โมเดลตอบ (เผื่อมี ```json ครอบ หรือมีข้อความนำหน้า)
export function extractJson(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
