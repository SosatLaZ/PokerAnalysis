// Le bot : ce que jouerait chacun des quatre profils dans une situation donnée.
//
// Il ne voit que ce qu'un joueur voit : ses cartes, le tableau, les mises et
// ce que les adversaires ont fait. Jamais leurs cartes. Il estime leur range
// d'après leurs actions, calcule son équité, et décide selon les seuils de
// son profil. Chaque décision vient avec ses raisons, en français.
//
// La situation (même forme pour la table d'entraînement, le conseiller et
// l'analyse d'historiques) :
// {
//   main: [c1, c2], tableau: [...],             cartes (entiers 0..51)
//   position: 'BTN' | 'SB' | 'BB' | 'UTG' | 'MP' | 'HJ' | 'CO',
//   grosseBlinde,
//   pot,               tout ce qui est au milieu, mises de la rue en cours comprises
//   aSuivre,           ce qu'il faut ajouter pour suivre (0 si personne n'a misé)
//   dejaMise,          ce que tu as déjà mis sur cette rue
//   miseActuelle,      la plus grosse mise de la rue (total)
//   relanceMin,        le total minimum d'une relance
//   peutRelancer,      faux si un tapis trop court n'a pas rouvert les relances
//   tapis,             tes jetons derrière (hors dejaMise)
//   adversaires: [{ nom, position, tapis, mise, profil?, actionPreflop, actionsPostflop: [{ rue, type }] }]
//                      seulement ceux encore dans le coup
//   nbRelancesPreflop, agresseurPreflop ('hero' | nom | null), joueursDerriere
// }
// Montants : « suit » donne ce qu'on ajoute ; « mise », « relance » et
// « tapis » donnent le total de la rue.

import { calculerEquite } from '../moteur/equite.js';
import { classeDeMain, afficherCartes } from '../moteur/cartes.js';
import { creerAleatoire } from '../moteur/aleatoire.js';
import { decrireRange } from '../moteur/ranges.js';
import { pct, montant as fmt, court } from '../moteur/format.js';
import { analyserTapis } from './decision.js';
import { PROFILS, profil as profilParId } from './profils.js';
import { lireMain } from './lecture.js';
import { percentileMain, rangePreflop, affinerRange, rangeEntre, tranchePreflop } from './ranges-adverses.js';

export const LIBELLES_ACTIONS = {
  couche: 'Se coucher',
  parole: 'Checker',
  suit: 'Suivre',
  mise: 'Miser',
  relance: 'Relancer',
  tapis: 'Tapis',
};

const NB_CARTES_RUE = { flop: 3, turn: 4, river: 5 };

/** La décision d'un profil. */
export function deciderBot(situation, idProfil = 'solide', options = {}) {
  const s = normaliser(situation);
  const p = typeof idProfil === 'string' ? profilParId(idProfil) : idProfil;
  const aleatoire = options.aleatoire ?? creerAleatoire(graineDe(s, p));
  const iterations = options.iterations ?? 4000;
  const d = s.tableau.length === 0 ? preflop(s, p, aleatoire, iterations) : postflop(s, p, aleatoire, iterations);
  return { profil: p.id, nomProfil: p.nom, ...d, titre: titre(d.action, d.montant, s) };
}

/** Les quatre profils sur la même situation. */
export function conseillerTous(situation, options = {}) {
  return PROFILS.map((p) => deciderBot(situation, p.id, options));
}

/* ------------------------------------------------------------------ */

function normaliser(x) {
  if (!Array.isArray(x.main) || x.main.length !== 2) throw new Error('Il faut les deux cartes du joueur.');
  const tableau = x.tableau ?? [];
  if (![0, 3, 4, 5].includes(tableau.length)) throw new Error('Le tableau a 0, 3, 4 ou 5 cartes.');
  if (!(x.grosseBlinde > 0)) throw new Error('La grosse blinde doit être positive.');
  const adversaires = (x.adversaires ?? []).filter((a) => !a.couche);
  if (adversaires.length === 0) throw new Error('Il faut au moins un adversaire encore dans le coup.');
  const dejaMise = x.dejaMise ?? 0;
  const aSuivre = Math.max(0, x.aSuivre ?? 0);
  const miseActuelle = x.miseActuelle ?? dejaMise + aSuivre;
  return {
    ...x,
    tableau,
    adversaires,
    position: x.position ?? 'BTN',
    pot: x.pot ?? 0,
    aSuivre,
    dejaMise,
    miseActuelle,
    relanceMin: x.relanceMin ?? (miseActuelle > 0 ? miseActuelle * 2 : x.grosseBlinde),
    peutRelancer: x.peutRelancer ?? true,
    tapis: x.tapis ?? 0,
    nbRelancesPreflop: x.nbRelancesPreflop ?? (tableau.length === 0 && miseActuelle > x.grosseBlinde ? 1 : 0),
    agresseurPreflop: x.agresseurPreflop ?? null,
    joueursDerriere: x.joueursDerriere ?? 0,
  };
}

/** Même situation, même profil → même décision (les fréquences de bluff restent reproductibles). */
function graineDe(s, p) {
  let h = 2166136261;
  const melanger = (n) => {
    h ^= n;
    h = Math.imul(h, 16777619);
  };
  for (const c of [...s.main, ...s.tableau]) melanger(c + 1);
  melanger(Math.round(s.pot * 100));
  melanger(Math.round(s.aSuivre * 100));
  melanger(p.risque);
  return h >>> 0;
}

const arrondir = (x, bb) => (bb >= 2 ? Math.round(x) : Math.round(x * 100) / 100);

function titre(action, montant, s) {
  switch (action) {
    case 'couche': return 'Se coucher';
    case 'parole': return 'Checker';
    case 'suit': return montant >= s.tapis ? `Suivre à tapis (${fmt(montant)})` : `Suivre ${fmt(montant)}`;
    case 'mise': return `Miser ${fmt(montant)}`;
    case 'relance': return `Relancer à ${fmt(montant)}`;
    case 'tapis': return `Tapis (${fmt(montant)})`;
    default: return action;
  }
}

const passer = (s, raisons, extra = {}) =>
  s.aSuivre > 0 ? { action: 'couche', montant: 0, raisons, ...extra } : { action: 'parole', montant: 0, raisons, ...extra };

const suivre = (s, raisons, extra = {}) => ({ action: 'suit', montant: Math.min(s.aSuivre, s.tapis), raisons, ...extra });

/** Mise ou relance à un total visé, bornée par les règles et le tapis ; tapis quand il ne resterait presque rien. */
function attaquer(s, totalVise, raisons, extra = {}) {
  const max = s.dejaMise + s.tapis;
  if (s.aSuivre > 0 && (!s.peutRelancer || s.aSuivre >= s.tapis)) return suivre(s, [...raisons, 'Relancer n’est plus possible : il suit.'], extra);
  const relance = s.miseActuelle > 0;
  const min = relance ? s.relanceMin : s.grosseBlinde;
  const total = Math.min(max, Math.max(min, arrondir(totalVise, s.grosseBlinde)));
  if (total >= max * 0.85 || min >= max) return { action: 'tapis', montant: max, raisons, ...extra };
  return { action: relance ? 'relance' : 'mise', montant: total, raisons, ...extra };
}

/* ------------------------------------------------------------------ */
/* Avant le flop                                                       */
/* ------------------------------------------------------------------ */

function preflop(s, p, aleatoire, iterations) {
  const bb = s.grosseBlinde;
  const pc = percentileMain(s.main);
  const classe = classeDeMain(s.main[0], s.main[1]);
  const totalHero = s.tapis + s.dejaMise;
  const plusGrosAdverse = Math.max(...s.adversaires.map((a) => a.tapis + a.mise));
  const bbEff = Math.min(totalHero, plusGrosAdverse) / bb;
  const raisons = [`${classe} ${placeDansLeClassement(pc, classe)} ; tapis effectif ${court(bbEff)} bb.`];
  const extra = { percentile: pc, bbEffectives: bbEff };

  if (s.nbRelancesPreflop === 0) {
    if (bbEff <= p.tapisCourt.maxBb) return tapisOuRien(s, p, raisons, extra, iterations, aleatoire);
    const limpers = s.adversaires.filter((a) => a.actionPreflop === 'limp').length;
    const base = s.position === 'BB' ? p.troisMise * 2 : p.ouverture[s.position] ?? p.ouverture.CO;
    const seuil = limpers > 0 ? base * 0.6 : base;
    if (pc <= seuil) {
      const taille = (p.tailleOuverture + limpers + (s.position === 'SB' ? 0.5 : 0)) * bb;
      raisons.push(
        limpers > 0
          ? `${p.nom} isole ${limpers} limper${limpers > 1 ? 's' : ''} avec les ${court(seuil)} % meilleures mains.`
          : `${p.nom} ouvre ${s.position === 'BB' ? 'de la grosse blinde' : `en ${s.position}`} avec les ${court(seuil)} % meilleures mains.`,
      );
      return attaquer(s, taille, raisons, extra);
    }
    raisons.push(`Hors des ${court(seuil)} % que ${p.nom} joue à cette place.`);
    return passer(s, raisons, extra);
  }

  // Face à une ou plusieurs relances.
  const agresseur = s.adversaires.reduce((a, b) => (b.mise > a.mise ? b : a));
  const aTapis = agresseur.tapis <= 0;
  const actionAgresseur = aTapis ? 'tapis' : s.nbRelancesPreflop === 1 ? 'ouverture' : s.nbRelancesPreflop === 2 ? 'relance' : 'surrelance';
  const rangeAgresseur = rangePreflop(
    actionAgresseur,
    { position: agresseur.position, profil: agresseur.profil ?? 'solide', bbEffectives: bbEff, pessimisme: p.pessimisme },
    s.main,
  );
  raisons.push(`${agresseur.nom ?? 'L’adversaire'} ${libelleAction(actionAgresseur)} : range estimée ${decrireRange(rangeAgresseur)}.`);

  const appel = Math.min(s.aSuivre, s.tapis);
  const engageBeaucoup = appel >= 0.4 * totalHero;
  if (aTapis || engageBeaucoup || bbEff <= p.tapisCourt.maxBb + 4) {
    return decisionTapisPreflop(s, p, raisons, extra, rangeAgresseur, agresseur, aTapis, iterations, aleatoire);
  }

  if (s.nbRelancesPreflop === 1) {
    const bandeAppel = p.troisMise + p.defense * (s.position === 'BB' ? 1.6 : 1);
    if (pc <= p.troisMise) {
      raisons.push(`${p.nom} sur-relance pour la valeur les ${court(p.troisMise)} % meilleures mains.`);
      return attaquer(s, s.miseActuelle * (['SB', 'BB'].includes(s.position) ? 3.6 : 3), raisons, extra);
    }
    if (pc <= bandeAppel) {
      raisons.push(`Dans sa tranche d’appel (${court(p.troisMise)} à ${court(bandeAppel)} %).`);
      return suivre(s, raisons, extra);
    }
    if (p.troisMiseBluff > 0 && pc <= bandeAppel + p.troisMiseBluff && !s.position.startsWith('UTG')) {
      raisons.push(`${p.nom} sur-relance en bluff juste sous sa tranche d’appel : la main bloque peu et joue bien si on le paie.`);
      return attaquer(s, s.miseActuelle * 3, raisons, extra);
    }
    raisons.push(`Trop faible contre cette relance pour ${p.nom}.`);
    return passer(s, raisons, extra);
  }

  if (pc <= p.quatreMise) {
    raisons.push(`${p.nom} relance encore avec les ${court(p.quatreMise)} % meilleures mains.`);
    return attaquer(s, s.miseActuelle * 2.3, raisons, extra);
  }
  if (pc <= p.quatreMise * 2.5 && appel <= 0.25 * totalHero) {
    raisons.push('Assez forte pour payer, pas pour relancer encore.');
    return suivre(s, raisons, extra);
  }
  raisons.push(`Hors des ${court(p.quatreMise * 2.5)} % qui continuent face à une sur-relance.`);
  return passer(s, raisons, extra);
}

/** « est dans les 14 % meilleures mains » ou « est parmi les 1 % plus faibles mains ». */
function placeDansLeClassement(pc, classe) {
  if (pc <= 50) return `est dans les ${Math.ceil(pc)} % meilleures mains`;
  const part = (classe.length === 2 ? 6 : classe.endsWith('s') ? 4 : 12) / 13.26;
  return `est parmi les ${Math.max(1, Math.round(100 - pc + part))} % plus faibles mains`;
}

const signeCourt = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + court(Math.abs(x));

function libelleAction(action) {
  return {
    ouverture: 'a ouvert',
    relance: 'a sur-relancé',
    surrelance: 'a relancé une sur-relance',
    tapis: 'est à tapis',
    suivi: 'a payé',
    limp: 'a limpé',
  }[action] ?? action;
}

/** Tapis court, personne n'a relancé : tapis ou rien (on ne limpe pas, on ne relance pas petit). */
function tapisOuRien(s, p, raisons, extra, iterations, aleatoire) {
  const bb = s.grosseBlinde;
  const derriere = Math.max(1, s.joueursDerriere || (s.aSuivre > 0 ? 1 : 0));
  if (s.aSuivre === 0 && s.joueursDerriere === 0) {
    // Grosse blinde avec des limpers : on attaque les plus faibles, sinon on regarde le flop gratuitement.
    if (percentileMain(s.main) <= p.troisMise * 3) {
      raisons.push(`${p.nom} part à tapis sur les limpers.`);
      return { action: 'tapis', montant: s.dejaMise + s.tapis, raisons, ...extra };
    }
    raisons.push('Le flop est gratuit.');
    return passer(s, raisons, extra);
  }
  const visibles = [...s.main];
  const [, haut] = tranchePreflop('appel-tapis', { bbEffectives: extra.bbEffectives, pessimisme: p.pessimisme });
  const rangeAppel = rangeEntre(0, haut).filter(([a, b]) => !visibles.includes(a) && !visibles.includes(b));
  const posteAdverse = Math.max(0, ...s.adversaires.map((a) => a.mise));
  const tapisAdverse = Math.max(0, ...s.adversaires.map((a) => a.tapis));
  const r = analyserTapis({
    main: s.main,
    rangeAppel,
    nbAdversaires: derriere,
    pot: s.pot,
    posteHero: s.dejaMise,
    posteAdverse,
    tapisHero: s.tapis,
    tapisAdverse,
    iterations: Math.max(2000, iterations),
    graine: Math.floor(aleatoire() * 2 ** 32),
  });
  const evBb = r.ev / bb;
  raisons.push(
    `Tapis court (${court(extra.bbEffectives)} bb) : tapis ou rien. On suppose qu’un adversaire paie avec les ${court(haut)} % meilleures mains.`,
    `Tout le monde se couche ${pct(r.probaTousSeCouchent, 0)} du temps ; payé, l’équité est de ${pct(r.equiteSiSuivi)}.`,
    `Espérance du tapis : ${signeCourt(evBb)} bb (${p.nom} exige ${signeCourt(p.tapisCourt.margeBb)} bb).`,
  );
  if (evBb >= p.tapisCourt.margeBb) return { action: 'tapis', montant: s.dejaMise + s.tapis, raisons, ...extra, ev: r.ev, equite: r.equiteSiSuivi };
  return passer(s, raisons, { ...extra, ev: r.ev, equite: r.equiteSiSuivi });
}

/** Face à un tapis, ou quand payer engage déjà une grosse part du tapis : payer, partir à tapis, ou se coucher. */
function decisionTapisPreflop(s, p, raisons, extra, rangeAgresseur, agresseur, aTapis, iterations, aleatoire) {
  const appel = Math.min(s.aSuivre, s.tapis);
  const potEffectif = s.pot - (s.aSuivre - appel);
  const requise = appel / (potEffectif + appel);
  const autres = s.adversaires.filter((a) => a !== agresseur).map(() => rangePreflop('suivi', {}, s.main));
  const r = calculerEquite({
    joueurs: [[s.main], rangeAgresseur, ...autres],
    iterations,
    graine: Math.floor(aleatoire() * 2 ** 32),
    limiteExacte: 60_000,
  });
  const eq = r.joueurs[0].equite;
  const evAppel = eq * (potEffectif + appel) - appel;
  raisons.push(`Équité contre sa range : ${pct(eq)} ; la cote demande ${pct(requise)}.`);
  const infos = { ...extra, equite: eq, equiteRequise: requise, ev: evAppel };

  // Partir à tapis par-dessus, quand il reste des jetons à lui faire lâcher.
  if (!aTapis && s.peutRelancer && autres.length === 0) {
    const [, hautAgresseur] = tranchePreflop(s.nbRelancesPreflop === 1 ? 'ouverture' : 'relance', {
      position: agresseur.position,
      profil: agresseur.profil ?? 'solide',
    });
    const [, hautAppel] = tranchePreflop('appel-tapis', { bbEffectives: extra.bbEffectives, pessimisme: p.pessimisme });
    const rangeAppel = rangeEntre(0, Math.min(hautAgresseur * 0.55, hautAppel)).filter(
      ([a, b]) => !s.main.includes(a) && !s.main.includes(b),
    );
    const t = analyserTapis({
      main: s.main,
      rangeAppel,
      nbAdversaires: 1,
      pot: s.pot,
      posteHero: s.dejaMise,
      posteAdverse: agresseur.mise,
      tapisHero: s.tapis,
      tapisAdverse: agresseur.tapis,
      iterations: Math.max(2000, iterations),
      graine: Math.floor(aleatoire() * 2 ** 32),
    });
    // La probabilité qu'il se couche se lit dans sa propre range, pas dans toutes les mains.
    const pSeCouche = 1 - Math.min(1, rangeAppel.length / Math.max(rangeAgresseur.length, 1));
    const evTapis = pSeCouche * s.pot + (1 - pSeCouche) * t.evSiSuivi;
    const evTapisBb = evTapis / s.grosseBlinde;
    if (evTapisBb >= p.tapisCourt.margeBb && evTapis >= Math.max(0, evAppel)) {
      raisons.push(
        `Tapis par-dessus : il se couche ${pct(pSeCouche, 0)} du temps, payé l’équité est de ${pct(t.equiteSiSuivi)} ; espérance ${signeCourt(evTapisBb)} bb.`,
      );
      return { action: 'tapis', montant: s.dejaMise + s.tapis, raisons, ...infos, ev: evTapis };
    }
  }

  const marge = p.margeAppel < 0 && aTapis ? 0 : p.margeAppel;
  if (eq >= requise + marge) {
    raisons.push(`${p.nom} paie : ${pct(eq)} ≥ ${pct(requise)}${marge ? ` + ${pct(marge, 0)} de marge` : ''}.`);
    if (s.tapis <= appel) return { action: 'suit', montant: appel, raisons, ...infos };
    if (eq >= 0.6 && s.peutRelancer) return { action: 'tapis', montant: s.dejaMise + s.tapis, raisons: [...raisons, 'Loin devant : il met tout.'], ...infos };
    return { action: 'suit', montant: appel, raisons, ...infos };
  }
  raisons.push(`${p.nom} se couche : ${pct(eq)} < ${pct(requise + marge)}.`);
  return passer(s, raisons, infos);
}

/* ------------------------------------------------------------------ */
/* Après le flop                                                       */
/* ------------------------------------------------------------------ */

function postflop(s, p, aleatoire, iterations) {
  const lecture = lireMain(s.main, s.tableau);
  const connues = [...s.main, ...s.tableau];
  const bbEff = Math.min(s.tapis + s.dejaMise, Math.max(...s.adversaires.map((a) => a.tapis + a.mise))) / s.grosseBlinde;
  const ranges = s.adversaires.map((a) => {
    const profilAdverse = profilParId(a.profil ?? 'solide');
    let r = rangePreflop(a.actionPreflop ?? 'suivi', { position: a.position, profil: profilAdverse, bbEffectives: bbEff }, connues);
    for (const act of a.actionsPostflop ?? []) {
      const nb = NB_CARTES_RUE[act.rue] ?? s.tableau.length;
      r = affinerRange(r, s.tableau.slice(0, nb), act.type, { frequenceBluff: profilAdverse.frequenceBluff });
    }
    return r;
  });
  const r = calculerEquite({
    joueurs: [[s.main], ...ranges],
    tableau: s.tableau,
    iterations,
    graine: Math.floor(aleatoire() * 2 ** 32),
    limiteExacte: 40_000,
  });
  const eq = r.joueurs[0].equite;
  const n = s.adversaires.length;
  const riviere = s.tableau.length === 5;
  const outs = riviere ? 0 : lecture.tirages.outs;
  const seuilValeur = p.seuilValeur * (2 / (n + 1)) ** 0.6;
  const spr = s.tapis / Math.max(s.pot, 1);

  const raisons = [
    `${afficherCartes(s.main)} sur ${afficherCartes(s.tableau)} : ${lecture.description.charAt(0).toLowerCase()}${lecture.description.slice(1)} ; tableau ${lecture.texture.description}.`,
    n === 1
      ? `Range estimée de ${s.adversaires[0].nom ?? 'l’adversaire'} : ${decrireRange(ranges[0])}.`
      : `${n} adversaires, ranges estimées de ${ranges.map((x) => x.length).join(', ')} combinaisons.`,
    `Équité : ${pct(eq)}.`,
  ];
  const extra = { equite: eq, lecture: lecture.description, force: lecture.force, outs };

  if (s.aSuivre === 0) {
    if (eq >= seuilValeur) {
      const fraction = p.tailleMise * (lecture.texture.sec ? 0.8 : 1.1);
      raisons.push(`Devant la range (${pct(eq)} ≥ ${pct(seuilValeur)}) : ${p.nom} mise pour la valeur${lecture.texture.sec ? '' : ' et pour protéger sa main'}.`);
      if (spr <= 1.3) return { action: 'tapis', montant: s.dejaMise + s.tapis, raisons: [...raisons, 'Tapis faible face au pot : il met tout.'], ...extra };
      return attaquer(s, s.dejaMise + s.pot * fraction, raisons, extra);
    }
    if (outs >= 8 && aleatoire() < p.frequenceSemiBluff) {
      raisons.push(`${outs} outs : ${p.nom} semi-bluffe (${pct(p.frequenceSemiBluff, 0)} du temps avec un gros tirage).`);
      return attaquer(s, s.dejaMise + s.pot * p.tailleMise, raisons, extra);
    }
    if (s.agresseurPreflop === 'hero' && s.tableau.length === 3 && n <= 2) {
      const frequence = Math.min(1, p.frequenceCbet * (lecture.texture.sec ? 1.15 : 0.85));
      if (aleatoire() < frequence) {
        raisons.push(`Continuation : ${p.nom} remise au flop ${pct(frequence, 0)} du temps ${lecture.texture.sec ? 'sur un tableau sec' : 'sur ce tableau'}.`);
        return attaquer(s, s.dejaMise + s.pot * (lecture.texture.sec ? 0.4 : p.tailleMise), raisons, extra);
      }
    }
    if (n === 1 && eq < 0.35 && aleatoire() < p.frequenceBluff) {
      raisons.push(`Bluff : ${p.nom} attaque ${pct(p.frequenceBluff, 0)} du temps quand sa main ne gagne pas à l’abattage.`);
      return attaquer(s, s.dejaMise + s.pot * p.tailleMise, raisons, extra);
    }
    if (outs >= 8) raisons.push('Gros tirage : il prend la carte suivante gratuitement.');
    else if (lecture.force !== 'rien') raisons.push('Assez de valeur pour aller à l’abattage, pas assez pour miser : il checke.');
    else raisons.push('Rien à défendre, pas de bluff cette fois : il checke.');
    return passer(s, raisons, extra);
  }

  const appel = Math.min(s.aSuivre, s.tapis);
  const potEffectif = s.pot - (s.aSuivre - appel);
  const requise = appel / (potEffectif + appel);
  const credit = !riviere && outs >= 8 && s.tapis > 3 * appel ? p.creditTirage : 0;
  const marge = riviere || s.tapis <= appel ? Math.max(0, p.margeAppel) : p.margeAppel;
  const ev = eq * (potEffectif + appel) - appel;
  Object.assign(extra, { equiteRequise: requise, ev });
  raisons.push(`Payer ${fmt(appel)} pour un pot de ${fmt(potEffectif)} : il faut ${pct(requise)}.`);

  const seuilRelance = Math.min(0.9, seuilValeur + 0.15);
  if (eq >= seuilRelance && s.peutRelancer && s.tapis > appel) {
    raisons.push(`Très devant (${pct(eq)}) : ${p.nom} relance pour la valeur.`);
    if (spr <= 1.5) return { action: 'tapis', montant: s.dejaMise + s.tapis, raisons, ...extra };
    return attaquer(s, s.miseActuelle * p.multiplicateurRelance, raisons, extra);
  }
  if (outs >= 8 && n === 1 && s.peutRelancer && s.tapis > appel && aleatoire() < p.frequenceSemiBluff * 0.4) {
    raisons.push(`${outs} outs et de quoi faire coucher : ${p.nom} relance en semi-bluff.`);
    return attaquer(s, s.miseActuelle * p.multiplicateurRelance, raisons, extra);
  }
  if (eq + credit >= requise + marge) {
    const partDuTapis = appel / Math.max(s.tapis, 1);
    if (partDuTapis > 0.33 && eq < p.seuilEngagement && eq + credit < requise + 0.12) {
      raisons.push(
        `${p.nom} refuse d’engager ${pct(partDuTapis, 0)} de son tapis avec ${pct(eq)} d’équité (il en veut ${pct(p.seuilEngagement, 0)}) : moins de variance, un peu d’espérance laissée.`,
      );
      return passer(s, raisons, extra);
    }
    const detail = [];
    if (credit) detail.push(`${pct(credit, 0)} de gains implicites pour le tirage`);
    if (marge > 0) detail.push(`${pct(marge, 0)} de marge exigée`);
    if (marge < 0) detail.push(`${p.nom} accepte ${pct(-marge, 0)} sous la cote quand il reste des jetons à gagner`);
    raisons.push(`${p.nom} paie${detail.length ? ` (${detail.join(', ')})` : ''}.`);
    return suivre(s, raisons, extra);
  }
  raisons.push(`${p.nom} se couche : ${pct(eq)} contre ${pct(requise + marge)} exigés.`);
  return passer(s, raisons, extra);
}
