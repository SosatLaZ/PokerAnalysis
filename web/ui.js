// Les briques d'affichage partagées par les onglets. Jamais d'innerHTML : tout passe par el().

import { RANGS, SYMBOLES, rangDe, couleurDe } from '../src/moteur/cartes.js';

export const NOMS_COULEURS = ['trèfle', 'carreau', 'cœur', 'pique'];
export const $ = (id) => document.getElementById(id);

/** Crée un élément : el('p', { class: 'aide' }, 'texte', autreElement). Jamais d'innerHTML. */
export function el(nom, attributs = {}, ...enfants) {
  const e = document.createElement(nom);
  for (const [k, v] of Object.entries(attributs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const enfant of enfants.flat()) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    e.append(enfant instanceof Node ? enfant : String(enfant));
  }
  return e;
}

export const estRouge = (c) => couleurDe(c) === 1 || couleurDe(c) === 2;
export const lettreRang = (c) => (RANGS[rangDe(c)] === 'T' ? '10' : RANGS[rangDe(c)]);

export function visuelCarte(c) {
  return el('span', { class: `carte ${estRouge(c) ? 'rouge' : 'noir'}` }, el('b', {}, lettreRang(c)), el('i', {}, SYMBOLES[couleurDe(c)]));
}

/** Des cartes dans une phrase : « A♥ K♦ ». */
export function cartesEnLigne(cartes) {
  return el(
    'span',
    { class: 'carte-texte' },
    cartes.map((c) => el('span', { class: estRouge(c) ? 'rouge' : 'noir' }, lettreRang(c) + SYMBOLES[couleurDe(c)])),
  );
}


export function chiffres(lignes) {
  return el(
    'dl',
    { class: 'chiffres' },
    lignes.map(([dt, dd, ton]) => el('div', {}, el('dt', {}, dt), el('dd', { class: ton ?? null }, dd))),
  );
}


/** Un dos de carte (carte cachée). */
export function dosDeCarte() {
  return el('span', { class: 'carte dos', 'aria-label': 'carte cachée' });
}
