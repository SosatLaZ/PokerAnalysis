// La détection, après la session : où part l'argent ?
//
// À partir des mains lues par historique.js :
//   1. Les statistiques du héros (VPIP, PFR, agression, abattages) et les
//      fuites qu'elles trahissent.
//   2. Les tapis : ce que tu aurais dû gagner selon ton équité au moment où
//      l'argent est parti au milieu, contre ce que tu as vraiment gagné.
//      L'écart, c'est la chance — pas ton jeu.
//   3. Les décisions suivre / se coucher face à une mise : ton équité contre
//      une range supposée, comparée à la cote du pot. On ne juge que les coups
//      où ce calcul a un sens : après le flop, ou quand l'appel clôt les mises.
//
// Tout ce qui dépend d'une hypothèse (la range supposée, les seuils de
// fuite pour du 6-max) le dit dans le rapport.

import { calculerEquite } from '../moteur/equite.js';
import { lireRange, retirerBloquees } from '../moteur/ranges.js';
import { afficherCartes } from '../moteur/cartes.js';
import { pct, montant, signe } from '../moteur/format.js';

export const SEUILS_6MAX = {
  vpipMax: 32,
  vpipMin: 15,
  ratioPfrMin: 0.6,
  afMin: 1.5,
  afMax: 5,
  wtsdMax: 33,
  wsdMin: 45,
};

const ECHANTILLON_FIABLE = 300;

const virgule = (x) => String(x).replace('.', ',');

function nouvelleStat() {
  return { mains: 0, vpip: 0, pfr: 0, vuFlop: 0, abattages: 0, abattagesGagnes: 0, agressions: 0, appels: 0, resultat: 0, resultatBb: 0, mainsBb: 0 };
}

/** Les chiffres du héros sur une main. */
function statsDeMain(main) {
  const h = main.hero;
  const siennes = main.actions.filter((a) => a.joueur === h);
  const preflop = siennes.filter((a) => a.rue === 'preflop' && a.type !== 'poste');
  const postflop = siennes.filter((a) => a.rue !== 'preflop');
  const coucheAvantFlop = preflop.some((a) => a.type === 'couche');
  const vuFlop = !coucheAvantFlop && main.tableau.length >= 3;
  const encoreLa = main.restants.includes(h);
  const abattage = encoreLa && main.restants.length >= 2;
  const gains = main.gains[h] ?? 0;
  const resultat = gains - (main.investi[h] ?? 0);
  return {
    vpip: preflop.some((a) => a.type === 'suit' || a.type === 'relance' || a.type === 'mise'),
    pfr: preflop.some((a) => a.type === 'relance' || a.type === 'mise'),
    vuFlop,
    abattage,
    abattageGagne: abattage && gains > 0,
    agressions: postflop.filter((a) => a.type === 'mise' || a.type === 'relance').length,
    appels: postflop.filter((a) => a.type === 'suit').length,
    resultat,
  };
}

function ajouter(stat, s, main) {
  stat.mains++;
  if (s.vpip) stat.vpip++;
  if (s.pfr) stat.pfr++;
  if (s.vuFlop) stat.vuFlop++;
  if (s.abattage) stat.abattages++;
  if (s.abattageGagne) stat.abattagesGagnes++;
  stat.agressions += s.agressions;
  stat.appels += s.appels;
  stat.resultat += s.resultat;
  if (main.grosseBlinde > 0) {
    stat.resultatBb += s.resultat / main.grosseBlinde;
    stat.mainsBb++;
  }
}

function ratios(stat) {
  return {
    mains: stat.mains,
    vpip: stat.mains ? stat.vpip / stat.mains : NaN,
    pfr: stat.mains ? stat.pfr / stat.mains : NaN,
    af: stat.appels ? stat.agressions / stat.appels : stat.agressions > 0 ? Infinity : NaN,
    wtsd: stat.vuFlop ? stat.abattages / stat.vuFlop : NaN,
    wsd: stat.abattages ? stat.abattagesGagnes / stat.abattages : NaN,
    resultat: stat.resultat,
    bb100: stat.mainsBb ? (stat.resultatBb / stat.mainsBb) * 100 : NaN,
  };
}

/** L'équité du héros au moment où le dernier argent est entré, contre les cartes montrées. */
function analyserTapis(main) {
  const h = main.hero;
  if (!main.tapisEngage || main.doubleTirage || main.restants.length !== 2 || !main.restants.includes(h)) return null;
  const adversaire = main.restants.find((n) => n !== h);
  const cartesAdverses = main.montrees[adversaire];
  if (!main.cartesHero || !cartesAdverses) return null;
  const nbCartes = { preflop: 0, flop: 3, turn: 4, river: 5 }[main.derniereRueAvecMise];
  if (nbCartes === undefined || nbCartes === 5 || main.tableau.length < 5) return null;
  const distribue = Object.values(main.gains).reduce((s, g) => s + g, 0);
  if (!(distribue > 0)) return null;

  const tableau = main.tableau.slice(0, nbCartes);
  const r = calculerEquite({ joueurs: [[main.cartesHero], [cartesAdverses]], tableau });
  const equite = r.joueurs[0].equite;
  const investi = main.investi[h] ?? 0;
  const attendu = equite * distribue - investi;
  const reel = (main.gains[h] ?? 0) - investi;
  return {
    id: main.id,
    rue: main.derniereRueAvecMise,
    hero: afficherCartes(main.cartesHero),
    adversaire,
    cartesAdverses: afficherCartes(cartesAdverses),
    tableau: afficherCartes(tableau),
    equite,
    attendu,
    reel,
    chance: reel - attendu,
    grosseBlinde: main.grosseBlinde,
  };
}

/**
 * @param {Array} mains           mains lues par lireHistorique
 * @param {object} [options]
 * @param {string} [options.rangeAdverse]   range prêtée à l'adversaire qui mise (défaut « 30% »)
 * @param {string} [options.hero]           nom du héros si les mains en ont plusieurs
 * @param {number} [options.iterations]     tirages par décision
 * @param {number} [options.ecartErreur]    écart d'équité (0,10 = 10 points) à partir duquel on signale
 * @param {object} [options.seuils]         seuils de fuites (défaut : 6-max)
 */
export function analyserSession(mains, options = {}) {
  const {
    rangeAdverse = '30%',
    iterations = 4000,
    ecartErreur = 0.1,
    seuils = SEUILS_6MAX,
    graine = 1,
  } = options;
  const range = lireRange(rangeAdverse);

  const heros = new Map();
  for (const m of mains) if (m.hero) heros.set(m.hero, (heros.get(m.hero) ?? 0) + 1);
  const hero = options.hero ?? [...heros.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const avertissements = [];
  if (!hero) {
    return {
      hero: null,
      nbMains: 0,
      avertissements: ['Aucune main ne montre tes cartes (ligne « Dealt to Toi [Ah Kd] ») : rien à analyser.'],
      fuites: [],
      stats: null,
      parPosition: {},
      tapis: { mains: [], attendu: 0, reel: 0, chance: 0 },
      decisions: { evaluees: 0, erreurs: [] },
    };
  }
  if (heros.size > 1 && !options.hero) {
    avertissements.push(`Plusieurs héros dans le fichier (${[...heros.keys()].join(', ')}) : analyse de ${hero}.`);
  }

  const siennes = mains.filter((m) => m.hero === hero && m.cartesHero);
  const total = nouvelleStat();
  const parPosition = {};
  const tapis = [];
  const erreurs = [];
  let evaluees = 0;

  for (const main of siennes) {
    const s = statsDeMain(main);
    ajouter(total, s, main);
    if (main.positionHero) ajouter((parPosition[main.positionHero] ??= nouvelleStat()), s, main);

    const t = analyserTapis(main);
    if (t) tapis.push(t);

    for (const d of main.decisions) {
      if (d.rue === 'preflop' && !d.finDesMises) continue;
      if (d.nbAdversaires < 1) continue;
      const connues = [...main.cartesHero, ...d.tableau];
      const adverse = retirerBloquees(range, connues);
      if (adverse.length === 0) continue;
      const joueurs = [[main.cartesHero], ...Array.from({ length: d.nbAdversaires }, () => adverse)];
      const r = calculerEquite({ joueurs, tableau: d.tableau, iterations, graine, limiteExacte: 50_000 });
      const equite = r.joueurs[0].equite;
      const requise = d.aSuivre / (d.pot + d.aSuivre);
      evaluees++;
      const ecart = equite - requise;
      const faute =
        (d.action === 'couche' && ecart >= ecartErreur) || (d.action === 'suit' && ecart <= -ecartErreur);
      if (faute) {
        erreurs.push({
          id: main.id,
          rue: d.rue,
          action: d.action === 'couche' ? 'Couché' : 'Payé',
          main: afficherCartes(main.cartesHero),
          tableau: afficherCartes(d.tableau),
          pot: d.pot,
          aSuivre: d.aSuivre,
          equite,
          requise,
          ecart,
          // Ce que la décision a coûté en moyenne, en jetons ou en euros.
          cout: Math.abs(equite * (d.pot + d.aSuivre) - d.aSuivre),
        });
      }
    }
  }

  const stats = ratios(total);
  const fuites = detecterFuites(stats, seuils);
  const sommeTapis = tapis.reduce(
    (acc, t) => ({ attendu: acc.attendu + t.attendu, reel: acc.reel + t.reel, chance: acc.chance + t.chance }),
    { attendu: 0, reel: 0, chance: 0 },
  );
  erreurs.sort((a, b) => b.cout - a.cout);

  if (stats.mains < ECHANTILLON_FIABLE) {
    avertissements.push(
      `${stats.mains} mains seulement : les statistiques bougent encore beaucoup (fiables vers ${ECHANTILLON_FIABLE} mains et plus).`,
    );
  }
  const coutErreurs = erreurs.reduce((s, e) => s + e.cout, 0);
  if (erreurs.length > 0) {
    fuites.push({
      gravite: erreurs.length >= 3 ? 'forte' : 'moyenne',
      titre: `${erreurs.length} décision${erreurs.length > 1 ? 's' : ''} suivre / se coucher contraire${erreurs.length > 1 ? 's' : ''} à la cote du pot`,
      detail: `Coût estimé : ${montant(coutErreurs)}, contre une range supposée de « ${rangeAdverse} ». Détail plus bas.`,
    });
  }
  if (tapis.length > 0 && Math.abs(sommeTapis.chance) > 0) {
    fuites.push({
      gravite: 'info',
      titre: sommeTapis.chance < 0 ? 'Malchance sur les tapis' : 'Chance sur les tapis',
      detail: `Sur ${tapis.length} tapis montrés, tu devais faire ${signe(sommeTapis.attendu)} et tu as fait ${signe(sommeTapis.reel)} : ${signe(sommeTapis.chance)} dus au hasard, pas à ton jeu.`,
    });
  }

  return {
    hero,
    nbMains: siennes.length,
    stats,
    fuites,
    parPosition: Object.fromEntries(Object.entries(parPosition).map(([p, s]) => [p, ratios(s)])),
    tapis: { mains: tapis, ...sommeTapis },
    decisions: { evaluees, erreurs, rangeAdverse },
    avertissements,
  };
}

/** Compare les statistiques aux repères d'un joueur gagnant en 6-max. */
export function detecterFuites(stats, seuils = SEUILS_6MAX) {
  const fuites = [];
  const v = stats.vpip * 100;
  const p = stats.pfr * 100;
  if (Number.isFinite(v) && v > seuils.vpipMax) {
    fuites.push({
      gravite: v > seuils.vpipMax + 10 ? 'forte' : 'moyenne',
      titre: 'Tu joues trop de mains',
      detail: `VPIP de ${pct(stats.vpip, 0)} (repère : ${seuils.vpipMin} à ${seuils.vpipMax} %). Jette davantage de mains faibles avant le flop, surtout hors position.`,
    });
  } else if (Number.isFinite(v) && v < seuils.vpipMin && stats.mains >= 50) {
    fuites.push({
      gravite: 'moyenne',
      titre: 'Tu joues trop peu de mains',
      detail: `VPIP de ${pct(stats.vpip, 0)} (repère : ${seuils.vpipMin} à ${seuils.vpipMax} %). Les adversaires te lisent facilement ; ouvre davantage au bouton et au cut-off.`,
    });
  }
  if (Number.isFinite(v) && v > 0 && p / v < seuils.ratioPfrMin) {
    fuites.push({
      gravite: p / v < seuils.ratioPfrMin - 0.2 ? 'forte' : 'moyenne',
      titre: 'Trop de calls avant le flop',
      detail: `Tu relances ${pct(stats.pfr, 0)} des mains pour ${pct(stats.vpip, 0)} jouées. Une main qui vaut d'être jouée vaut souvent d'être relancée : limper et payer coûtent cher.`,
    });
  }
  if (Number.isFinite(stats.af) && stats.af < seuils.afMin) {
    fuites.push({
      gravite: 'moyenne',
      titre: 'Trop passif après le flop',
      detail: `Facteur d'agression de ${stats.af.toFixed(1).replace('.', ',')} (repère : ${virgule(seuils.afMin)} à ${virgule(seuils.afMax)}). Tu paies plus que tu ne mises : mise tes mains fortes et tes bons tirages.`,
    });
  } else if (stats.af > seuils.afMax && Number.isFinite(stats.af)) {
    fuites.push({
      gravite: 'moyenne',
      titre: 'Agressivité excessive après le flop',
      detail: `Facteur d'agression de ${stats.af.toFixed(1).replace('.', ',')} (repère : ${virgule(seuils.afMin)} à ${virgule(seuils.afMax)}). Tes bluffs deviennent prévisibles.`,
    });
  }
  if (Number.isFinite(stats.wtsd) && stats.wtsd * 100 > seuils.wtsdMax) {
    const perd = Number.isFinite(stats.wsd) && stats.wsd * 100 < seuils.wsdMin;
    fuites.push({
      gravite: perd ? 'forte' : 'moyenne',
      titre: perd ? 'Tu paies trop jusqu’à l’abattage, et tu y perds' : 'Tu vas souvent à l’abattage',
      detail: `Abattage ${pct(stats.wtsd, 0)} des flops vus (repère : moins de ${seuils.wtsdMax} %), gagné ${pct(stats.wsd, 0)} du temps (repère : plus de ${seuils.wsdMin} %).`,
    });
  } else if (Number.isFinite(stats.wsd) && stats.wsd * 100 < seuils.wsdMin && stats.mains >= 50) {
    fuites.push({
      gravite: 'moyenne',
      titre: 'Tu perds trop souvent à l’abattage',
      detail: `Gagné ${pct(stats.wsd, 0)} des abattages (repère : plus de ${seuils.wsdMin} %). Tes calls de rivière sont trop légers.`,
    });
  }
  return fuites;
}

/** Le rapport en texte, pour le terminal. */
export function formaterRapport(r) {
  const l = [];
  if (!r.hero) return r.avertissements.join('\n');
  const s = r.stats;
  l.push(`Analyse de ${r.hero} — ${r.nbMains} mains`);
  l.push('');
  l.push(`Résultat : ${signe(s.resultat)}${Number.isFinite(s.bb100) ? `  (${signe(s.bb100)} bb/100)` : ''}`);
  l.push(
    `VPIP ${pct(s.vpip, 0)} · PFR ${pct(s.pfr, 0)} · Agression ${Number.isFinite(s.af) ? s.af.toFixed(1).replace('.', ',') : '—'} · Abattage ${pct(s.wtsd, 0)} · Gagné à l'abattage ${pct(s.wsd, 0)}`,
  );
  for (const a of r.avertissements) l.push(`! ${a}`);
  l.push('');
  l.push('Fuites détectées');
  if (r.fuites.length === 0) l.push('  Aucune fuite nette sur cet échantillon.');
  for (const f of r.fuites) {
    const marque = f.gravite === 'forte' ? '!!' : f.gravite === 'moyenne' ? ' !' : ' ·';
    l.push(`${marque} ${f.titre}`);
    l.push(`   ${f.detail}`);
  }
  const positions = Object.entries(r.parPosition);
  if (positions.length > 0) {
    l.push('');
    l.push('Par position');
    const ordre = ['UTG', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    positions.sort((a, b) => ordre.indexOf(a[0]) - ordre.indexOf(b[0]));
    for (const [p, st] of positions) {
      l.push(`  ${p.padEnd(4)} ${String(st.mains).padStart(5)} mains · VPIP ${pct(st.vpip, 0).padStart(6)} · ${signe(st.resultat)}`);
    }
  }
  if (r.tapis.mains.length > 0) {
    l.push('');
    l.push(`Tapis montrés : attendu ${signe(r.tapis.attendu)}, réel ${signe(r.tapis.reel)}, chance ${signe(r.tapis.chance)}`);
    for (const t of r.tapis.mains) {
      l.push(
        `  #${t.id} ${t.hero} contre ${t.cartesAdverses} (${t.tableau || 'préflop'}) : équité ${pct(t.equite)}, attendu ${signe(t.attendu)}, réel ${signe(t.reel)}`,
      );
    }
  }
  l.push('');
  l.push(`Décisions suivre / se coucher évaluées : ${r.decisions.evaluees} (range supposée : ${r.decisions.rangeAdverse})`);
  for (const e of r.decisions.erreurs) {
    l.push(
      `  #${e.id} ${e.rue} : ${e.action} avec ${e.main}${e.tableau ? ` sur ${e.tableau}` : ''} — équité ${pct(e.equite)}, il fallait ${pct(e.requise)} (${montant(e.aSuivre)} pour ${montant(e.pot)})`,
    );
  }
  return l.join('\n');
}
