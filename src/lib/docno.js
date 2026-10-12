// เลขที่เอกสาร: QT/RC/DN + ปีเดือน (YYMM) + ลำดับ 3 หลัก เช่น RC2610-001
const PREFIX = { quote: "QT", receipt: "RC", credit: "DN" };

export function docPrefix(type, dateStr) {
  return (PREFIX[type] || "RC") + String(dateStr).replace(/-/g, "").slice(2, 6);
}

// ลำดับสูงสุดที่เห็นในเอกสารที่โหลดมาแล้ว
export function maxDocSeq(docs, prefix) {
  return docs
    .filter((d) => String(d.no).startsWith(prefix))
    .reduce((m, d) => Math.max(m, +String(d.no).slice(prefix.length + 1) || 0), 0);
}

// ตัวนับกลางอาจตามหลังเอกสารเก่าที่ออกก่อนมีตัวนับ จึงเอาค่าที่มากกว่า + 1
export function nextSeq(counterLast, floor) {
  return Math.max(+counterLast || 0, +floor || 0) + 1;
}

export function formatDocNo(prefix, seq) {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}
