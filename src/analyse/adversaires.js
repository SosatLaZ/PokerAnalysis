// Les adversaires : qui est assis en face, et comment le jouer.
//
// Pour chaque adversaire vu dans les mains : ses statistiques (VPIP, PFR,
// agression, abattages), les cartes qu'il a montrées, ce que tu as gagné ou
// perdu contre lui, son type de joueur avec un conseil, et les coups où il a
// « fait n'importe quoi » : tapis avant le flop avec une main faible, ou
// gros tapis payé sans la cote.
//
// Les repères dépendent du nombre de joueurs à table : à 3 (Spin & Rush), on
// joue beaucoup plus de mains qu'à 6 ou à 9, et un VPIP de 50 % y est normal.

import { percentileMain as percentileClassement } from '../strategie/ranges-adverses.js';
import { statsJoueur } from './historique.js';
import { calculerEquite } from '../moteur/equite.js';
import { lireRange, retirerBloquees } from '../moteur/ranges.js';
import { classeDeMain, afficherCartes } from '../moteur/cartes.js';
import { pct, signe } from '../moteur/format.js';
import { signeBb } from './rythme.js';

export const MINIMUM_MAINS = 15;

/** Part des mains de départ au moins aussi fortes : AA → 0,005, 72o → 0,98 (le classement du bot, en fraction). */
export const percentileMain = (c1, c2) => percentileClassement([c1, c2]) / 100;

export const TYPES = {
  roc: {
    nom: 'Roc',
    portrait: 'Très serré et passif : n’entre qu’avec les grosses mains.',
    conseil: 'Vole ses blindes sans relâche. Ses relances et ses gros calls disent la vérité : jette tes mains moyennes.',
  },
  tag: {
    nom: 'Régulier serré',
    portrait: 'Peu de mains, jouées en relançant : un joueur solide.',
    conseil: 'Évite les gros coups marginaux face à ce joueur, attaque ses blindes, respecte ses relances.',
  },
  lag: {
    nom: 'Régulier large',
    portrait: 'Beaucoup de mains, presque toujours en relançant.',
    conseil: 'Défends plus large contre ses relances, piège avec tes mains fortes et laisse venir ses bluffs.',
  },
  station: {
    nom: "Station d'appel",
    portrait: 'Paie tout et va souvent jusqu’à l’abattage.',
    conseil: 'Ne bluffe jamais : tout est payé. Mise gros pour la valeur, même avec une paire moyenne.',
  },
  maniaque: {
    nom: 'Maniaque',
    portrait: 'Relance et mise tout le temps, quelle que soit sa main.',
    conseil: 'Laisse venir : paie plus large avec des mains correctes, joue en piège, ne bluffe pas face à ce joueur.',
  },
  poisson: {
    nom: 'Poisson',
    portrait: 'Large et passif : entre dans trop de coups en payant.',
    conseil: 'Isole ce joueur en relançant ses limps, mise pour la valeur à chaque rue, bluffe peu.',
  },
};

/** Les repères de VPIP selon le nombre de joueurs à table. */
export function seuilsPourTable(joueurs) {
  if (joueurs <= 3) return { serre: 0.35, large: 0.55, table: 'à 3 joueurs ou moins' };
  if (joueurs <= 6) return { serre: 0.18, large: 0.3, table: 'à 6 joueurs ou moins' };
  return { serre: 0.14, large: 0.25, table: 'à plus de 6 joueurs' };
}

/**
 * Le type d'un joueur d'après ses statistiques.
 * @param {{ mains:number, vpip:number, pfr:number, af:number, wtsd:number, joueursParTable:number }} s
 */
export function classerJoueur(s, { minimum = MINIMUM_MAINS } = {}) {
  if (!(s.mains >= minimum)) {
    return {
      id: null,
      nom: 'Pas assez de mains',
      portrait: `${s.mains} main${s.mains > 1 ? 's' : ''} seulement : il en faut ${minimum} pour classer ce joueur.`,
      conseil: 'Observe encore avant de t’adapter.',
    };
  }
  const { serre, large } = seuilsPourTable(s.joueursParTable);
  const ratio = s.vpip > 0 ? s.pfr / s.vpip : 0;
  const af = Number.isFinite(s.af) ? s.af : s.af === Infinity ? 99 : 0;
  const wtsd = Number.isFinite(s.wtsd) ? s.wtsd : 0;

  let id;
  if (s.vpip > large && ratio >= 0.7 && af >= 3) id = 'maniaque';
  else if (s.vpip > serre && af < 1.2 && wtsd > 0.38) id = 'station';
  else if (s.vpip > large && ratio < 0.45) id = 'poisson';
  else if (s.vpip > large) id = 'lag';
  else if (s.vpip < serre && (ratio < 0.5 || af < 1.5)) id = 'roc';
  else if (ratio < 0.45) id = 'poisson';
  else id = 'tag';
  return { id, ...TYPES[id] };
}

function nouvelleFiche(nom) {
  return {
    nom,
    mains: 0,
    vpip: 0,
    pfr: 0,
    vuFlop: 0,
    abattages: 0,
    abattagesGagnes: 0,
    agressions: 0,
    appels: 0,
    resultat: 0,
    resultatBb: 0,
    joueursCumules: 0,
    montrees: [],
    contreToi: { mains: 0, resultat: 0, resultatBb: 0 },
    nImporteQuoi: [],
  };
}

/** La range qu'on prête à un tapis, selon sa profondeur : plus on est court, plus on pousse large. */
export function rangeDeTapis(tapisBb) {
  if (tapisBb <= 10) return '50%';
  if (tapisBb <= 20) return '30%';
  return '15%';
}

/**
 * @param {Array} mains   mains lues par lireHistorique
 * @param {object} [options]
 * @param {string} [options.hero]
 * @param {number} [options.minimum]          mains avant de classer un joueur
 * @param {number} [options.iterations]       tirages pour juger un call de tapis
 * @param {number} [options.tapisLibreBb]     au-delà de ce tapis (en bb), pousser une main faible est une faute
 * @param {number} [options.mainFaible]       percentile à partir duquel une main est « faible » (0,6 = hors des 60 % meilleures)
 * @param {number} [options.ecart]            écart d'équité sous la cote qui fait d'un call une faute
 */
export function analyserAdversaires(mains, options = {}) {
  const {
    minimum = MINIMUM_MAINS,
    iterations = 3000,
    graine = 1,
    tapisLibreBb = 15,
    mainFaible = 0.6,
    ecart = 0.1,
    gros = 10,
  } = options;
  const hero = options.hero ?? mains.find((m) => m.hero)?.hero ?? null;
  const fiches = new Map();
  const fiche = (nom) => {
    if (!fiches.has(nom)) fiches.set(nom, nouvelleFiche(nom));
    return fiches.get(nom);
  };

  for (const main of mains) {
    const participants = [...new Set(main.actions.map((a) => a.joueur))];
    const bb = main.grosseBlinde > 0 ? main.grosseBlinde : NaN;
    const statsHero = hero ? statsJoueur(main, hero) : null;
    const volontaires = participants.filter((nom) => statsJoueur(main, nom).vpip);

    for (const nom of participants) {
      if (nom === hero) continue;
      const f = fiche(nom);
      const s = statsJoueur(main, nom);
      f.mains++;
      f.joueursCumules += participants.length;
      if (s.vpip) f.vpip++;
      if (s.pfr) f.pfr++;
      if (s.vuFlop) f.vuFlop++;
      if (s.abattage) f.abattages++;
      if (s.abattageGagne) f.abattagesGagnes++;
      f.agressions += s.agressions;
      f.appels += s.appels;
      f.resultat += s.resultat;
      if (Number.isFinite(bb)) f.resultatBb += s.resultat / bb;

      // Un coup entre toi et lui seuls (les autres n'ont mis que leurs blindes).
      if (statsHero && s.vpip && statsHero.vpip && volontaires.length === 2) {
        f.contreToi.mains++;
        f.contreToi.resultat += statsHero.resultat;
        if (Number.isFinite(bb)) f.contreToi.resultatBb += statsHero.resultat / bb;
      }

      const cartes = main.montrees[nom];
      if (cartes) {
        f.montrees.push({ id: main.id, cartes: afficherCartes(cartes), classe: classeDeMain(...cartes), percentile: percentileMain(...cartes) });
        f.nImporteQuoi.push(...fautesMontrees(main, nom, cartes, { bb, hero, tapisLibreBb, mainFaible, ecart, gros, iterations, graine }));
      }
    }
  }

  const adversaires = [...fiches.values()]
    .map((f) => {
      const stats = {
        mains: f.mains,
        vpip: f.mains ? f.vpip / f.mains : NaN,
        pfr: f.mains ? f.pfr / f.mains : NaN,
        af: f.appels ? f.agressions / f.appels : f.agressions > 0 ? Infinity : NaN,
        wtsd: f.vuFlop ? f.abattages / f.vuFlop : NaN,
        wsd: f.abattages ? f.abattagesGagnes / f.abattages : NaN,
        joueursParTable: f.mains ? f.joueursCumules / f.mains : NaN,
      };
      return {
        nom: f.nom,
        ...stats,
        resultat: Math.round(f.resultat * 100) / 100,
        resultatBb: Math.round(f.resultatBb * 10) / 10,
        type: classerJoueur(stats, { minimum }),
        reperes: seuilsPourTable(stats.joueursParTable),
        montrees: f.montrees,
        contreToi: {
          mains: f.contreToi.mains,
          resultat: Math.round(f.contreToi.resultat * 100) / 100,
          resultatBb: Math.round(f.contreToi.resultatBb * 10) / 10,
        },
        nImporteQuoi: f.nImporteQuoi,
      };
    })
    .sort((a, b) => b.mains - a.mains || a.nom.localeCompare(b.nom));

  return {
    hero,
    adversaires,
    nImporteQuoi: adversaires.flatMap((a) => a.nImporteQuoi),
  };
}

/** Les coups absurdes d'un joueur dont on connaît les cartes. */
function fautesMontrees(main, nom, cartes, { bb, hero, tapisLibreBb, mainFaible, ecart, gros, iterations, graine }) {
  const fautes = [];
  if (!Number.isFinite(bb)) return fautes;
  const p = percentileMain(...cartes);
  const montre = afficherCartes(cartes);

  for (const m of main.mises.filter((x) => x.joueur === nom)) {
    const tapisBb = m.tapisDepart / bb;

    // 1. Tapis avant le flop avec une main faible, alors qu'il avait de la marge.
    if (m.rue === 'preflop' && m.tapis && (m.type === 'relance' || m.type === 'mise') && tapisBb > tapisLibreBb && p > mainFaible) {
      fautes.push({
        id: main.id,
        joueur: nom,
        genre: 'tapis-faible',
        texte: `Tapis avant le flop avec ${montre} à ${Math.round(tapisBb)} bb : une main hors des ${Math.round(mainFaible * 100)} % meilleures, avec assez de jetons pour attendre.`,
      });
    }

    // 2. Un gros tapis payé sans la cote.
    if (m.type === 'suit' && m.finDesMises && m.aSuivre >= gros * bb && m.agresseur) {
      const tapisAgresseur = main.joueurs.find((j) => j.nom === m.agresseur)?.tapis ?? NaN;
      const effectif = Math.min(tapisAgresseur, m.tapisDepart) / bb;
      const texteRange = rangeDeTapis(effectif);
      // Cartes connues retirées : les siennes, le tableau, et celles du héros s'il n'est pas l'agresseur.
      const connues = [...cartes, ...m.tableau];
      if (hero && m.agresseur !== hero && main.cartesHero) connues.push(...main.cartesHero);
      const range = retirerBloquees(lireRange(texteRange), connues);
      if (range.length === 0) continue;
      const mortes = hero && m.agresseur !== hero && main.cartesHero ? main.cartesHero : [];
      const r = calculerEquite({ joueurs: [[cartes], range], tableau: m.tableau, mortes, iterations, graine, limiteExacte: 60_000 });
      const equite = r.joueurs[0].equite;
      const requise = m.aSuivre / (m.pot + m.aSuivre);
      if (equite < requise - ecart) {
        fautes.push({
          id: main.id,
          joueur: nom,
          genre: 'call-sans-cote',
          texte: `Paie un tapis de ${Math.round(m.aSuivre / bb)} bb avec ${montre}${m.tableau.length ? ` sur ${afficherCartes(m.tableau)}` : ''} : ${pct(equite, 0)} d'équité contre un tapis de ${texteRange}, il en fallait ${pct(requise, 0)}.`,
          equite,
          requise,
        });
      }
    }
  }
  return fautes;
}

/** Les lignes de texte des adversaires, pour le terminal. */
export function formaterAdversaires(r) {
  const l = [];
  if (!r || r.adversaires.length === 0) return l;
  l.push('Adversaires');
  for (const a of r.adversaires) {
    const af = Number.isFinite(a.af) ? a.af.toFixed(1).replace('.', ',') : a.af === Infinity ? '∞' : '—';
    l.push(
      `  ${a.nom} — ${a.mains} mains · VPIP ${pct(a.vpip, 0)} · PFR ${pct(a.pfr, 0)} · Agression ${af} · Abattage ${pct(a.wtsd, 0)} → ${a.type.nom}`,
    );
    l.push(`     ${a.type.portrait} ${a.type.conseil}`);
    if (a.contreToi.mains > 0) {
      l.push(
        `     Tes coups à deux face à ce joueur : ${signe(a.contreToi.resultat)} (${signeBb(a.contreToi.resultatBb)} bb) sur ${a.contreToi.mains} coup${a.contreToi.mains > 1 ? 's' : ''}.`,
      );
    }
    if (a.montrees.length > 0) l.push(`     Cartes montrées : ${a.montrees.map((m) => m.cartes).join(', ')}`);
  }
  if (r.nImporteQuoi.length > 0) {
    l.push('');
    l.push('Ils font n’importe quoi');
    for (const f of r.nImporteQuoi) l.push(`  #${f.id} ${f.joueur} : ${f.texte}`);
  }
  return l;
}
