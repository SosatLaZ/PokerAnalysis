// Le suivi, comme un tracker : chaque main résumée sur une ligne, la courbe de
// gains (réelle et « all-in EV »), les résultats par jour et par limite, les
// filtres de mains, et le rejeu coup par coup.

import { classeDeMain, afficherCartes } from '../moteur/cartes.js';
import { lireRange } from '../moteur/ranges.js';
import { dateHeureDe } from './rythme.js';

const arrondir = (x) => Math.round(x * 100) / 100;

/** Une main sur une ligne, vue du héros. */
export function resumeMain(main, hero = main.hero) {
  const investi = main.investi?.[hero] ?? 0;
  const net = arrondir((main.gains?.[hero] ?? 0) - investi);
  const bb = main.grosseBlinde > 0 ? main.grosseBlinde : NaN;
  const pot = Object.values(main.investi ?? {}).reduce((t, x) => t + x, 0);
  const rueMax = main.tableau.length === 0 ? 'preflop' : main.tableau.length === 3 ? 'flop' : main.tableau.length === 4 ? 'turn' : 'river';
  const siennes = main.actions.filter((a) => a.joueur === hero && a.type !== 'poste');
  const preflop = siennes.filter((a) => a.rue === 'preflop');
  return {
    id: main.id,
    horodatage: main.horodatage ?? null,
    date: main.horodatage ? dateHeureDe(main.horodatage) : '',
    jour: main.horodatage ? dateHeureDe(main.horodatage).slice(0, 10) : 'sans date',
    limite: Number.isFinite(main.grosseBlinde) ? `${main.petiteBlinde}/${main.grosseBlinde}${main.tournoi ? ' (tournoi)' : ''}` : '?',
    tournoi: Boolean(main.tournoi),
    table: main.table ?? null,
    position: main.positionHero ?? null,
    cartes: main.cartesHero ?? null,
    cartesTexte: main.cartesHero ? afficherCartes(main.cartesHero) : '',
    classe: main.cartesHero ? classeDeMain(...main.cartesHero) : null,
    tableau: main.tableau,
    rueMax,
    pot: arrondir(pot),
    potBb: pot / bb,
    net,
    netBb: net / bb,
    abattage: main.restants?.includes(hero) && main.restants.length >= 2,
    tapis: main.tapisEngage && main.restants?.includes(hero),
    vpip: preflop.some((a) => ['suit', 'relance', 'mise'].includes(a.type)),
    pfr: preflop.some((a) => a.type === 'relance' || a.type === 'mise'),
    couchePreflop: preflop.some((a) => a.type === 'couche'),
    adversaires: (main.joueurs ?? []).map((j) => j.nom).filter((n) => n !== hero),
  };
}

/**
 * La courbe de gains, main après main.
 * @param chances  Map id → chance (réel − attendu) sur les tapis montrés, tirée de analyserSession
 */
export function courbeGains(lignes, chances = new Map()) {
  let cumul = 0;
  let cumulBb = 0;
  let ev = 0;
  return lignes.map((l, i) => {
    cumul = arrondir(cumul + l.net);
    if (Number.isFinite(l.netBb)) cumulBb += l.netBb;
    ev = arrondir(ev + l.net - (chances.get(l.id) ?? 0));
    return { i: i + 1, id: l.id, cumul, cumulBb, ev };
  });
}

/** Regroupe les lignes par une clé : jour, limite, position… */
export function regrouper(lignes, cle) {
  const groupes = new Map();
  for (const l of lignes) {
    const k = typeof cle === 'function' ? cle(l) : l[cle];
    const g = groupes.get(k) ?? { cle: k, mains: 0, net: 0, netBb: 0, vpip: 0, pfr: 0, abattages: 0, gagnees: 0 };
    g.mains++;
    g.net = arrondir(g.net + l.net);
    if (Number.isFinite(l.netBb)) g.netBb += l.netBb;
    if (l.vpip) g.vpip++;
    if (l.pfr) g.pfr++;
    if (l.abattage) g.abattages++;
    if (l.net > 0) g.gagnees++;
    groupes.set(k, g);
  }
  return [...groupes.values()].map((g) => ({ ...g, bb100: (g.netBb / g.mains) * 100, vpip: g.vpip / g.mains, pfr: g.pfr / g.mains }));
}

/**
 * Filtre les lignes.
 * filtre = { position, range (texte : « AK, 77+ »), resultat: 'gagnees' | 'perdues', tapis, abattage,
 *            rueMin: 'flop' | 'turn' | 'river', potMinBb, jour, limite, adversaire, joueesSeulement }
 */
export function filtrerMains(lignes, filtre = {}) {
  let cles = null;
  if (filtre.range && filtre.range.trim()) {
    cles = new Set(lireRange(filtre.range).map(([a, b]) => (a < b ? a * 52 + b : b * 52 + a)));
  }
  const ordreRues = ['preflop', 'flop', 'turn', 'river'];
  return lignes.filter((l) => {
    if (filtre.position && l.position !== filtre.position) return false;
    if (cles) {
      if (!l.cartes) return false;
      const [a, b] = l.cartes;
      if (!cles.has(a < b ? a * 52 + b : b * 52 + a)) return false;
    }
    if (filtre.resultat === 'gagnees' && !(l.net > 0)) return false;
    if (filtre.resultat === 'perdues' && !(l.net < 0)) return false;
    if (filtre.tapis && !l.tapis) return false;
    if (filtre.abattage && !l.abattage) return false;
    if (filtre.rueMin && ordreRues.indexOf(l.rueMax) < ordreRues.indexOf(filtre.rueMin)) return false;
    if (filtre.potMinBb && !(l.potBb >= filtre.potMinBb)) return false;
    if (filtre.jour && l.jour !== filtre.jour) return false;
    if (filtre.limite && l.limite !== filtre.limite) return false;
    if (filtre.adversaire && !l.adversaires.includes(filtre.adversaire)) return false;
    if (filtre.joueesSeulement && !l.vpip) return false;
    return true;
  });
}

/**
 * Le rejeu d'une main : une étape par action, avec les tapis, le pot, le
 * tableau visible et la phrase à afficher.
 */
export function etapesDeMain(main) {
  const tapis = new Map(main.joueurs.map((j) => [j.nom, j.tapis]));
  const misesRue = new Map();
  const couches = new Set();
  let pot = 0;
  let rue = 'preflop';
  const visible = { preflop: 0, flop: 3, turn: 4, river: 5 };
  const photo = (texte, extra = {}) => ({
    rue,
    tableau: main.tableau.slice(0, visible[rue]),
    pot: arrondir(pot),
    tapis: Object.fromEntries([...tapis].map(([n, t]) => [n, arrondir(t)])),
    mises: Object.fromEntries([...misesRue].map(([n, m]) => [n, arrondir(m)])),
    couches: [...couches],
    texte,
    ...extra,
  });
  const etapes = [photo('Début de la main')];
  const verbes = { couche: 'se couche', parole: 'checke', suit: 'suit', mise: 'mise', relance: 'relance à', poste: 'poste' };
  for (const a of main.actions) {
    if (a.type === 'montre') continue;
    if (a.rue !== rue) {
      rue = a.rue;
      misesRue.clear();
      etapes.push(photo(`${{ flop: 'Flop', turn: 'Tournant', river: 'Rivière' }[rue] ?? rue}`));
    }
    const deja = misesRue.get(a.joueur) ?? 0;
    let ajout = 0;
    if (a.type === 'poste' || a.type === 'suit' || a.type === 'mise') ajout = a.montant;
    else if (a.type === 'relance') ajout = a.total - deja;
    if (a.type === 'couche') couches.add(a.joueur);
    if (ajout > 0) {
      tapis.set(a.joueur, (tapis.get(a.joueur) ?? 0) - ajout);
      if (!(a.type === 'poste' && a.genre === 'ante')) misesRue.set(a.joueur, deja + ajout);
      pot += ajout;
    }
    const montant = a.type === 'relance' ? a.total : a.montant;
    etapes.push(
      photo(`${a.joueur} ${verbes[a.type] ?? a.type}${montant ? ` ${arrondir(montant)}` : ''}${a.tapis ? ' (tapis)' : ''}`, {
        joueur: a.joueur,
        action: a,
        estHero: a.joueur === main.hero,
      }),
    );
  }
  // Les cartes qui restent à retourner (tapis avant la rivière).
  for (const r of ['flop', 'turn', 'river']) {
    if (visible[r] > visible[rue] && main.tableau.length >= visible[r]) {
      rue = r;
      misesRue.clear();
      etapes.push(photo({ flop: 'Flop', turn: 'Tournant', river: 'Rivière' }[r]));
    }
  }
  const montrees = Object.entries(main.montrees ?? {}).map(([n, c]) => `${n} montre ${afficherCartes(c)}`);
  const gains = Object.entries(main.gains ?? {}).filter(([, g]) => g > 0).map(([n, g]) => `${n} gagne ${arrondir(g)}`);
  for (const [n, r] of Object.entries(main.rendus ?? {})) tapis.set(n, (tapis.get(n) ?? 0) + r);
  for (const [n, g] of Object.entries(main.gains ?? {})) tapis.set(n, (tapis.get(n) ?? 0) + g);
  pot = 0;
  misesRue.clear();
  etapes.push(photo([...montrees, ...gains].join(' · ') || 'Fin de la main', { fin: true, montrees: main.montrees ?? {} }));
  return etapes;
}
