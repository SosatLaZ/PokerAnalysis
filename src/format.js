// Mise en forme française des nombres : « 46,2 % », « 12,50 », « +3,25 ».

export function pct(x, decimales = 1) {
  if (!Number.isFinite(x)) return '—';
  return (x * 100).toFixed(decimales).replace('.', ',') + ' %';
}

export function montant(x) {
  if (!Number.isFinite(x)) return '—';
  const r = Math.round(x * 100) / 100;
  return (Number.isInteger(r) ? String(r) : r.toFixed(2)).replace('.', ',');
}

export function signe(x) {
  if (!Number.isFinite(x)) return '—';
  const r = Math.round(x * 100) / 100;
  if (r === 0) return '0';
  return (r > 0 ? '+' : '−') + montant(Math.abs(r));
}

/** « 3,5 contre 1 » */
export function cote(gain, mise) {
  if (!(mise > 0)) return '—';
  return `${(gain / mise).toFixed(1).replace('.', ',')} contre 1`;
}
