/** Faz J basit Custom Report: generic satır dizisini CSV metnine çevirir.
 * Değerler virgül/tırnak/yeni satır içeriyorsa RFC 4180'e göre tırnaklanır.
 * `=`/`+`/`-`/`@`/tab/CR ile başlayan hücreler CSV Formula Injection'a karşı
 * tek tırnak öneki ile "metinleştirilir" (Excel/Sheets bunları formül olarak
 * yorumlayabilir — kullanıcı girişi içeren failureType/description/notes gibi
 * alanlar bu riski taşır). */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
): string {
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(","));
  return [header, ...lines].join("\r\n");
}
