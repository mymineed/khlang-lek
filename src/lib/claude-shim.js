import { getDb, getAuth, getStorage } from "./firebase.js";
import { getAuthState } from "./auth.js";

// In-memory or localStorage cache for local assets fallback
const localAssetCache = new Map();

export function assetUrl(id) {
  if (!id) return "";
  if (id.startsWith("http://") || id.startsWith("https://") || id.startsWith("data:") || id.startsWith("blob:")) {
    return id;
  }
  if (localAssetCache.has(id)) {
    return localAssetCache.get(id);
  }
  return id;
}

window.assetUrl = assetUrl;

const downloadsShim = {
  async save({ filename, data }) {
    try {
      let blob;
      if (typeof data === "string") {
        blob = new Blob([data], { type: "text/html;charset=utf-8" });
      } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      } else {
        blob = new Blob([data]);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return true;
    } catch (err) {
      console.error("Download failed:", err);
      throw { code: "declined", message: "Download failed" };
    }
  }
};

const userShim = {
  isOwner: () => getAuthState().profile?.role === "owner" && getAuthState().profile?.status === "approved",
  id: () => {
    const auth = getAuth();
    return auth?.currentUser?.uid || "owner-1";
  },
  profiles: async (ids) => {
    const auth = getAuth();
    const currentName = auth?.currentUser?.displayName || "เจ้าของร้าน";
    const result = {};
    if (Array.isArray(ids)) {
      ids.forEach(id => {
        result[id] = { name: currentName };
      });
    }
    return result;
  }
};

const assetsShim = {
  async upload(blob, { type = "image/jpeg" } = {}) {
    const storage = getStorage();
    const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    if (storage) {
      try {
        const fileRef = storage.ref(`receipts/${randomId}.jpg`);
        const snapshot = await fileRef.put(blob, { contentType: type });
        const downloadUrl = await snapshot.ref.getDownloadURL();
        localAssetCache.set(randomId, downloadUrl);
        return { id: downloadUrl };
      } catch (err) {
        console.warn("Storage upload failed, using local blob fallback:", err);
      }
    }

    // Local fallback: convert blob to data URL
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        localAssetCache.set(randomId, dataUrl);
        resolve({ id: dataUrl });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
};


// อ่านรูปบิลผ่าน /api/read-doc (Vercel function ใช้ API key ของร้าน) — ต้องล็อกอินก่อน
const MAX_BODY_BYTES = 3_500_000; // Vercel รับ body ได้ราว 4.5MB เผื่อไว้

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function reencode(blob, maxDim, quality) {
  const bmp = await createImageBitmap(blob);
  const r = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", quality));
}

async function encodeImages(blobs) {
  const steps = [null, [1400, 0.75], [1100, 0.7], [900, 0.65]];
  for (const step of steps) {
    const list = step ? await Promise.all(blobs.map(b => reencode(b, step[0], step[1]))) : blobs;
    const images = await Promise.all(list.map(async b => ({
      media_type: step ? "image/jpeg" : (b.type || "image/jpeg"),
      data: await blobToBase64(b),
    })));
    if (images.reduce((n, i) => n + i.data.length, 0) <= MAX_BODY_BYTES) return images;
  }
  throw { code: "image_rejected", message: "Images too large" };
}

const sampleShim = {
  async limits() { return null; },
  async json(prompt, { images = [] } = {}) {
    const user = getAuth()?.currentUser;
    if (!user) throw { code: "not_granted", message: "Not signed in" };
    if (!images.length) throw { code: "image_rejected", message: "No images" };
    const body = JSON.stringify({ prompt, images: await encodeImages(images) });
    let resp;
    try {
      resp = await fetch("/api/read-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body,
      });
    } catch (err) {
      throw { code: "network_error", message: String(err) };
    }
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const code = out.code === "not_configured" ? "unavailable" : (out.code || "upstream_error");
      throw { code, message: `read-doc ${resp.status}` };
    }
    return out.data;
  }
};

window.claude = {
  async use(name) {
    if (name === "db") {
      const db = getDb();
      if (!db) {
        throw new Error("Firebase is not configured yet. Falling back to localStore.");
      }
      return db;
    }
    if (name === "user") {
      return userShim;
    }
    if (name === "downloads") {
      return downloadsShim;
    }
    if (name === "assets") {
      return assetsShim;
    }
    if (name === "sample") {
      if (window._sampleShim) return window._sampleShim;
      if (getAuth()) return sampleShim;
      throw new Error("sample capability needs Firebase Auth");
    }
    throw new Error("unknown capability: " + name);
  }
};
