// ตรวจว่าผู้ใช้ได้รับอนุมัติจากเจ้าของร้านแล้ว (users/{uid}.status == "approved")
// อ่านผ่าน Firestore REST ด้วย ID token ของผู้ใช้เอง (rules อนุญาตให้อ่านโปรไฟล์ตัวเอง) ไม่ต้องใช้ service account

export function statusOf(doc) {
  return doc && doc.fields && doc.fields.status && doc.fields.status.stringValue;
}

export async function isApproved({ projectId, uid, token, baseUrl = "https://firestore.googleapis.com", fetchImpl = fetch }) {
  if (!projectId || !uid || !token) return false;
  const url = `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  try {
    const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return false;
    return statusOf(await resp.json()) === "approved";
  } catch {
    return false;
  }
}
