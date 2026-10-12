// ต้นทุนสินค้าแยกอยู่ใน itemCosts/{itemId} = { cost, pending: [{oq, a, c, at}] }
// เจ้าของอ่านได้คนเดียว ลูกน้องที่บันทึกซื้อเข้าไม่รู้ทุนเดิม จึงต่อท้ายรายการใน pending
// แล้วเครื่องเจ้าของคำนวณทุนเฉลี่ยถ่วงน้ำหนักให้ (สูตรเดียวกับตอนบันทึกซื้อเข้าแบบเดิม)

const round2 = (n) => Math.round(n * 100) / 100;

// oq = จำนวนในสต็อกก่อนรับเข้า, a = จำนวนที่รับเข้า, c = ทุนต่อหน่วยของล็อตใหม่
export function applyCostEntry(cost, { oq, a, c }) {
  const oc = +cost || 0, q = +oq || 0, add = +a || 0, unit = +c || 0;
  if (q > 0 && oc > 0 && q + add > 0) return round2((q * oc + unit * add) / (q + add));
  return round2(unit);
}

export function applyPending(cost, pending) {
  const list = Array.isArray(pending) ? [...pending].sort((x, y) => (x.at || 0) - (y.at || 0)) : [];
  return list.reduce((c, e) => applyCostEntry(c, e), +cost || 0);
}

// costDoc.cost มาก่อน ถ้ายังไม่ย้าย ใช้ items.cost เดิม
export function costOf(item, costDoc) {
  const base = costDoc && "cost" in costDoc ? costDoc.cost : item && item.cost;
  return applyPending(base, costDoc && costDoc.pending);
}

export function mergeItemCosts(items, costs) {
  return items.map((it) => ({ ...it, cost: costOf(it, costs[it.id]) }));
}

// ต้นทุนของบรรทัดขาย: ถ้าบิลที่ลูกน้องออกไม่มีทุน (costLater) ใช้ทุนปัจจุบันของสินค้า
export function lineCost(line, item) {
  if (+line.cost > 0) return +line.cost;
  if (!line.costLater || !item) return 0;
  const c = +item.cost || 0;
  return line.cut ? round2((+line.cut.ratio || 0) * c) : c;
}
