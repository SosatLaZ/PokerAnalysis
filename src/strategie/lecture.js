// La lecture du coup : ce que vaut ta main sur ce tableau, tes tirages, et la
// texture du tableau. C'est ce qu'un joueur se dit en regardant la table.

import { rangDe, couleurDe, NOMS_RANGS } from '../moteur/cartes.js';
import {
  evaluer,
  categorieDe,
  decrireScore,
  PAIRE,
  DOUBLE_PAIRE,
  BRELAN,
  QUINTE,
  COULEUR,
} from '../moteur/evaluateur.js';

/** Rang haut de la meilleure quinte d'un masque de rangs, ou -1 (la roue vaut 3). */
function hauteQuinte(masque) {
  const x = (masque << 1) | ((masque >> 12) & 1);
  const s = x & (x >> 1) & (x >> 2) & (x >> 3) & (x >> 4);
  return s === 0 ? -1 : 31 - Math.clz32(s) + 3;
}

const masqueRangs = (cartes) => cartes.reduce((m, c) => m | (1 << rangDe(c)), 0);

/** La texture du tableau : sec, coordonné, apparié, monochrome. */
export function texture(tableau) {
  const rangs = tableau.map(rangDe).sort((a, b) => b - a);
  const parCouleur = [0, 0, 0, 0];
  for (const c of tableau) parCouleur[couleurDe(c)]++;
  const maxCouleur = Math.max(...parCouleur);
  const paire = new Set(rangs).size < rangs.length;
  // Coordonné : trois rangs distincts tiennent dans une fenêtre de cinq (une quinte est possible).
  const distincts = [...new Set(rangs)];
  const avecAsBas = distincts.includes(12) ? [...distincts, -1] : distincts;
  let coordonne = false;
  for (const bas of avecAsBas) {
    const dans = avecAsBas.filter((r) => r >= bas && r <= bas + 4).length;
    if (dans >= 3) coordonne = true;
  }
  const couleurPossible = maxCouleur >= 3;
  const tirageCouleur = maxCouleur === 2 && tableau.length < 5;
  const humide = coordonne || couleurPossible || tirageCouleur;
  const traits = [];
  if (paire) traits.push('apparié');
  if (maxCouleur >= 3) traits.push(maxCouleur === tableau.length ? 'monochrome' : 'trois cartes d’une couleur');
  else if (tirageCouleur) traits.push('deux cartes d’une couleur');
  if (coordonne) traits.push('coordonné');
  if (!humide && !paire) traits.push('sec');
  return {
    hauteur: rangs[0] ?? -1,
    paire,
    maxCouleur,
    coordonne,
    couleurPossible,
    tirageCouleur,
    sec: !humide,
    description: traits.join(', ') || 'neutre',
  };
}

/**
 * Les tirages : couleur (et si c'est la couleur max), quinte par les deux bouts
 * ou ventrale, surcartes. Les outs sont comptés sans doublon approximatif.
 */
export function tirages(main, tableau) {
  const vide = { couleur: false, couleurMax: false, quinteOuverte: false, quinteVentrale: false, surcartes: 0, outs: 0, description: '' };
  if (tableau.length < 3 || tableau.length >= 5) return vide;
  const toutes = [...main, ...tableau];

  // Couleur : quatre cartes d'une couleur dont au moins une à nous.
  let couleur = false;
  let couleurMax = false;
  for (let s = 0; s < 4; s++) {
    const n = toutes.filter((c) => couleurDe(c) === s).length;
    const aMoi = main.filter((c) => couleurDe(c) === s);
    if (n === 4 && aMoi.length > 0) {
      couleur = true;
      // La plus haute carte de la couleur qui manque est-elle dans notre main ?
      const presentes = new Set(toutes.filter((c) => couleurDe(c) === s).map(rangDe));
      let plusHauteAbsente = 12;
      while (plusHauteAbsente >= 0 && presentes.has(plusHauteAbsente) && !aMoi.some((c) => rangDe(c) === plusHauteAbsente)) plusHauteAbsente--;
      couleurMax = aMoi.some((c) => rangDe(c) === plusHauteAbsente) || aMoi.some((c) => rangDe(c) === 12);
    }
  }

  // Quinte : combien de rangs manquants la complètent (avec au moins une de nos cartes utile).
  const mTout = masqueRangs(toutes);
  const mTableau = masqueRangs(tableau);
  let rangsQuiCompletent = 0;
  if (hauteQuinte(mTout) < 0) {
    for (let r = 0; r < 13; r++) {
      if (mTout & (1 << r)) continue;
      const q = hauteQuinte(mTout | (1 << r));
      if (q >= 0 && hauteQuinte(mTableau | (1 << r)) < 0) rangsQuiCompletent++;
    }
  }
  const quinteOuverte = rangsQuiCompletent >= 2;
  const quinteVentrale = rangsQuiCompletent === 1;

  const hautTableau = Math.max(...tableau.map(rangDe));
  const surcartes = main.filter((c) => rangDe(c) > hautTableau).length;

  let outs = 0;
  if (couleur) outs += 9;
  if (quinteOuverte) outs += couleur ? 6 : 8;
  else if (quinteVentrale) outs += couleur ? 3 : 4;
  const morceaux = [];
  if (couleur) morceaux.push(couleurMax ? 'tirage couleur max' : 'tirage couleur');
  if (quinteOuverte) morceaux.push('tirage quinte par les deux bouts');
  else if (quinteVentrale) morceaux.push('tirage quinte ventrale');
  return { couleur, couleurMax, quinteOuverte, quinteVentrale, surcartes, outs, description: morceaux.join(' + ') };
}

/**
 * Ce que vaut la main sur le tableau.
 * force : 'monstre' > 'forte' > 'moyenne' > 'faible' > 'rien'
 */
export function lireMain(main, tableau) {
  if (tableau.length < 3) throw new Error('lireMain se lit après le flop.');
  const score = evaluer([...main, ...tableau]);
  const cat = categorieDe(score);
  const scoreTableau = tableau.length === 5 ? evaluer(tableau) : -1;
  const joueLeTableau = scoreTableau === score;
  const rangsTableau = tableau.map(rangDe).sort((a, b) => b - a);
  const [r1, r2] = main.map(rangDe).sort((a, b) => b - a);
  const pocket = r1 === r2;
  const t = texture(tableau);
  const tir = tirages(main, tableau);
  const comptesTableau = new Map();
  for (const r of rangsTableau) comptesTableau.set(r, (comptesTableau.get(r) ?? 0) + 1);

  let force = 'rien';
  let detail = decrireScore(score);

  if (joueLeTableau) {
    force = 'rien';
    detail = `${decrireScore(score)} (le tableau joue pour tout le monde)`;
  } else if (cat >= QUINTE) {
    // Quinte, couleur, full, carré, quinte flush : on regarde si le tableau en offre autant.
    const categorieTableauSeul = tableau.length >= 5 ? categorieDe(evaluer(tableau)) : -1;
    if (cat === COULEUR && t.maxCouleur >= 4 && !main.some((c) => rangDe(c) >= 10 && tableau.filter((b) => couleurDe(b) === couleurDe(c)).length >= 3)) {
      force = 'forte'; // couleur avec une petite carte quand le tableau en montre quatre
    } else force = categorieTableauSeul === cat ? 'moyenne' : 'monstre';
  } else if (cat === BRELAN) {
    if (pocket && comptesTableau.get(r1) === 1) {
      force = 'monstre';
      detail = `Brelan servi de ${NOMS_RANGS[r1]} (paire en main)`;
    } else force = 'forte';
  } else if (cat === DOUBLE_PAIRE) {
    const pairesDuTableau = [...comptesTableau.values()].filter((n) => n >= 2).length;
    const utiliseDeux = !pocket && comptesTableau.has(r1) && comptesTableau.has(r2);
    if (utiliseDeux) force = r1 === rangsTableau[0] || r2 === rangsTableau[0] ? 'forte' : 'moyenne';
    else if (pairesDuTableau >= 1) {
      // Une paire au tableau + la nôtre : se juge comme une paire.
      force = (pocket && r1 > rangsTableau[0]) || comptesTableau.get(rangsTableau[0]) === 1 && (r1 === rangsTableau[0] || r2 === rangsTableau[0]) ? 'moyenne' : 'faible';
    } else force = 'moyenne';
  } else if (cat === PAIRE) {
    const rangPaire = (score >> 16) & 15;
    const vientDeLaMain = pocket ? r1 === rangPaire : r1 === rangPaire || r2 === rangPaire;
    if (!vientDeLaMain) {
      force = 'rien';
      detail = 'Paire du tableau seulement';
    } else if (pocket && rangPaire > rangsTableau[0]) {
      force = rangPaire >= 9 ? 'forte' : 'moyenne';
      detail = `Paire servie de ${NOMS_RANGS[rangPaire]}, au-dessus du tableau`;
    } else if (rangPaire === rangsTableau[0]) {
      const kicker = r1 === rangPaire ? r2 : r1;
      force = kicker >= 9 || pocket ? 'forte' : 'moyenne';
      detail = `Paire supérieure (${NOMS_RANGS[rangPaire]}), kicker ${NOMS_RANGS[kicker]}`;
    } else if (pocket && rangPaire < rangsTableau[rangsTableau.length - 1]) {
      force = 'faible';
      detail = `Petite paire servie de ${NOMS_RANGS[rangPaire]}, sous le tableau`;
    } else {
      const position = [...new Set(rangsTableau)].indexOf(rangPaire);
      force = position === 1 ? 'moyenne' : 'faible';
      detail = position === 1 ? `Deuxième paire (${NOMS_RANGS[rangPaire]})` : `Petite paire (${NOMS_RANGS[rangPaire]})`;
    }
  } else {
    force = r1 === 12 ? 'faible' : 'rien';
    detail = `Hauteur ${NOMS_RANGS[r1]}`;
  }

  return {
    score,
    categorie: cat,
    force,
    detail,
    tirages: tir,
    texture: t,
    description: tir.description ? `${detail}, ${tir.description} (${tir.outs} outs)` : detail,
  };
}
