// L'analyse de l'entraînement : chaque décision du joueur, le temps qu'il y a
// mis, et ce qu'en pensent les quatre bots.
//
// Verdicts :
//   - « bon » : le Solide aurait fait pareil ;
//   - « style » : un autre profil aurait fait pareil (choix défendable) ;
//   - « erreur » : aucun profil ne le fait ;
//   - « n'importe quoi » : une faute qui ne se défend dans aucun style
//     (se coucher quand checker est gratuit, jeter une main énorme, payer gros
//     sans la cote, partir à tapis avec une main que même le Sans peur jette).

import { pct, court } from '../moteur/format.js';

const famille = (type) => (type === 'mise' || type === 'relance' ? 'attaque' : type);

/** La famille d'une décision de bot, en tenant compte du tapis payé (« tapis » qui ne fait que suivre). */
function familleBot(d, situation) {
  if (d.action === 'tapis') return situation.tapis <= situation.aSuivre ? 'suit' : 'attaque';
  return famille(d.action);
}

function familleJoueur(action, situation) {
  if (action.type === 'tapis') return situation.tapis <= situation.aSuivre ? 'suit' : 'attaque';
  return famille(action.type);
}

/**
 * @param {object} d
 * @param {object} d.situation   la situation vue par le joueur (format du bot)
 * @param {object} d.action      { type, montant } jouée
 * @param {number} d.tempsMs     temps de décision
 * @param {Array}  d.conseils    les décisions des 4 profils (conseillerTous)
 */
export function evaluerDecision({ situation, action, tempsMs, conseils }) {
  const bb = situation.grosseBlinde;
  const joue = familleJoueur(action, situation);
  const accords = Object.fromEntries(conseils.map((c) => [c.profil, familleBot(c, situation) === joue]));
  const solide = conseils.find((c) => c.profil === 'solide') ?? conseils[0];
  const equite = solide.equite;
  const requise = solide.equiteRequise;
  const appel = Math.min(situation.aSuivre, situation.tapis);
  const raisons = [];

  // Ce que la décision coûte, quand on sait le chiffrer (suivre ou se coucher face à une mise).
  let perteBb = null;
  if (situation.aSuivre > 0 && Number.isFinite(solide.ev) && (joue === 'couche' || joue === 'suit')) {
    const evAppel = solide.ev;
    perteBb = (joue === 'couche' ? Math.max(0, evAppel) : Math.max(0, -evAppel)) / bb;
  }

  let nimporteQuoi = null;
  if (action.type === 'couche' && situation.aSuivre === 0) nimporteQuoi = 'Tu t’es couché alors que checker était gratuit.';
  else if (joue === 'couche' && solide.force === 'monstre') nimporteQuoi = `Tu as jeté une main énorme (${solide.lecture}).`;
  else if (joue === 'couche' && Number.isFinite(equite) && equite >= 0.75) nimporteQuoi = `Tu as jeté ${pct(equite, 0)} d’équité.`;
  else if (joue === 'suit' && Number.isFinite(requise) && equite < requise - 0.2 && appel >= Math.max(10 * bb, 0.3 * (situation.tapis + situation.dejaMise))) {
    nimporteQuoi = `Tu as payé ${court(appel / bb)} bb avec ${pct(equite, 0)} d’équité alors qu’il en fallait ${pct(requise, 0)}.`;
  } else if ((situation.tableau?.length ?? 0) === 0 && action.type === 'tapis' && Object.values(accords).every((x) => !x) && (solide.percentile ?? 0) > 60) {
    nimporteQuoi = `Tapis avec une main que même le Sans peur jette (parmi les ${Math.round(100 - solide.percentile + 1)} % plus faibles).`;
  }

  let verdict;
  if (nimporteQuoi) {
    verdict = 'nimportequoi';
    raisons.push(nimporteQuoi);
  } else if (accords.solide) verdict = 'bon';
  else if (Object.values(accords).some(Boolean)) {
    verdict = perteBb !== null && perteBb >= 2 ? 'erreur' : 'style';
    const qui = conseils.filter((c) => accords[c.profil]).map((c) => c.nomProfil);
    raisons.push(`C’est le choix du profil ${qui.join(' et ')}, pas du Solide (${solide.titre}).`);
  } else {
    verdict = 'erreur';
    raisons.push(`Aucun des quatre profils ne fait ça ; le Solide joue « ${solide.titre} ».`);
  }
  if (perteBb !== null && perteBb > 0.05) raisons.push(`Coût estimé : ${court(perteBb)} bb.`);
  return { verdict, accords, perteBb, tempsMs, equite, requise, raisons, conseilSolide: solide.titre, rue: situation.rue ?? ((situation.tableau?.length ?? 0) ? 'postflop' : 'preflop') };
}

export const LIBELLES_VERDICTS = { bon: 'Bon', style: 'Choix de style', erreur: 'Erreur', nimportequoi: 'N’importe quoi' };

const mediane = (xs) => {
  if (!xs.length) return NaN;
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};
const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const tauxFautes = (ds) => (ds.length ? ds.filter((d) => d.verdict === 'erreur' || d.verdict === 'nimportequoi').length / ds.length : NaN);

/**
 * Le bilan d'une séance.
 * @param {Array} decisions  [{ numeroMain, ...evaluerDecision() }]
 * @param {Array} mains      [{ numero, netBb }] : le résultat de chaque main pour le joueur
 */
export function bilanEntrainement(decisions, mains = []) {
  const n = decisions.length;
  const compte = { bon: 0, style: 0, erreur: 0, nimportequoi: 0 };
  for (const d of decisions) compte[d.verdict]++;
  const score = n ? Math.max(0, Math.round(100 * (1 - (compte.erreur + 2.5 * compte.nimportequoi + 0.15 * compte.style) / n))) : null;

  const temps = decisions.map((d) => d.tempsMs).filter(Number.isFinite);
  const eclairs = decisions.filter((d) => d.tempsMs < 2000);
  const longues = decisions.filter((d) => d.tempsMs > 20000);
  const reflechies = decisions.filter((d) => d.tempsMs >= 2000);
  const parRue = {};
  for (const d of decisions) (parRue[d.rue] ??= []).push(d.tempsMs);

  // Le style : avec quel profil tes décisions tombent-elles le plus souvent d'accord ?
  const accords = {};
  for (const d of decisions) for (const [p, ok] of Object.entries(d.accords)) accords[p] = (accords[p] ?? 0) + (ok ? 1 : 0);
  const style = Object.entries(accords)
    .map(([profil, k]) => ({ profil, accord: n ? k / n : 0 }))
    .sort((a, b) => b.accord - a.accord);

  // Le tilt : après une grosse perte (20 bb ou plus), les 6 décisions suivantes.
  const pertes = mains.filter((m) => m.netBb <= -20).map((m) => m.numero);
  const apres = new Set();
  for (const p of pertes) {
    decisions.filter((d) => d.numeroMain > p).slice(0, 6).forEach((d) => apres.add(d));
  }
  const pendant = [...apres];
  const horsTilt = decisions.filter((d) => !apres.has(d));
  const tilt = {
    grossesPertes: pertes.length,
    decisionsApres: pendant.length,
    fautesApres: tauxFautes(pendant),
    fautesAvant: tauxFautes(horsTilt),
    tempsApres: mediane(pendant.map((d) => d.tempsMs)),
    tempsAvant: mediane(horsTilt.map((d) => d.tempsMs)),
  };
  tilt.detecte =
    pendant.length >= 3 &&
    ((tilt.fautesApres >= 0.3 && tilt.fautesApres >= 2 * (tilt.fautesAvant || 0.05)) || tilt.tempsApres < 0.6 * tilt.tempsAvant);

  const alertes = [];
  if (compte.nimportequoi > 0) alertes.push({ gravite: 'forte', titre: `${compte.nimportequoi} coup${compte.nimportequoi > 1 ? 's' : ''} n’importe quoi`, detail: 'Des fautes qui ne se défendent dans aucun style : relis-les une par une.' });
  if (tilt.detecte) {
    alertes.push({
      gravite: 'forte',
      titre: 'Tilt probable après tes grosses pertes',
      detail: `Après ${pertes.length} grosse${pertes.length > 1 ? 's' : ''} perte${pertes.length > 1 ? 's' : ''} : ${pct(tilt.fautesApres, 0)} de fautes (contre ${pct(tilt.fautesAvant, 0)} d’habitude), décisions en ${court(tilt.tempsApres / 1000)} s (contre ${court(tilt.tempsAvant / 1000)} s). Fais une pause après un gros coup.`,
    });
  }
  const fautesEclair = tauxFautes(eclairs);
  const fautesReflechies = tauxFautes(reflechies);
  if (eclairs.length >= 4 && fautesEclair > fautesReflechies + 0.15) {
    alertes.push({ gravite: 'moyenne', titre: 'Tu te trompes quand tu joues vite', detail: `${pct(fautesEclair, 0)} de fautes sur les décisions de moins de 2 s, contre ${pct(fautesReflechies, 0)} quand tu prends le temps.` });
  }
  if (longues.length >= 3 && tauxFautes(longues) > 0.4) {
    alertes.push({ gravite: 'moyenne', titre: 'Les longues hésitations finissent mal', detail: `${longues.length} décisions de plus de 20 s, ${pct(tauxFautes(longues), 0)} de fautes : décide plus tôt sur les coups simples, garde ton temps pour les gros pots.` });
  }
  if (compte.erreur / Math.max(n, 1) > 0.25 && n >= 8) {
    alertes.push({ gravite: 'moyenne', titre: 'Beaucoup d’erreurs sans style', detail: `${pct(compte.erreur / n, 0)} de tes décisions ne correspondent à aucun profil.` });
  }

  return {
    decisions: n,
    compte,
    score,
    temps: {
      moyen: moyenne(temps),
      median: mediane(temps),
      parRue: Object.fromEntries(Object.entries(parRue).map(([r, xs]) => [r, mediane(xs)])),
      eclairs: eclairs.length,
      longues: longues.length,
      fautesEclair,
      fautesReflechies,
    },
    style,
    tilt,
    alertes,
    mains: mains.length,
    resultatBb: mains.reduce((t, m) => t + m.netBb, 0),
  };
}
