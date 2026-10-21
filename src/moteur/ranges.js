// Les ranges : l'ensemble des mains qu'on prête à un adversaire.
//
// Notation (celle des logiciels de poker) :
//   AA, AKs, AKo, AK        une classe (AK = assorties et dépareillées)
//   77+                     77, 88, …, AA
//   A2s+, KTo+              A2s…AKs ; KTo, KJo, KQo
//   QQ-88, A5s-A2s          un intervalle
//   AhKh                    une combinaison précise
//   15%                     les 15 % meilleures mains (classement contre une main au hasard)
//   aléatoire (ou *)        les 1 326 combinaisons
// On sépare les morceaux par des virgules ou des espaces : « 22+, A2s+, KTo+, 15% ».

import { RANGS, lireCartes, nomCarte } from './cartes.js';
import { CLASSES, combosDeClasse, nbCombosDeClasse, nomClasse } from './classes.js';
import { CLASSEMENT } from './classement.js';

export const TOTAL_COMBOS = 1326;

const AIDE = 'exemples : 22+, A2s+, KTo+, QQ-88, AhKh, 15%, aléatoire';

const cle = (a, b) => (a < b ? a * 52 + b : b * 52 + a);

const CARTE = '(?:10|[2-9TJQKA])[cdhs♣♦♥♠]';
const DEUX_CARTES = new RegExp(`^${CARTE}[\\s,]*${CARTE}$`, 'i');

/** Les classes formant les p % meilleures mains (p entre 0 et 100). */
export function classesPourcentage(p) {
  if (!(p > 0 && p <= 100)) throw new Error(`Pourcentage hors limites : ${p} % (entre 0 et 100)`);
  const cible = (p / 100) * TOTAL_COMBOS;
  const classes = [];
  let cumul = 0;
  for (const classe of CLASSEMENT) {
    if (cumul >= cible - 1e-9) break;
    classes.push(classe);
    cumul += nbCombosDeClasse(classe);
  }
  return classes;
}

function rang(lettre) {
  return RANGS.indexOf(lettre.toUpperCase());
}

/** Un morceau de range → la liste de ses classes ou de ses combinaisons. */
function lireMorceau(brut) {
  const morceau = brut.trim();
  if (/^(al[ée]atoire|random|any|tout|toutes|\*)$/i.test(morceau)) return { classes: CLASSES };

  const pct = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(morceau);
  if (pct) return { classes: classesPourcentage(Number(pct[1].replace(',', '.'))) };

  const m = morceau.replace(/10/g, 'T');

  // Une combinaison précise : AhKh.
  if (/^([2-9TJQKA][cdhs♣♦♥♠]){2}$/i.test(m)) {
    const [a, b] = lireCartes(m);
    return { combos: [[a, b]] };
  }

  const CLASSE = '([2-9TJQKA])([2-9TJQKA])([so]?)';

  // Un intervalle : QQ-88, A5s-A2s.
  let x = new RegExp(`^${CLASSE}-${CLASSE}$`, 'i').exec(m);
  if (x) {
    const [h1, h2, ht, b1, b2, bt] = [rang(x[1]), rang(x[2]), x[3].toLowerCase(), rang(x[4]), rang(x[5]), x[6].toLowerCase()];
    if (h1 === h2 && b1 === b2) {
      const [haut, bas] = h1 >= b1 ? [h1, b1] : [b1, h1];
      const classes = [];
      for (let r = bas; r <= haut; r++) classes.push(nomClasse(r, r, ''));
      return { classes };
    }
    if (h1 !== b1 || h1 === h2 || b1 === b2 || ht !== bt) {
      throw new Error(`Intervalle illisible : « ${brut} » (les deux bornes partagent la première carte : A5s-A2s, KQo-K9o)`);
    }
    const [haut, bas] = h2 >= b2 ? [h2, b2] : [b2, h2];
    if (haut >= h1) throw new Error(`Intervalle illisible : « ${brut} »`);
    const classes = [];
    for (let r = bas; r <= haut; r++) classes.push(...variantes(h1, r, ht));
    return { classes };
  }

  // Un « et mieux » : 77+, A2s+, KTo+.
  x = new RegExp(`^${CLASSE}\\+$`, 'i').exec(m);
  if (x) {
    let [r1, r2, type] = [rang(x[1]), rang(x[2]), x[3].toLowerCase()];
    if (r1 < r2) [r1, r2] = [r2, r1];
    const classes = [];
    if (r1 === r2) {
      for (let r = r1; r <= 12; r++) classes.push(nomClasse(r, r, ''));
    } else {
      for (let r = r2; r < r1; r++) classes.push(...variantes(r1, r, type));
    }
    return { classes };
  }

  // Une classe seule : AKs, AK, 77.
  x = new RegExp(`^${CLASSE}$`, 'i').exec(m);
  if (x) {
    const [r1, r2, type] = [rang(x[1]), rang(x[2]), x[3].toLowerCase()];
    if (r1 === r2 && type) throw new Error(`Une paire n'est ni assortie ni dépareillée : « ${brut} »`);
    return { classes: r1 === r2 ? [nomClasse(r1, r2, '')] : variantes(r1, r2, type) };
  }

  throw new Error(`Range illisible : « ${brut} » (${AIDE})`);
}

function variantes(r1, r2, type) {
  return type ? [nomClasse(r1, r2, type)] : [nomClasse(r1, r2, 's'), nomClasse(r1, r2, 'o')];
}

/**
 * Texte → liste de combinaisons [c1, c2], sans doublon.
 * Lève une erreur lisible si un morceau est incompréhensible.
 */
export function lireRange(texte) {
  const morceaux = String(texte ?? '')
    .split(/[,;\s]+/)
    .filter(Boolean);
  if (morceaux.length === 0) throw new Error(`Range vide (${AIDE})`);
  const vues = new Set();
  const combos = [];
  const ajouter = (a, b) => {
    const k = cle(a, b);
    if (vues.has(k)) return;
    vues.add(k);
    combos.push(a > b ? [a, b] : [b, a]);
  };
  for (const morceau of morceaux) {
    const lu = lireMorceau(morceau);
    for (const classe of lu.classes ?? []) for (const [a, b] of combosDeClasse(classe)) ajouter(a, b);
    for (const [a, b] of lu.combos ?? []) ajouter(a, b);
  }
  return combos;
}

/**
 * Un joueur décrit par du texte : deux cartes précises (« Ah Kd ») donnent une
 * main connue, tout le reste est lu comme une range (« QQ+, AK », « 20% »).
 */
export function lireJoueur(texte) {
  const brut = String(texte ?? '').trim();
  if (brut === '') throw new Error(`Main ou range vide (${AIDE})`);
  if (DEUX_CARTES.test(brut)) {
    const [a, b] = lireCartes(brut);
    return [[a, b]];
  }
  return lireRange(brut);
}

/** Retire les combinaisons qui utilisent une carte déjà vue. */
export function retirerBloquees(combos, cartes) {
  const prises = new Set(cartes);
  return combos.filter(([a, b]) => !prises.has(a) && !prises.has(b));
}

/** « 120 combinaisons (9,0 % des mains) » */
export function decrireRange(combos) {
  if (combos.length === 1) return nomCarte(combos[0][0]) + nomCarte(combos[0][1]);
  const pct = ((combos.length / TOTAL_COMBOS) * 100).toFixed(1).replace('.', ',');
  return `${combos.length} combinaisons (${pct} % des mains)`;
}

/** Part des mains d'une range parmi toutes les mains encore possibles (cartes connues retirées). */
export function frequenceRange(combos, cartesConnues = []) {
  const possibles = retirerBloquees(toutesLesCombos(), cartesConnues).length;
  return retirerBloquees(combos, cartesConnues).length / possibles;
}

export function toutesLesCombos() {
  const combos = [];
  for (let a = 51; a >= 0; a--) for (let b = a - 1; b >= 0; b--) combos.push([a, b]);
  return combos;
}
