// L'évaluateur de mains : de 5 à 7 cartes → un score entier.
//
// Plus le score est grand, plus la main est forte ; deux mains de même force
// ont le même score. Le score se lit ainsi :
//   catégorie × 2^20 + cinq rangs départageants de 4 bits chacun (du plus fort au plus faible)
//
// Les masques de bits par couleur font tout le travail : pas de table géante,
// pas d'allocation dans la boucle, quelques millions de mains par seconde.

import { NOMS_RANGS, lireCartes } from './cartes.js';

export const CATEGORIES = [
  'Hauteur',
  'Paire',
  'Double paire',
  'Brelan',
  'Quinte',
  'Couleur',
  'Full',
  'Carré',
  'Quinte flush',
];

export const HAUTEUR = 0;
export const PAIRE = 1;
export const DOUBLE_PAIRE = 2;
export const BRELAN = 3;
export const QUINTE = 4;
export const COULEUR = 5;
export const FULL = 6;
export const CARRE = 7;
export const QUINTE_FLUSH = 8;

const compte = new Uint8Array(13);

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Rang de la carte haute de la meilleure quinte du masque, ou -1. La roue (A-2-3-4-5) vaut 3 (le 5). */
function hauteQuinte(masque) {
  const x = (masque << 1) | ((masque >> 12) & 1); // bit 0 : l'as joué en bas
  const s = x & (x >> 1) & (x >> 2) & (x >> 3) & (x >> 4);
  if (s === 0) return -1;
  return 31 - Math.clz32(s) + 3;
}

/** Les n bits les plus hauts du masque, rangés en départageants de 4 bits. */
function departageants(masque, n) {
  let score = 0;
  let decalage = 16;
  for (let r = 12; r >= 0 && n > 0; r--) {
    if (masque & (1 << r)) {
      score |= r << decalage;
      decalage -= 4;
      n--;
    }
  }
  return score;
}

/**
 * Évalue de 5 à 7 cartes. `cartes` est un tableau d'entiers (0..51) ;
 * `n` permet de n'en lire que les n premières sans recopier le tableau.
 */
export function evaluer(cartes, n = cartes.length) {
  let m0 = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  compte.fill(0);
  for (let i = 0; i < n; i++) {
    const c = cartes[i];
    const r = c >> 2;
    const bit = 1 << r;
    switch (c & 3) {
      case 0: m0 |= bit; break;
      case 1: m1 |= bit; break;
      case 2: m2 |= bit; break;
      default: m3 |= bit;
    }
    compte[r]++;
  }

  // Couleur et quinte flush. Avec 7 cartes au plus, une couleur exclut carré et full.
  let mc = 0;
  if (popcount(m0) >= 5) mc = m0;
  else if (popcount(m1) >= 5) mc = m1;
  else if (popcount(m2) >= 5) mc = m2;
  else if (popcount(m3) >= 5) mc = m3;
  if (mc !== 0) {
    const qf = hauteQuinte(mc);
    if (qf >= 0) return (QUINTE_FLUSH << 20) | (qf << 16);
    return (COULEUR << 20) | departageants(mc, 5);
  }

  let carre = -1;
  let brelan1 = -1;
  let brelan2 = -1;
  let paire1 = -1;
  let paire2 = -1;
  let paire3 = -1;
  let seules = 0; // masque des rangs présents une seule fois
  for (let r = 12; r >= 0; r--) {
    const k = compte[r];
    if (k === 0) continue;
    if (k === 1) seules |= 1 << r;
    else if (k === 2) {
      if (paire1 < 0) paire1 = r;
      else if (paire2 < 0) paire2 = r;
      else if (paire3 < 0) paire3 = r;
    } else if (k === 3) {
      if (brelan1 < 0) brelan1 = r;
      else brelan2 = r;
    } else carre = r;
  }

  if (carre >= 0) {
    const reste = (m0 | m1 | m2 | m3) & ~(1 << carre);
    return (CARRE << 20) | (carre << 16) | (departageants(reste, 1) >> 4);
  }
  if (brelan1 >= 0 && (brelan2 >= 0 || paire1 >= 0)) {
    const avec = Math.max(brelan2, paire1);
    return (FULL << 20) | (brelan1 << 16) | (avec << 12);
  }

  const quinte = hauteQuinte(m0 | m1 | m2 | m3);
  if (quinte >= 0) return (QUINTE << 20) | (quinte << 16);

  if (brelan1 >= 0) {
    return (BRELAN << 20) | (brelan1 << 16) | (departageants(seules, 2) >> 4);
  }
  if (paire2 >= 0) {
    // La troisième paire éventuelle peut servir de départageant.
    let reste = seules;
    if (paire3 >= 0) reste |= 1 << paire3;
    return (DOUBLE_PAIRE << 20) | (paire1 << 16) | (paire2 << 12) | (departageants(reste, 1) >> 8);
  }
  if (paire1 >= 0) {
    return (PAIRE << 20) | (paire1 << 16) | (departageants(seules, 3) >> 4);
  }
  return (HAUTEUR << 20) | departageants(seules, 5);
}

export const categorieDe = (score) => score >> 20;

/** Score → « Couleur hauteur As », « Double paire, Rois et 7 », … */
export function decrireScore(score) {
  const cat = categorieDe(score);
  const r1 = (score >> 16) & 15;
  const r2 = (score >> 12) & 15;
  const nom = (r) => NOMS_RANGS[r];
  const pluriel = (r) => (r <= 8 || r === 12 ? NOMS_RANGS[r] : NOMS_RANGS[r] + 's');
  switch (cat) {
    case QUINTE_FLUSH: return r1 === 12 ? 'Quinte flush royale' : `Quinte flush hauteur ${nom(r1)}`;
    case CARRE: return `Carré de ${pluriel(r1)}`;
    case FULL: return `Full aux ${pluriel(r1)} par les ${pluriel(r2)}`;
    case COULEUR: return `Couleur hauteur ${nom(r1)}`;
    case QUINTE: return `Quinte hauteur ${nom(r1)}`;
    case BRELAN: return `Brelan de ${pluriel(r1)}`;
    case DOUBLE_PAIRE: return `Double paire, ${pluriel(r1)} et ${pluriel(r2)}`;
    case PAIRE: return `Paire de ${pluriel(r1)}`;
    default: return `Hauteur ${nom(r1)}`;
  }
}

/** Raccourci : texte « Ah Kh Qh Jh Th » ou tableau d'entiers → description. */
export function decrireMain(cartes) {
  return decrireScore(evaluer(typeof cartes === 'string' ? lireCartes(cartes) : cartes));
}
