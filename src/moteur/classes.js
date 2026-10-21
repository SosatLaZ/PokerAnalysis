// Les 169 classes de mains de départ : « AA », « AKs » (assorties), « AKo » (dépareillées).

import { RANGS, carte } from './cartes.js';

/** Toutes les classes, de AA à 32o. */
export const CLASSES = (() => {
  const liste = [];
  for (let r1 = 12; r1 >= 0; r1--) {
    for (let r2 = r1; r2 >= 0; r2--) {
      if (r1 === r2) liste.push(RANGS[r1] + RANGS[r2]);
      else liste.push(RANGS[r1] + RANGS[r2] + 's', RANGS[r1] + RANGS[r2] + 'o');
    }
  }
  return liste;
})();

/** Nom canonique d'une classe : rangs 0..12, `type` 's', 'o' ou '' (paire). */
export function nomClasse(r1, r2, type) {
  if (r1 < r2) [r1, r2] = [r2, r1];
  if (r1 === r2) return RANGS[r1] + RANGS[r2];
  return RANGS[r1] + RANGS[r2] + type;
}

/** « AKs » → les 4 combinaisons ; « 77 » → 6 ; « AKo » → 12 ; « AK » → 16. */
export function combosDeClasse(classe) {
  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(String(classe).trim());
  if (!m) throw new Error(`Classe de main inconnue : « ${classe} »`);
  let r1 = RANGS.indexOf(m[1].toUpperCase());
  let r2 = RANGS.indexOf(m[2].toUpperCase());
  if (r1 < r2) [r1, r2] = [r2, r1];
  const type = m[3].toLowerCase();
  const combos = [];
  if (r1 === r2) {
    if (type) throw new Error(`Une paire n'est ni assortie ni dépareillée : « ${classe} »`);
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = s1 + 1; s2 < 4; s2++) combos.push([carte(r1, s1), carte(r1, s2)]);
    return combos;
  }
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      const assortie = s1 === s2;
      if ((type === 's' && !assortie) || (type === 'o' && assortie)) continue;
      combos.push([carte(r1, s1), carte(r2, s2)]);
    }
  }
  return combos;
}

export const nbCombosDeClasse = (classe) => (classe.length === 2 ? 6 : classe.endsWith('s') ? 4 : 12);
