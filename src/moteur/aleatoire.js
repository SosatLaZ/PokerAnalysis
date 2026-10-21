// Générateur pseudo-aléatoire à graine (mulberry32) : rapide, et reproductible
// quand on fixe la graine (les tests en ont besoin).

export function creerAleatoire(graine) {
  let a = (graine ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  return function aleatoire() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
