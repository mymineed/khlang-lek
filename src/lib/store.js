// ชั้น storage: store มี sub/set/update/del + run (transaction) + inc/push (เขียนแบบไม่ทับกัน)
// path รูปแบบ "collection/id"
import { applyCostEntry, applyPending, mergeItemCosts } from "./item-costs.js";
import { nextSeq } from "./docno.js";

const KEY = "steel-stock-demo";
const COLS = ["items", "moves", "buys", "docs", "cash", "settings", "closes", "counts", "prices", "orders", "customers"];
const split = (p) => p.split("/");
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------- local demo (localStorage) ---------- */
export function localStore({ storage = globalThis.localStorage, audit = (p, v) => v, newId = () => Math.random().toString(36).slice(2) } = {}) {
  let data = Object.fromEntries(COLS.map((c) => [c, {}]));
  try {
    const raw = storage && storage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.moves)) { const m = {}; d.moves.forEach((x) => (m[x.id || newId()] = x)); d.moves = m; }
      data = { ...data, ...d };
    }
  } catch (e) {}
  const subs = [];
  const list = (c, o) => {
    let a = Object.entries(data[c] || {}).map(([id, v]) => ({ id, ...v }));
    if (o.order) a.sort((x, y) => (y[o.order] || 0) - (x[o.order] || 0));
    if (o.limit) a = a.slice(0, o.limit);
    return a;
  };
  const save = () => { try { storage && storage.setItem(KEY, JSON.stringify(data)); } catch (e) {} subs.forEach((s) => s.cb(list(s.c, s.o))); };
  const fields = (cur, v) => {
    const o = { ...cur };
    for (const [k, x] of Object.entries(v)) {
      if (x && x.__op === "inc") o[k] = (+o[k] || 0) + x.n;
      else if (x && x.__op === "push") o[k] = [...(Array.isArray(o[k]) ? o[k] : []), ...x.v];
      else o[k] = x;
    }
    return o;
  };
  const write = (op, p, v) => {
    const [c, id] = split(p); const col = (data[c] = data[c] || {});
    if (op === "set") col[id] = fields({}, v);
    else if (op === "update") { if (!col[id]) throw new Error("not-found: " + p); col[id] = fields(col[id], v); }
    else delete col[id];
  };
  return {
    mode: "local",
    sub(c, o, cb) { const s = { c, o, cb }; subs.push(s); cb(list(c, o)); return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); }; },
    async set(p, v) { write("set", p, audit(p, v)); save(); },
    async update(p, v) { write("update", p, v); save(); },
    async del(p) { write("del", p); save(); },
    inc: (n) => ({ __op: "inc", n }),
    push: (v) => ({ __op: "push", v: [v] }),
    // เขียนทั้งหมดหลัง fn สำเร็จเท่านั้น ถ้า fn throw จะไม่มีอะไรถูกเขียน
    async run(fn) {
      const q = [];
      const r = await fn({
        get: async (p) => { const [c, id] = split(p); const x = data[c] && data[c][id]; return x ? { id, ...clone(x) } : null; },
        set: (p, v) => q.push(["set", p, audit(p, v)]),
        update: (p, v) => q.push(["update", p, v]),
      });
      const backup = clone(data);
      try { q.forEach((w) => write(...w)); } catch (e) { data = backup; throw e; }
      save();
      return r;
    },
    // โหมดทดลองเก็บทุนไว้ใน items เหมือนเดิม
    async costIn(id, e) { const it = data.items && data.items[id]; if (!it) return; it.cost = applyCostEntry(it.cost, e); save(); },
    async nextSeq(key, floor) { return nextSeq(0, floor); },
  };
}

/* ---------- Firestore ---------- */
export function dbStore(db, { FieldValue, onErr = () => {}, audit = (p, v) => v, isOwner = () => false, warn = console.warn } = {}) {
  const snap = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const query = (c, o) => { let q = db.collection(c); if (o.order) q = q.orderBy(o.order, "desc"); if (o.limit) q = q.limit(o.limit); return q; };
  const costRef = (id) => db.doc("itemCosts/" + id);
  const itemIdOf = (p) => (/^items\/[^/]+$/.test(p) ? p.slice(6) : null);

  // ทุนไม่ถูกเขียนลง items อีกต่อไป: เจ้าของเขียนไป itemCosts, ลูกน้องเขียนไม่ได้ (ใช้ costIn ตอนซื้อเข้า)
  function writeItem(op, p, v) {
    const id = itemIdOf(p);
    if (!id || !("cost" in v)) return op === "set" ? db.doc(p).set(v) : db.doc(p).update(v);
    const { cost, ...rest } = v;
    const b = db.batch();
    // ลูกน้อง: merge เพื่อไม่ลบ items.cost เดิมที่เจ้าของยังไม่ได้ย้ายไป itemCosts
    if (op === "set") b.set(db.doc(p), rest, isOwner() ? undefined : { merge: true }); else b.update(db.doc(p), rest);
    if (isOwner()) b.set(costRef(id), { cost: +cost || 0, pending: [] }, { merge: true });
    return b.commit();
  }

  // เจ้าของ: ย้าย items.cost เดิมไป itemCosts และคำนวณ pending จากลูกน้อง
  const busy = new Set();
  async function migrate(id) {
    await db.runTransaction(async (t) => {
      const [is, cs] = [await t.get(db.doc("items/" + id)), await t.get(costRef(id))];
      if (!is.exists || !("cost" in is.data())) return;
      const cd = cs.exists ? cs.data() : null;
      if (!cd || !("cost" in cd)) t.set(costRef(id), { cost: +is.data().cost || 0 }, { merge: true });
      t.update(db.doc("items/" + id), { cost: FieldValue.delete() });
    });
  }
  async function settle(id) {
    await db.runTransaction(async (t) => {
      const [cs, is] = [await t.get(costRef(id)), await t.get(db.doc("items/" + id))];
      const cd = cs.exists ? cs.data() : null;
      if (!cd || !Array.isArray(cd.pending) || !cd.pending.length) return;
      const base = "cost" in cd ? cd.cost : is.exists ? is.data().cost : 0;
      t.set(costRef(id), { cost: applyPending(base, cd.pending), pending: [] }, { merge: true });
    });
  }
  function maintain(raw, costs) {
    const job = (id, f) => { if (busy.has(id)) return; busy.add(id); f(id).catch((e) => warn("itemCosts:", e)).finally(() => busy.delete(id)); };
    raw.forEach((it) => { if ("cost" in it) job(it.id, migrate); });
    Object.entries(costs).forEach(([id, c]) => { if (Array.isArray(c.pending) && c.pending.length) job(id, settle); });
  }

  const txOps = (t) => ({
    get: async (p) => { const s = await t.get(db.doc(p)); return s.exists ? { id: s.id, ...s.data() } : null; },
    set: (p, v) => { t.set(db.doc(p), audit(p, v)); },
    update: (p, v) => { t.update(db.doc(p), v); },
  });

  return {
    mode: "db",
    sub(c, o, cb) {
      if (c === "items" && isOwner()) {
        let raw = null, costs = null;
        const emit = () => { if (raw && costs) { cb(mergeItemCosts(raw, costs)); maintain(raw, costs); } };
        const u1 = query(c, o).onSnapshot((s) => { raw = snap(s); emit(); }, onErr);
        const u2 = db.collection("itemCosts").onSnapshot((s) => { costs = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); emit(); }, onErr);
        return () => { u1(); u2(); };
      }
      return query(c, o).onSnapshot((s) => cb(snap(s)), onErr);
    },
    set: (p, v) => (itemIdOf(p) ? writeItem("set", p, v) : db.doc(p).set(audit(p, v))),
    update: (p, v) => (itemIdOf(p) ? writeItem("update", p, v) : db.doc(p).update(v)),
    del: (p) => {
      const id = itemIdOf(p);
      if (!id || !isOwner()) return db.doc(p).delete();
      const b = db.batch(); b.delete(db.doc(p)); b.delete(costRef(id)); return b.commit();
    },
    inc: (n) => FieldValue.increment(n),
    push: (v) => FieldValue.arrayUnion(v),
    // อ่านค่าล่าสุดจากเซิร์ฟเวอร์แล้วเขียนทั้งหมดพร้อมกัน (สำเร็จทั้งหมดหรือไม่เขียนเลย)
    // ออฟไลน์: ใช้ค่าจากแคชแล้วเขียนเป็น batch (ยังเขียนพร้อมกันทั้งหมด)
    async run(fn) {
      try {
        return await db.runTransaction((t) => fn(txOps(t)));
      } catch (e) {
        if (!e || e.code !== "unavailable") throw e;
        const b = db.batch();
        const r = await fn({
          get: async (p) => { try { const s = await db.doc(p).get({ source: "cache" }); return s.exists ? { id: s.id, ...s.data() } : null; } catch (x) { return null; } },
          set: (p, v) => { b.set(db.doc(p), audit(p, v)); },
          update: (p, v) => { b.update(db.doc(p), v); },
        });
        await b.commit();
        return r;
      }
    },
    costIn: (id, e) => costRef(id).set({ pending: FieldValue.arrayUnion({ ...e, r: Math.random().toString(36).slice(2, 8) }) }, { merge: true }),
    // จองเลขเอกสารแบบ transaction กันเลขซ้ำเมื่อหลายเครื่องออกบิลพร้อมกัน
    nextSeq: (key, floor) => db.runTransaction(async (t) => {
      const ref = db.doc("counters/" + key), s = await t.get(ref);
      const n = nextSeq(s.exists ? s.data().last : 0, floor);
      t.set(ref, { last: n, at: Date.now() });
      return n;
    }),
  };
}
