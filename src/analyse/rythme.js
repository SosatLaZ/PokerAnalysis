// Le rythme : le temps que tu mets, et ce qu'il trahit.
//
// À partir de l'heure écrite dans l'en-tête de chaque main :
//   - les sessions (une coupure de plus de 15 minutes en ouvre une nouvelle),
//     leur durée, les mains par heure, le temps passé sur chaque main ;
//   - le multi-tabling (plusieurs tables ouvertes en même temps) ;
//   - la fatigue (la première heure de session contre la suite) et l'heure
//     de la journée ;
//   - le tilt : après une grosse perte, joues-tu plus de mains, plus vite,
//     et moins bien ?
//
// L'heure d'une main est celle de la salle, sans conversion de fuseau (voir
// lireHorodatage) : on lit donc les heures avec getUTCHours().
// Le temps passé sur une main est l'écart avec la main suivante de la même
// table : c'est la seule mesure qu'un historique permet.

import { statsJoueur } from './historique.js';
import { pct, signe } from '../moteur/format.js';

export const COUPURE_MIN = 15;
export const GROSSE_PERTE_BB = 20;
export const GROSSE_PERTE_TAPIS = 0.5;
export const MAINS_APRES_PERTE = 15;
export const TAPIS_COURT_BB = 10;
const MINIMUM_COMPARAISON = 5;

const deux = (n) => String(n).padStart(2, '0');

/** ms (heure de la salle) → « 20:05 ». */
export function heureDe(ms) {
  const d = new Date(ms);
  return `${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}`;
}

/** ms → « 21/10/2026 20:05 ». */
export function dateHeureDe(ms) {
  const d = new Date(ms);
  return `${deux(d.getUTCDate())}/${deux(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${heureDe(ms)}`;
}

const arrondi = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** « 3 mains », « 1 main ». */
export const pluriel = (n, mot) => `${n} ${mot}${Math.abs(n) >= 2 ? 's' : ''}`;

/** −81,5 → « −81,5 », 2 → « +2 » : grosses blindes à une décimale. */
export function signeBb(x) {
  if (!Number.isFinite(x)) return '—';
  const r = Math.round(x * 10) / 10;
  if (r === 0) return '0';
  return (r > 0 ? '+' : '−') + String(Math.abs(r)).replace('.', ',');
}

const secondes = (x) => `${String(x).replace('.', ',')} s`;

function moyenne(valeurs) {
  return valeurs.length ? valeurs.reduce((s, v) => s + v, 0) / valeurs.length : NaN;
}

function mediane(valeurs) {
  if (valeurs.length === 0) return NaN;
  const t = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

/** La table d'une main : nom de table, sinon tournoi, sinon une seule table. */
const cleTable = (main) => [main.idTournoi, main.table].filter(Boolean).join(' · ') || 'table';

/**
 * @param {Array} mains   mains lues par lireHistorique
 * @param {object} [options]
 * @param {string} [options.hero]
 * @param {number} [options.coupureMin]          minutes sans main qui ouvrent une nouvelle session
 * @param {number} [options.grossePerteBb]       perte (en grosses blindes) qui déclenche la surveillance du tilt
 * @param {number} [options.grossePerteTapis]    ou perte d'au moins cette part du tapis (formats courts : Spin)
 * @param {number} [options.mainsApresPerte]     mains surveillées après la perte
 * @param {number} [options.tapisCourtBb]        sous ce tapis, la main est écartée de la comparaison du tilt
 */
export function analyserRythme(mains, options = {}) {
  const {
    coupureMin = COUPURE_MIN,
    grossePerteBb = GROSSE_PERTE_BB,
    grossePerteTapis = GROSSE_PERTE_TAPIS,
    mainsApresPerte = MAINS_APRES_PERTE,
    tapisCourtBb = TAPIS_COURT_BB,
  } = options;
  const hero = options.hero ?? mains.find((m) => m.hero)?.hero ?? null;
  const siennes = mains.filter((m) => hero && m.hero === hero && m.cartesHero);
  const avecHeure = siennes.filter((m) => Number.isFinite(m.horodatage));
  const avertissements = [];

  const rapport = {
    disponible: avecHeure.length > 0,
    hero,
    nbMains: siennes.length,
    nbMainsHorodatees: avecHeure.length,
    sessions: [],
    mainsParHeure: NaN,
    dureeTotaleMin: 0,
    cadence: null,
    multiTable: null,
    fatigue: null,
    parHeureDuJour: [],
    tilt: null,
    avertissements,
  };
  if (siennes.length === 0) {
    avertissements.push('Aucune main du héros : pas de rythme à mesurer.');
    return rapport;
  }

  // Les mains dans l'ordre du temps (tri stable : à heure égale, l'ordre du fichier).
  const toutesHorodatees = avecHeure.length === siennes.length;
  const ordre = toutesHorodatees ? [...siennes].sort((a, b) => a.horodatage - b.horodatage) : siennes;
  const lignes = ordre.map((main) => {
    const s = statsJoueur(main, hero);
    const bb = main.grosseBlinde > 0 ? main.grosseBlinde : NaN;
    const tapis = main.joueurs.find((j) => j.nom === hero)?.tapis ?? NaN;
    return {
      main,
      stats: s,
      bb,
      resultatBb: s.resultat / bb,
      tapisBb: tapis / bb,
      tapis,
      duree: null, // secondes jusqu'à la main suivante de la même table
      session: null,
    };
  });

  if (avecHeure.length === 0) {
    avertissements.push(
      'Aucune main n’a d’heure lisible dans son en-tête : ni sessions, ni cadence, ni multi-table. Le tilt est mesuré dans l’ordre du fichier, sans la cadence.',
    );
  } else if (!toutesHorodatees) {
    avertissements.push(
      `${siennes.length - avecHeure.length} main(s) sans heure lisible : les mesures de temps portent sur les ${avecHeure.length} autres, le tilt suit l'ordre du fichier.`,
    );
  }

  if (rapport.disponible) mesurerTemps(lignes.filter((l) => Number.isFinite(l.main.horodatage)), rapport, coupureMin);
  rapport.tilt = mesurerTilt(lignes, { grossePerteBb, grossePerteTapis, mainsApresPerte, tapisCourtBb });
  return rapport;
}

function mesurerTemps(lignes, rapport, coupureMin) {
  // Sessions.
  const sessions = [];
  let courante = null;
  for (const l of lignes) {
    const t = l.main.horodatage;
    if (!courante || t - courante.derniere > coupureMin * 60_000) {
      courante = { lignes: [], debut: t, derniere: t };
      sessions.push(courante);
    }
    courante.lignes.push(l);
    courante.derniere = t;
    l.session = sessions.length - 1;
  }

  // Temps passé sur chaque main : jusqu'à la main suivante de la même table, dans la même session.
  for (const session of sessions) {
    const parTable = new Map();
    for (const l of session.lignes) {
      const cle = cleTable(l.main);
      if (!parTable.has(cle)) parTable.set(cle, []);
      parTable.get(cle).push(l);
    }
    for (const suite of parTable.values()) {
      for (let i = 0; i + 1 < suite.length; i++) {
        suite[i].duree = (suite[i + 1].main.horodatage - suite[i].main.horodatage) / 1000;
      }
    }
    session.parTable = parTable;
  }

  const durees = lignes.map((l) => l.duree).filter((d) => d !== null);
  const dureeTypique = mediane(durees);
  rapport.cadence = {
    secondesParMain: arrondi(moyenne(durees), 1),
    medianeSecondes: arrondi(dureeTypique, 1),
    plusRapide: durees.length ? Math.min(...durees) : NaN,
    plusLente: durees.length ? Math.max(...durees) : NaN,
    mesures: durees.length,
  };

  // La dernière main d'une table n'a pas de suivante : on lui prête la durée typique.
  const finDe = (l) => l.main.horodatage + (l.duree ?? (Number.isFinite(dureeTypique) ? dureeTypique : 0)) * 1000;

  let tablesMax = 0;
  let mainsEnMulti = 0;
  rapport.sessions = sessions.map((session, i) => {
    const debut = session.debut;
    const fin = Math.max(...session.lignes.map(finDe));
    const dureeMin = (fin - debut) / 60_000;
    const resultat = session.lignes.reduce((s, l) => s + l.stats.resultat, 0);
    const resultatBb = session.lignes.reduce((s, l) => s + (Number.isFinite(l.resultatBb) ? l.resultatBb : 0), 0);

    // Multi-table : on balaie les intervalles d'activité de chaque table.
    const intervalles = [...session.parTable.entries()].map(([cle, suite]) => ({
      cle,
      debut: suite[0].main.horodatage,
      fin: Math.max(...suite.map(finDe)),
    }));
    const bornes = intervalles.flatMap((iv) => [
      { t: iv.debut, d: 1 },
      { t: iv.fin, d: -1 },
    ]);
    bornes.sort((a, b) => a.t - b.t || a.d - b.d); // une table qui ferme avant celle qui ouvre au même instant
    let ouvertes = 0;
    let maxSession = 0;
    for (const b of bornes) {
      ouvertes += b.d;
      maxSession = Math.max(maxSession, ouvertes);
    }
    tablesMax = Math.max(tablesMax, maxSession);
    for (const l of session.lignes) {
      const t = l.main.horodatage;
      const cle = cleTable(l.main);
      if (intervalles.some((iv) => iv.cle !== cle && iv.debut <= t && t < iv.fin)) mainsEnMulti++;
    }

    return {
      numero: i + 1,
      debut,
      fin,
      debutTexte: dateHeureDe(debut),
      finTexte: heureDe(fin),
      dureeMin: arrondi(dureeMin, 1),
      mains: session.lignes.length,
      mainsParHeure: dureeMin > 0 ? Math.round((session.lignes.length / dureeMin) * 60) : NaN,
      tables: session.parTable.size,
      tablesEnMemeTemps: maxSession,
      resultat: arrondi(resultat),
      resultatBb: arrondi(resultatBb, 1),
    };
  });

  const dureeTotaleMin = rapport.sessions.reduce((s, x) => s + x.dureeMin, 0);
  rapport.mainsParHeure = dureeTotaleMin > 0 ? Math.round((lignes.length / dureeTotaleMin) * 60) : NaN;
  rapport.dureeTotaleMin = arrondi(dureeTotaleMin, 1);
  rapport.multiTable = { detecte: tablesMax >= 2, tablesMax, mainsEnMulti, mains: lignes.length };

  // Fatigue : la première heure de chaque session contre la suite.
  const premiere = [];
  const ensuite = [];
  for (const l of lignes) {
    const session = sessions[l.session];
    (l.main.horodatage - session.debut < 3_600_000 ? premiere : ensuite).push(l);
  }
  rapport.fatigue = { premiereHeure: bilan(premiere), ensuite: bilan(ensuite) };

  // L'heure de la journée.
  const parHeure = new Map();
  for (const l of lignes) {
    const h = new Date(l.main.horodatage).getUTCHours();
    if (!parHeure.has(h)) parHeure.set(h, []);
    parHeure.get(h).push(l);
  }
  rapport.parHeureDuJour = [...parHeure.entries()].sort((a, b) => a[0] - b[0]).map(([heure, ls]) => ({ heure, ...bilan(ls) }));
}

/** Mains, résultat, bb par main, VPIP, PFR et cadence d'un groupe de mains. */
function bilan(lignes) {
  const avecBb = lignes.filter((l) => Number.isFinite(l.resultatBb));
  const durees = lignes.map((l) => l.duree).filter((d) => d !== null);
  return {
    mains: lignes.length,
    resultat: arrondi(lignes.reduce((s, l) => s + l.stats.resultat, 0)),
    resultatBb: arrondi(avecBb.reduce((s, l) => s + l.resultatBb, 0), 1),
    bbParMain: avecBb.length ? arrondi(avecBb.reduce((s, l) => s + l.resultatBb, 0) / avecBb.length, 2) : NaN,
    vpip: lignes.length ? lignes.filter((l) => l.stats.vpip).length / lignes.length : NaN,
    pfr: lignes.length ? lignes.filter((l) => l.stats.pfr).length / lignes.length : NaN,
    secondesParMain: durees.length ? arrondi(moyenne(durees), 1) : NaN,
    mesuresDuree: durees.length,
  };
}

function mesurerTilt(lignes, { grossePerteBb, grossePerteTapis, mainsApresPerte, tapisCourtBb }) {
  const declencheurs = new Set();
  const sousLeCoup = new Set();
  lignes.forEach((l, i) => {
    const perte = -l.stats.resultat;
    const parBb = Number.isFinite(l.bb) && perte >= grossePerteBb * l.bb;
    const parTapis = Number.isFinite(l.tapis) && l.tapis > 0 && perte >= grossePerteTapis * l.tapis;
    if (perte > 0 && (parBb || parTapis)) {
      declencheurs.add(i);
      for (let k = i + 1; k <= i + mainsApresPerte && k < lignes.length; k++) sousLeCoup.add(k);
    }
  });

  const exclues = (l) => Number.isFinite(l.tapisBb) && l.tapisBb < tapisCourtBb;
  const pendant = [];
  const reference = [];
  let ecartees = 0;
  lignes.forEach((l, i) => {
    if (declencheurs.has(i)) return;
    if (exclues(l)) {
      ecartees++;
      return;
    }
    (sousLeCoup.has(i) ? pendant : reference).push(l);
  });

  const episodes = [...declencheurs].map((i) => {
    const l = lignes[i];
    const suivantes = [];
    for (let k = i + 1; k <= i + mainsApresPerte && k < lignes.length; k++) suivantes.push(lignes[k]);
    return {
      id: l.main.id,
      horodatage: l.main.horodatage,
      heure: Number.isFinite(l.main.horodatage) ? heureDe(l.main.horodatage) : null,
      perte: arrondi(-l.stats.resultat),
      perteBb: arrondi(-l.resultatBb, 1),
      mainsSuivantes: suivantes.length,
      apres: bilan(suivantes.filter((s) => !exclues(s))),
    };
  });

  const tilt = {
    detecte: false,
    episodes,
    pendant: bilan(pendant),
    reference: bilan(reference),
    mainsEcartees: ecartees,
    signaux: [],
    conclusion: '',
    regles: `Grosse perte : au moins ${grossePerteBb} bb ou ${Math.round(grossePerteTapis * 100)} % de ton tapis. Surveillance : les ${mainsApresPerte} mains suivantes. Mains jouées sous ${tapisCourtBb} bb écartées (le jeu à tapis court gonfle le VPIP).`,
  };

  if (declencheurs.size === 0) {
    tilt.conclusion = `Aucune grosse perte dans ces ${lignes.length} mains : rien à surveiller.`;
    return tilt;
  }
  const p = tilt.pendant;
  const r = tilt.reference;
  if (p.mains < MINIMUM_COMPARAISON || r.mains < MINIMUM_COMPARAISON) {
    tilt.conclusion = `Pas assez de mains pour comparer : ${pluriel(p.mains, 'main')} après une grosse perte, ${r.mains} hors de ces moments (il en faut ${MINIMUM_COMPARAISON} de chaque).`;
    return tilt;
  }

  const ecartVpip = p.vpip - r.vpip;
  if (ecartVpip >= 0.1) {
    tilt.signaux.push({
      genre: 'vpip',
      gravite: ecartVpip >= 0.2 ? 'forte' : 'moyenne',
      texte: `Après une grosse perte, tu joues ${pct(p.vpip, 0)} des mains contre ${pct(r.vpip, 0)} d'habitude (+${Math.round(ecartVpip * 100)} points, sur ${p.mains} mains contre ${r.mains}).`,
    });
  }
  if (Number.isFinite(p.secondesParMain) && Number.isFinite(r.secondesParMain) && p.mesuresDuree >= 3 && r.mesuresDuree >= 3) {
    const rapportCadence = p.secondesParMain / r.secondesParMain;
    if (rapportCadence <= 0.8) {
      tilt.signaux.push({
        genre: 'cadence',
        gravite: rapportCadence <= 0.6 ? 'forte' : 'moyenne',
        texte: `Tu joues plus vite : ${secondes(p.secondesParMain)} par main contre ${secondes(r.secondesParMain)} d'habitude (${Math.round((1 - rapportCadence) * 100)} % plus rapide).`,
      });
    }
  }
  if (Number.isFinite(p.bbParMain) && Number.isFinite(r.bbParMain) && p.bbParMain < r.bbParMain) {
    tilt.signaux.push({
      genre: 'resultat',
      gravite: 'info',
      texte: `Résultat après une grosse perte : ${signeBb(p.bbParMain)} bb par main, contre ${signeBb(r.bbParMain)} bb d'habitude.`,
    });
  }
  tilt.detecte = tilt.signaux.some((x) => x.genre === 'vpip' || x.genre === 'cadence');
  tilt.conclusion = tilt.detecte
    ? 'Tilt probable : ton jeu change après les grosses pertes. Fais une pause de quelques minutes après un gros coup perdu.'
    : 'Pas de tilt visible : ton jeu reste le même après les grosses pertes.';
  return tilt;
}

/** Les lignes de texte du rythme et du tilt, pour le terminal. */
export function formaterRythme(r) {
  const l = [];
  if (!r) return l;
  l.push('Rythme');
  for (const a of r.avertissements) l.push(`  ! ${a}`);
  if (r.disponible) {
    const c = r.cadence;
    const morceaux = [pluriel(r.sessions.length, 'session'), pluriel(r.nbMainsHorodatees, 'main')];
    if (Number.isFinite(r.mainsParHeure)) morceaux.push(`${r.mainsParHeure} mains/heure`);
    if (Number.isFinite(c.secondesParMain)) {
      morceaux.push(`${secondes(c.secondesParMain)} par main (médiane ${secondes(c.medianeSecondes)}, sur ${pluriel(c.mesures, 'mesure')})`);
    }
    l.push(`  ${morceaux.join(' · ')}`);
    for (const s of r.sessions) {
      l.push(
        `  Session ${s.numero} : ${s.debutTexte} → ${s.finTexte} (${String(s.dureeMin).replace('.', ',')} min), ${pluriel(s.mains, 'main')}, ${pluriel(s.tables, 'table')}${s.tablesEnMemeTemps > 1 ? ` dont ${s.tablesEnMemeTemps} en même temps` : ''}, ${signe(s.resultat)} (${signeBb(s.resultatBb)} bb)`,
      );
    }
    if (r.multiTable.detecte) {
      l.push(`  Multi-table : jusqu'à ${r.multiTable.tablesMax} tables en même temps (${pluriel(r.multiTable.mainsEnMulti, 'main')} sur ${r.multiTable.mains}).`);
    }
    const f = r.fatigue;
    const fin = f.ensuite.mains ? `${pluriel(f.ensuite.mains, 'main')}, ${signeBb(f.ensuite.bbParMain)} bb/main` : 'aucune main';
    l.push(`  Fatigue : 1re heure ${pluriel(f.premiereHeure.mains, 'main')}, ${signeBb(f.premiereHeure.bbParMain)} bb/main ; ensuite ${fin}.`);
  }
  const t = r.tilt;
  if (t) {
    l.push('');
    l.push('Tilt');
    l.push(`  ${t.regles}`);
    for (const e of t.episodes) {
      l.push(`  Grosse perte : main #${e.id}${e.heure ? ` à ${e.heure}` : ''}, ${signe(-e.perte)}${Number.isFinite(e.perteBb) ? ` (${signeBb(-e.perteBb)} bb)` : ''}`);
    }
    if (t.episodes.length) {
      const p = t.pendant;
      const ref = t.reference;
      const cadence = (b) => (Number.isFinite(b.secondesParMain) ? `, ${secondes(b.secondesParMain)}/main` : '');
      l.push(
        `  Après : VPIP ${pct(p.vpip, 0)}, PFR ${pct(p.pfr, 0)}${cadence(p)} (${pluriel(p.mains, 'main')}) · D'habitude : VPIP ${pct(ref.vpip, 0)}, PFR ${pct(ref.pfr, 0)}${cadence(ref)} (${pluriel(ref.mains, 'main')})`,
      );
    }
    for (const s of t.signaux) l.push(`  ${s.gravite === 'forte' ? '!!' : s.gravite === 'moyenne' ? ' !' : ' ·'} ${s.texte}`);
    l.push(`  ${t.conclusion}`);
  }
  return l;
}
