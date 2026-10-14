// แผนเงินสด: คาดการณ์เงินเข้า-ออกล่วงหน้าเป็นรายสัปดาห์
// - ลูกหนี้ (ขายเชื่อค้างรับ) นับตามวันครบกำหนด; ที่เกินกำหนดแล้วแยกเป็น "ยังไม่แน่นอน" ไม่นับรวมในยอด
// - เจ้าหนี้ (ซื้อเชื่อค้างจ่าย) นับตามวันครบกำหนด; ที่เกินกำหนดแล้วนับในสัปดาห์แรก (ต้องจ่าย)
// - รายการประจำเดือน (วันที่ของเดือน) และรายการครั้งเดียว ที่เจ้าของตั้งเอง

const DAY = 864e5;
const round2 = (n) => Math.round(n * 100) / 100;

export const startOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

// วันที่ของรายการประจำเดือนในช่วง [from, to) ถ้าวันที่เกินจำนวนวันของเดือน ใช้วันสุดท้ายของเดือน
export function monthlyDates(day, from, to) {
  const out = [], dd = Math.min(31, Math.max(1, Math.floor(+day) || 1));
  const f = new Date(from);
  for (let y = f.getFullYear(), m = f.getMonth(); ; m++) {
    const last = new Date(y, m + 1, 0).getDate();
    const t = new Date(y, m, Math.min(dd, last)).getTime();
    if (t >= to) break;
    if (t >= from) out.push(t);
  }
  return out;
}

// receivables / payables: [{ amt, due, title }]
// recurring: [{ name, amount, day, dir: "in"|"out" }], oneoff: [{ name, amount, date, dir }]
export function buildPlan({ now = Date.now(), opening = 0, weeks = 8, receivables = [], payables = [], recurring = [], oneoff = [] }) {
  const start = startOfDay(now), end = start + weeks * 7 * DAY;
  const W = Array.from({ length: weeks }, (_, i) => ({ start: start + i * 7 * DAY, end: start + (i + 1) * 7 * DAY, in: 0, out: 0, items: [] }));
  const put = (t, dir, amt, title, kind) => {
    const a = round2(+amt || 0); if (!(a > 0) || t >= end) return;
    const w = W[Math.max(0, Math.floor((startOfDay(t) - start) / (7 * DAY)))];
    w[dir] = round2(w[dir] + a); w.items.push({ t, dir, amt: a, title, kind });
  };
  const overdueIn = { total: 0, items: [] };
  receivables.forEach((r) => {
    if ((+r.due || 0) < start) { const a = round2(+r.amt || 0); if (a > 0) { overdueIn.total = round2(overdueIn.total + a); overdueIn.items.push({ ...r, amt: a }); } }
    else put(r.due, "in", r.amt, r.title, "recv");
  });
  payables.forEach((p) => put(Math.max(+p.due || 0, start), "out", p.amt, p.title, (+p.due || 0) < start ? "pay-overdue" : "pay"));
  recurring.forEach((r) => monthlyDates(r.day, start, end).forEach((t) => put(t, r.dir === "in" ? "in" : "out", r.amount, r.name, "recurring")));
  oneoff.forEach((o) => { const t = +o.date || 0; if (t >= start) put(t, o.dir === "in" ? "in" : "out", o.amount, o.name, "oneoff"); });
  let bal = round2(+opening || 0), low = { balance: bal, week: -1 };
  W.forEach((w, i) => {
    w.net = round2(w.in - w.out); bal = round2(bal + w.net); w.balance = bal;
    w.items.sort((a, b) => a.t - b.t);
    if (bal < low.balance) low = { balance: bal, week: i };
  });
  return { start, end, opening: round2(+opening || 0), weeks: W, overdueIn, lowest: low, final: bal };
}
