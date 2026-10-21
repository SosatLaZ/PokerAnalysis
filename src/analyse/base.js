// La base de mains : on y verse des historiques, elle garde chaque main une
// seule fois (clé : son numéro), quel que soit le nombre d'imports.

import { decouperMains } from './historique.js';

/** Le numéro d'une main, lu dans son en-tête ; à défaut, une empreinte du texte. */
export function cleDeMain(bloc) {
  const entete = bloc.split('\n')[0];
  const id = (/#\s*([\w.-]+)/.exec(entete) ?? /(?:n°|HandId:?)\s*([\w.-]+)/i.exec(entete))?.[1];
  if (id) return id;
  let h = 2166136261;
  for (let i = 0; i < bloc.length; i++) h = Math.imul(h ^ bloc.charCodeAt(i), 16777619);
  return `texte-${(h >>> 0).toString(16)}`;
}

/** Verse un texte dans la base (objet clé → texte). Ne modifie pas la base reçue. */
export function fusionnerMains(base, texte) {
  const resultat = { ...base };
  let ajoutees = 0;
  let doublons = 0;
  for (const bloc of decouperMains(texte)) {
    const cle = cleDeMain(bloc);
    if (resultat[cle]) doublons++;
    else {
      resultat[cle] = bloc;
      ajoutees++;
    }
  }
  return { base: resultat, ajoutees, doublons, total: Object.keys(resultat).length };
}

/** Toute la base en un seul texte, prêt pour lireHistorique. */
export const texteDeLaBase = (base) => Object.values(base).join('\n\n\n');
