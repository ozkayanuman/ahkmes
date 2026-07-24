export const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("tr-TR") : "—";

export const fmtMoney = (n: number | string, currency = "TRY") =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(Number(n));

export const fmtQty = (n: number | string) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(n));

/** <input type="date"> için bugünün değeri */
export const todayInput = () => new Date().toISOString().slice(0, 10);
