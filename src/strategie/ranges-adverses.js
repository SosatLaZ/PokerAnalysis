// Ce qu'un adversaire peut avoir, d'après ce qu'il a fait.
//
// Avant le flop, son action donne une tranche du classement des 169 mains
// (« il a ouvert au bouton : les 45 % meilleures », « il a payé : la tranche
// sous ses relances »). Après le flop, chaque mise ou relance resserre sa range
// sur ce qui touche le tableau, en lui laissant une part de bluffs.

import { CLASSEMENT } from '../moteur/classement.js';
import { combosDeClasse, nbCombosDeClasse } from '../moteur/classes.js';
import { retirerBloquees, TOTAL_COMBOS } from '../moteur/ranges.js';
import { classeDeMain } from '../moteur/cartes.js';
import { lireMain } from './lecture.js';
import { profil as profilParId } from './profils.js';

/** Pourcentage cumulé (0 à 100) atteint en incluant la classe : AA ≈ 0,5, 72o ≈ 98. */
export const PERCENTILE = (() => {
  const m = new Map();
  let cumul = 0;
  for (const classe of CLASSEMENT) {
    cumul += nbCombosDeClasse(classe);
    m.set(classe, (cumul / TOTAL_COMBOS) * 100);
  }
  return m;
})();

/** Rang d'une main dans le classement, en % : 0 = meilleure, 100 = pire. */
export function percentileMain(main) {
  return PERCENTILE.get(classeDeMain(main[0], main[1]));
}

/** Les combinaisons des classes dont le percentile tombe dans ]bas, haut]. */
export function rangeEntre(bas, haut) {
  const combos = [];
  for (const classe of CLASSEMENT) {
    const p = PERCENTILE.get(classe);
    const debut = p - (nbCombosDeClasse(classe) / TOTAL_COMBOS) * 100;
    // Une classe compte si l'essentiel de ses combinaisons est dans la tranche.
    const milieu = (debut + p) / 2;
    if (milieu > bas && milieu <= haut) combos.push(...combosDeClasse(classe));
  }
  return combos;
}

const borner = (x, min, max) => Math.min(max, Math.max(min, x));

/**
 * La tranche (en %) qu'on prête à un adversaire selon son action avant le flop.
 * @param {string} action  'ouverture' | 'relance' | 'surrelance' | 'suivi' | 'limp' | 'grosse-blinde' | 'tapis' | 'appel-tapis'
 * @param {object} p       { position, profil de l'adversaire (id ou objet), bbEffectives,
 *                          pessimisme : > 1 quand on le croit plus solide qu'il ne paraît }
 */
export function tranchePreflop(action, { position = 'CO', profil = 'solide', bbEffectives = 100, pessimisme = 1 } = {}) {
  const pr = typeof profil === 'string' ? profilParId(profil) : profil;
  const ouverture = pr.ouverture[position] ?? pr.ouverture.CO;
  switch (action) {
    case 'ouverture':
      return [0, ouverture];
    case 'relance':
      return [0, pr.troisMise + pr.troisMiseBluff];
    case 'surrelance':
      return [0, pr.quatreMise];
    case 'suivi':
      // Il paie avec la tranche sous ses relances, et garde quelques pièges.
      return [pr.troisMise * 0.4, pr.troisMise + pr.defense];
    case 'limp':
      return [8, 60];
    case 'grosse-blinde':
      return [6, 100];
    case 'tapis':
      // Plus on est court, plus on part à tapis large.
      return [0, borner(320 / Math.max(bbEffectives, 1), 6, 70) / pessimisme];
    case 'appel-tapis':
      return [0, borner(160 / Math.max(bbEffectives, 1), 4, 50) * pessimisme];
    default:
      return [0, 100];
  }
}

/** Range avant le flop, cartes connues retirées. */
export function rangePreflop(action, options = {}, cartesConnues = []) {
  const [bas, haut] = tranchePreflop(action, options);
  let combos = rangeEntre(bas, haut);
  if (combos.length === 0) combos = rangeEntre(0, Math.max(haut, 1));
  return retirerBloquees(combos, cartesConnues);
}

/**
 * Resserre une range après une action sur un tableau.
 * - mise ou relance : garde ce qui touche (paire et mieux, tirages) et une part de « rien » (les bluffs) ;
 * - suivi : garde ce qui touche et les tirages, presque plus de « rien » ;
 * - parole : retire une partie des mains fortes (qui auraient misé).
 */
export function affinerRange(combos, tableau, action, { frequenceBluff = 0.15 } = {}) {
  if (tableau.length < 3 || !action) return combos;
  const bluffs = garderUneFraction(action === 'relance' ? frequenceBluff / 2 : frequenceBluff);
  const flottes = garderUneFraction(0.1);
  const pieges = garderUneFraction(0.35);
  const garde = combos.filter((combo) => {
    const l = lireMain(combo, tableau);
    const gros = l.force === 'monstre' || l.force === 'forte';
    const tirage = l.tirages.outs >= 8;
    const touche = l.force !== 'rien' || tirage;
    switch (action) {
      case 'mise':
      case 'tapis':
        return touche || bluffs();
      case 'relance':
        return gros || l.force === 'moyenne' || tirage || bluffs();
      case 'suit':
        return touche || l.tirages.outs >= 4 || flottes();
      case 'parole':
        return !gros || pieges(); // les mains fortes auraient misé, sauf les pièges
      default:
        return true;
    }
  });
  // Une range ne disparaît jamais : au pire on garde l'ancienne.
  return garde.length >= 3 ? garde : combos;
}

/** Garde une part fixe des éléments qu'on lui présente, régulièrement espacés (sans hasard). */
function garderUneFraction(fraction) {
  let n = 0;
  return () => {
    n++;
    return Math.floor(n * fraction) > Math.floor((n - 1) * fraction);
  };
}
