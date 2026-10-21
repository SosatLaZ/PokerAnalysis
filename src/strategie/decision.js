// La décision : faut-il jouer le coup ?
//
// Deux situations :
//   1. On fait face à une mise : on compare l'équité à la cote du pot.
//      Suivre est rentable quand  équité × (pot + mise à suivre − rake) > mise à suivre.
//   2. On a un tapis court (tournoi, Twister) : tapis ou se coucher.
//      On pèse ce qu'on gagne quand tout le monde se couche contre ce qu'on
//      gagne ou perd quand quelqu'un suit.
//
// Les montants sont dans l'unité qu'on veut (euros, jetons, grosses blindes),
// pourvu que ce soit la même partout.

import { calculerEquite } from '../moteur/equite.js';
import { frequenceRange, retirerBloquees } from '../moteur/ranges.js';
import { pct, montant, signe, cote } from '../moteur/format.js';

export const ACTIONS = {
  SUIVRE: 'Suivre',
  SE_COUCHER: 'Se coucher',
  LIMITE: 'Coup limite',
  CHECKER: 'Checker',
  MISER: 'Miser pour la valeur',
  TAPIS: 'Tapis',
};

function verifierMontant(nom, x) {
  if (!Number.isFinite(x) || x < 0) throw new Error(`${nom} doit être un nombre positif (reçu : ${x}).`);
}

/** Équité nécessaire pour qu'un call soit à l'équilibre. */
export function equiteRequise({ pot, aSuivre, rake = 0, plafondRake = Infinity, gainsImplicites = 0 }) {
  const potFinal = pot + aSuivre;
  const rakePris = Math.min(potFinal * rake, plafondRake);
  return aSuivre / (potFinal - rakePris + gainsImplicites);
}

/**
 * Face à une mise (ou sans mise à payer) : suivre, se coucher, ou miser.
 *
 * @param {object} p
 * @param {number} p.equite          équité de ta main (0 à 1) contre les ranges adverses
 * @param {number} p.pot             le pot AVANT ton call, mise adverse comprise
 * @param {number} p.aSuivre         ce que tu dois mettre pour suivre (0 si personne n'a misé)
 * @param {number} [p.nbAdversaires] adversaires encore dans le coup
 * @param {number} [p.rake]          part du pot prélevée par la salle (0,05 = 5 %)
 * @param {number} [p.plafondRake]   rake maximum par coup
 * @param {number} [p.gainsImplicites] ce que tu comptes gagner en plus sur les rues suivantes quand tu touches
 * @param {number} [p.cartesARetourner] cartes du tableau encore à venir (pour l'avertissement)
 * @param {number} [p.marge]         écart d'équité en dessous duquel le coup est déclaré limite
 */
export function deciderSuivre({
  equite,
  pot,
  aSuivre,
  nbAdversaires = 1,
  rake = 0,
  plafondRake = Infinity,
  gainsImplicites = 0,
  cartesARetourner = 0,
  marge = 0.02,
}) {
  if (!(equite >= 0 && equite <= 1)) throw new Error(`L'équité doit être entre 0 et 1 (reçu : ${equite}).`);
  verifierMontant('Le pot', pot);
  verifierMontant('La mise à suivre', aSuivre);
  verifierMontant('Les gains implicites', gainsImplicites);
  if (!(rake >= 0 && rake < 1)) throw new Error(`Le rake doit être entre 0 et 1 (reçu : ${rake}).`);

  const raisons = [];
  const partEquitable = 1 / (nbAdversaires + 1);

  if (aSuivre === 0) {
    const seuil = Math.min(0.6, 1.25 * partEquitable);
    const valeur = equite >= seuil;
    raisons.push('Personne n’a misé : rester dans le coup ne coûte rien.');
    raisons.push(
      `Ton équité : ${pct(equite)} (part équitable à ${nbAdversaires + 1} joueurs : ${pct(partEquitable)}).`,
    );
    if (valeur) raisons.push(`Au-dessus de ${pct(seuil, 0)} : tu es devant la range adverse, une mise pour la valeur se défend.`);
    else raisons.push('Pas assez devant pour miser pour la valeur : checker est le choix sûr.');
    return {
      action: valeur ? 'MISER' : 'CHECKER',
      titre: valeur ? ACTIONS.MISER : ACTIONS.CHECKER,
      equite,
      equiteRequise: 0,
      ev: 0,
      raisons,
    };
  }

  const potFinal = pot + aSuivre;
  const rakePris = Math.min(potFinal * rake, plafondRake);
  const gainSiVictoire = potFinal - rakePris + gainsImplicites;
  const requise = aSuivre / gainSiVictoire;
  const ev = equite * gainSiVictoire - aSuivre;
  const ecart = equite - requise;

  let action;
  if (ecart >= marge) action = 'SUIVRE';
  else if (ecart <= -marge) action = 'SE_COUCHER';
  else action = 'LIMITE';

  raisons.push(`Tu paies ${montant(aSuivre)} pour un pot de ${montant(pot)} : cote de ${cote(pot, aSuivre)}.`);
  raisons.push(`Équité minimale pour suivre : ${pct(requise)}. Ton équité : ${pct(equite)}.`);
  if (rakePris > 0) raisons.push(`Rake compté : ${montant(rakePris)} sur un pot final de ${montant(potFinal)}.`);
  if (gainsImplicites > 0) raisons.push(`Gains implicites comptés : ${montant(gainsImplicites)}.`);
  raisons.push(`Espérance du call : ${signe(ev)} par rapport à se coucher.`);
  if (action === 'LIMITE') raisons.push('L’écart est trop faible pour trancher : le coup est presque neutre.');
  if (action === 'SUIVRE' && equite >= Math.min(0.65, 1.6 * partEquitable)) {
    raisons.push('Tu es nettement devant : relancer pour la valeur est à envisager.');
  }
  if (cartesARetourner > 0) {
    raisons.push(
      'Le calcul s’arrête à cette mise : il ne compte ni ce que tu gagneras en plus quand tu touches, ni ce que tu paieras encore quand tu rates.',
    );
  }

  return {
    action,
    titre: ACTIONS[action],
    equite,
    equiteRequise: requise,
    ev,
    cote: aSuivre > 0 ? pot / aSuivre : Infinity,
    potFinal,
    rakePris,
    raisons,
  };
}

/**
 * Tapis ou se coucher, avec des probabilités et une équité déjà connues.
 *
 * @param {object} p
 * @param {number} p.equiteSiSuivi       ton équité quand on te suit (contre la range d'appel)
 * @param {number} p.probaTousSeCouchent probabilité que personne ne suive
 * @param {number} p.pot                 tout ce qui est au milieu maintenant (blindes, antes, ta blinde comprise)
 * @param {number} [p.posteHero]         ce que tu as déjà mis (ta blinde)
 * @param {number} [p.posteAdverse]      ce que l'adversaire qui suit a déjà mis (sa blinde)
 * @param {number} p.tapisHero           ce qu'il te reste derrière
 * @param {number} p.tapisAdverse        ce qu'il reste derrière à l'adversaire qui suit
 */
export function deciderTapis({
  equiteSiSuivi,
  probaTousSeCouchent,
  pot,
  posteHero = 0,
  posteAdverse = 0,
  tapisHero,
  tapisAdverse,
}) {
  for (const [nom, x] of [
    ['Le pot', pot],
    ['Ta mise déjà posée', posteHero],
    ['La mise déjà posée de l’adversaire', posteAdverse],
    ['Ton tapis', tapisHero],
    ['Le tapis adverse', tapisAdverse],
  ]) verifierMontant(nom, x);
  if (posteHero + posteAdverse > pot + 1e-9) {
    throw new Error('Le pot doit contenir au moins ta mise déjà posée et celle de l’adversaire.');
  }
  if (tapisHero <= 0) throw new Error('Ton tapis doit être positif.');

  const engageHero = posteHero + tapisHero;
  const engageAdverse = posteAdverse + tapisAdverse;
  const effectif = Math.min(engageHero, engageAdverse);
  const argentMort = pot - posteHero - posteAdverse;
  const potFinal = argentMort + 2 * effectif;
  const risque = effectif - posteHero;
  const evSiSuivi = equiteSiSuivi * potFinal - risque;
  const pF = probaTousSeCouchent;
  const ev = pF * pot + (1 - pF) * evSiSuivi;
  const requiseSiSuivi = risque / potFinal;

  const raisons = [
    `Tout le monde se couche ${pct(pF, 0)} du temps : tu ramasses ${montant(pot)}.`,
    `Quand on te suit, ton équité est de ${pct(equiteSiSuivi)} (il en faut ${pct(requiseSiSuivi)} pour que le tapis suivi soit rentable à lui seul).`,
    `Quand on te suit, tu risques ${montant(risque)} pour un pot final de ${montant(potFinal)} : espérance ${signe(evSiSuivi)}.`,
    `Espérance du tapis : ${signe(ev)} par rapport à se coucher.`,
  ];
  return {
    action: ev > 0 ? 'TAPIS' : 'SE_COUCHER',
    titre: ev > 0 ? ACTIONS.TAPIS : ACTIONS.SE_COUCHER,
    ev,
    evSiSuivi,
    equiteSiSuivi,
    probaTousSeCouchent: pF,
    potFinal,
    risque,
    raisons,
  };
}

/**
 * Tapis ou se coucher, calculé de bout en bout depuis ta main et la range
 * d'appel des adversaires restant à parler.
 *
 * Hypothèses, dites dans le résultat : les adversaires décident chacun de leur
 * côté, et un seul suit au plus (le cas courant, quand on est court).
 */
export function analyserTapis({ main, rangeAppel, nbAdversaires = 1, iterations = 60_000, graine, tempsMaxMs, ...montants }) {
  if (!Array.isArray(main) || main.length !== 2) throw new Error('Il faut tes deux cartes.');
  if (!(nbAdversaires >= 1)) throw new Error('Il faut au moins un adversaire derrière toi.');
  const appel = retirerBloquees(rangeAppel, main);
  if (appel.length === 0) throw new Error('La range d’appel est vide une fois tes cartes retirées.');
  const frequenceAppel = frequenceRange(appel, main);
  const probaTousSeCouchent = (1 - frequenceAppel) ** nbAdversaires;
  const r = calculerEquite({ joueurs: [[main], appel], iterations, graine, tempsMaxMs });
  const decision = deciderTapis({ equiteSiSuivi: r.joueurs[0].equite, probaTousSeCouchent, ...montants });
  decision.raisons.unshift(
    `Chaque adversaire suit avec ${pct(frequenceAppel)} des mains (${appel.length} combinaisons, tes cartes retirées).`,
  );
  decision.raisons.push('Hypothèses : chaque adversaire décide seul, et un seul suit au plus.');
  return { ...decision, frequenceAppel, calcul: r };
}
