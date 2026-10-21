import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lireHistorique, lireHorodatage, lireNiveau } from '../src/analyse/historique.js';
import { analyserRythme, heureDe } from '../src/analyse/rythme.js';
import { analyserAdversaires, classerJoueur, seuilsPourTable, percentileMain } from '../src/analyse/adversaires.js';
import { analyserSession, formaterRapport } from '../src/analyse/detection.js';
import { lireCartes } from '../src/moteur/cartes.js';

const SPIN = readFileSync(new URL('../exemples/spin-rush-exemple.txt', import.meta.url), 'utf8');
const lireSpin = () => lireHistorique(SPIN).mains;

/** Une main minimale au format PokerStars : le héros se couche au bouton. */
function mainSimple({ id, quand, table = 'Alpha', hero = 'Moi', vpip = false, perte = 0 }) {
  const lignes = [
    `PokerStars Hand #${id}:  Hold'em No Limit (€0.05/€0.10 EUR)${quand ? ` - ${quand} CET` : ''}`,
    `Table '${table}' 6-max Seat #1 is the button`,
    `Seat 1: ${hero} (€10 in chips)`,
    'Seat 2: Bob (€10 in chips)',
    'Seat 3: Cleo (€10 in chips)',
    'Bob: posts small blind €0.05',
    'Cleo: posts big blind €0.10',
    '*** HOLE CARDS ***',
    `Dealt to ${hero} [7c 2d]`,
  ];
  if (perte > 0) {
    // Le héros relance, Cleo paie, le héros perd tout à l'abattage.
    lignes.push(`${hero}: raises €${perte - 0.1} to €${perte}`, 'Bob: folds', `Cleo: calls €${(perte - 0.1).toFixed(2)}`);
    lignes.push('*** FLOP *** [Ah Kh Qh]', '*** TURN *** [Ah Kh Qh] [2h]', '*** RIVER *** [Ah Kh Qh 2h] [3c]', '*** SHOW DOWN ***');
    lignes.push(`Cleo: shows [Jh Th]`, `Cleo collected €${(2 * perte + 0.05).toFixed(2)} from pot`);
  } else if (vpip) {
    lignes.push(`${hero}: raises €0.20 to €0.30`, 'Bob: folds', 'Cleo: folds', `Uncalled bet (€0.20) returned to ${hero}`, `${hero} collected €0.25 from pot`);
  } else {
    lignes.push(`${hero}: folds`, 'Bob: folds', 'Uncalled bet (€0.05) returned to Cleo', 'Cleo collected €0.10 from pot');
  }
  lignes.push('*** SUMMARY ***');
  return lignes.join('\n');
}

const lire = (...mains) => lireHistorique(mains.join('\n\n\n')).mains;

test('l’heure d’une main, dans tous les formats d’en-tête', () => {
  const amj = lireHorodatage("PokerStars Hand #1: Hold'em No Limit (€0.05/€0.10 EUR) - 2026/10/20 21:14:03 CET [2026/10/20 15:14:03 ET]");
  assert.equal(new Date(amj.ms).toISOString(), '2026-10-20T21:14:03.000Z', 'la première date gagne, sans conversion de fuseau');
  assert.equal(amj.fuseau, 'CET');
  assert.equal(heureDe(amj.ms), '21:14');
  assert.equal(lireHorodatage('Winamax Poker - HandId: #1 - Holdem (0.05€/0.10€) - 2026-10-20 21:20:00 UTC').fuseau, 'UTC');
  assert.equal(new Date(lireHorodatage('Main #77 - (0,05 €/0,10 €) - 20/10/2026 21:30:00').ms).toISOString(), '2026-10-20T21:30:00.000Z');
  assert.equal(new Date(lireHorodatage('Main n°5 - 21/10/2026 à 20h05').ms).toISOString(), '2026-10-21T20:05:00.000Z');
  assert.equal(lireHorodatage('Main #1 - 31/02/2026 10:00:00'), null, 'le 31 février n’existe pas');
  assert.equal(lireHorodatage('Main #1 - 2026/13/01 10:00:00'), null);
  assert.equal(lireHorodatage("PokerStars Hand #1: Hold'em No Limit (10/20)"), null);
});

test('les niveaux en chiffres romains', () => {
  assert.equal(lireNiveau('I'), 1);
  assert.equal(lireNiveau('IV'), 4);
  assert.equal(lireNiveau('XIV'), 14);
  assert.equal(lireNiveau('7'), 7);
  assert.ok(Number.isNaN(lireNiveau('ABC')));
});

test('l’exemple Spin & Rush : 35 mains justes, avec heure, tournoi, table et niveau', () => {
  const { mains, ignorees } = lireHistorique(SPIN);
  assert.deepEqual(ignorees, []);
  assert.equal(mains.length, 35);
  for (const m of mains) {
    assert.ok(Number.isFinite(m.horodatage), `heure de ${m.id}`);
    assert.ok(m.tournoi && m.idTournoi && m.table, `tournoi de ${m.id}`);
    assert.equal(m.tailleTable, 3);
    assert.equal(m.hero, 'Angelituwu');
    // Rien ne se perd : ce que l'un gagne, les autres l'ont misé.
    const solde = m.joueurs.reduce((s, j) => s + (m.gains[j.nom] ?? 0) - (m.investi[j.nom] ?? 0), 0);
    assert.ok(Math.abs(solde) < 1e-9, `main ${m.id} déséquilibrée de ${solde}`);
  }
  assert.deepEqual([...new Set(mains.map((m) => m.idTournoi))], ['3400000001', '3400000002', '3400000003', '3400000004']);
  const premiere = mains[0];
  assert.equal(premiere.niveau, 1);
  assert.equal(premiere.grosseBlinde, 20);
  assert.equal(premiere.positionHero, 'SB');
  assert.ok(mains.some((m) => m.niveau === 3 && m.grosseBlinde === 40));
});

test('les mises de chaque joueur gardent leur contexte (tapis, agresseur, fin des mises)', () => {
  const main = lireSpin().find((m) => m.id === '250100000021');
  const tapisBec = main.mises.find((x) => x.joueur === 'bec');
  assert.equal(tapisBec.type, 'relance');
  assert.equal(tapisBec.tapis, true);
  const call = main.mises.find((x) => x.joueur === 'SosoCourt' && x.agresseur === 'bec');
  assert.equal(call.type, 'suit');
  assert.equal(call.finDesMises, true, 'SosoCourt paie à tapis : plus aucune mise possible');
});

test('les sessions : une coupure de plus de 15 minutes en ouvre une nouvelle', () => {
  const mains = lire(
    mainSimple({ id: 1, quand: '2026/10/21 20:00:00' }),
    mainSimple({ id: 2, quand: '2026/10/21 20:01:00' }),
    mainSimple({ id: 3, quand: '2026/10/21 20:02:00' }),
    mainSimple({ id: 4, quand: '2026/10/21 20:30:00' }),
    mainSimple({ id: 5, quand: '2026/10/21 20:31:00' }),
  );
  const r = analyserRythme(mains, { hero: 'Moi' });
  assert.equal(r.disponible, true);
  assert.equal(r.sessions.length, 2);
  assert.deepEqual(r.sessions.map((s) => s.mains), [3, 2]);
  assert.equal(r.cadence.medianeSecondes, 60);
  assert.equal(analyserRythme(mains, { hero: 'Moi', coupureMin: 40 }).sessions.length, 1);
});

test('le multi-table : deux tables qui se chevauchent, pas deux tables qui se suivent', () => {
  const ensemble = lire(
    mainSimple({ id: 1, quand: '2026/10/21 20:00:00', table: 'Alpha' }),
    mainSimple({ id: 2, quand: '2026/10/21 20:00:20', table: 'Beta' }),
    mainSimple({ id: 3, quand: '2026/10/21 20:00:40', table: 'Alpha' }),
    mainSimple({ id: 4, quand: '2026/10/21 20:01:00', table: 'Beta' }),
    mainSimple({ id: 5, quand: '2026/10/21 20:01:20', table: 'Alpha' }),
  );
  const multi = analyserRythme(ensemble, { hero: 'Moi' }).multiTable;
  assert.equal(multi.detecte, true);
  assert.equal(multi.tablesMax, 2);

  const suite = lire(
    mainSimple({ id: 1, quand: '2026/10/21 20:00:00', table: 'Alpha' }),
    mainSimple({ id: 2, quand: '2026/10/21 20:00:30', table: 'Alpha' }),
    mainSimple({ id: 3, quand: '2026/10/21 20:05:00', table: 'Beta' }),
    mainSimple({ id: 4, quand: '2026/10/21 20:05:30', table: 'Beta' }),
  );
  assert.equal(analyserRythme(suite, { hero: 'Moi' }).multiTable.detecte, false);
});

test('le tilt de l’exemple : plus de mains et plus vite après la grosse perte', () => {
  const r = analyserRythme(lireSpin(), { hero: 'Angelituwu' });
  const t = r.tilt;
  assert.equal(t.detecte, true);
  assert.ok(t.episodes.some((e) => e.id === '250100000013'), 'la top paire perdue contre le brelan');
  assert.ok(t.pendant.vpip - t.reference.vpip >= 0.3, `VPIP ${t.pendant.vpip} contre ${t.reference.vpip}`);
  assert.ok(t.pendant.secondesParMain < 0.8 * t.reference.secondesParMain);
  assert.deepEqual(t.signaux.map((s) => s.genre).sort(), ['cadence', 'resultat', 'vpip']);
  assert.ok(t.pendant.mains >= 5 && t.reference.mains >= 5);
  assert.equal(r.multiTable.detecte, true, 'deux Spin ouverts en même temps');
  assert.equal(r.sessions.length, 1);
});

test('sans grosse perte, pas de tilt ; sans assez de mains, on le dit', () => {
  const calmes = lire(...Array.from({ length: 8 }, (_, i) => mainSimple({ id: i + 1, quand: `2026/10/21 20:0${i}:00` })));
  const r = analyserRythme(calmes, { hero: 'Moi' });
  assert.equal(r.tilt.detecte, false);
  assert.match(r.tilt.conclusion, /Aucune grosse perte/);

  const courtes = lire(
    mainSimple({ id: 1, quand: '2026/10/21 20:00:00' }),
    mainSimple({ id: 2, quand: '2026/10/21 20:01:00', perte: 5 }),
    mainSimple({ id: 3, quand: '2026/10/21 20:01:20', vpip: true }),
  );
  const t = analyserRythme(courtes, { hero: 'Moi' }).tilt;
  assert.equal(t.detecte, false);
  assert.equal(t.episodes.length, 1);
  assert.match(t.conclusion, /Pas assez de mains/);
});

test('sans heure dans les en-têtes : rien sur le temps, un avertissement, le tilt dans l’ordre du fichier', () => {
  const mains = lire(mainSimple({ id: 1 }), mainSimple({ id: 2, perte: 5 }), mainSimple({ id: 3 }));
  const r = analyserRythme(mains, { hero: 'Moi' });
  assert.equal(r.disponible, false);
  assert.deepEqual(r.sessions, []);
  assert.equal(r.cadence, null);
  assert.match(r.avertissements[0], /heure lisible/);
  assert.equal(r.tilt.episodes.length, 1);
  assert.ok(Number.isNaN(r.tilt.pendant.secondesParMain));
});

test('les types de joueurs, selon le nombre de joueurs à table', () => {
  const six = (vpip, pfr, af, wtsd) => classerJoueur({ mains: 100, vpip, pfr, af, wtsd, joueursParTable: 6 }).id;
  assert.equal(six(0.12, 0.05, 1, 0.2), 'roc');
  assert.equal(six(0.22, 0.18, 2.5, 0.27), 'tag');
  assert.equal(six(0.36, 0.3, 2.8, 0.28), 'lag');
  assert.equal(six(0.4, 0.33, 4.5, 0.3), 'maniaque');
  assert.equal(six(0.45, 0.06, 0.6, 0.45), 'station');
  assert.equal(six(0.42, 0.08, 1.5, 0.3), 'poisson');
  // À 3, un VPIP de 45 % est serré-normal : ce n'est plus un joueur large.
  assert.equal(classerJoueur({ mains: 100, vpip: 0.45, pfr: 0.35, af: 2.5, wtsd: 0.3, joueursParTable: 3 }).id, 'tag');
  assert.equal(seuilsPourTable(3).large, 0.55);
  const peu = classerJoueur({ mains: 9, vpip: 0.9, pfr: 0.9, af: 9, wtsd: 0.5, joueursParTable: 6 });
  assert.equal(peu.id, null);
  assert.match(peu.portrait, /9 mains seulement/);
});

test('les adversaires de l’exemple : un maniaque, un poisson, et leurs coups absurdes', () => {
  const r = analyserAdversaires(lireSpin(), { hero: 'Angelituwu' });
  const bec = r.adversaires.find((a) => a.nom === 'bec');
  const soso = r.adversaires.find((a) => a.nom === 'SosoCourt');
  assert.equal(bec.type.id, 'maniaque');
  assert.equal(soso.type.id, 'poisson');
  assert.ok(bec.type.conseil.length > 20);
  assert.ok(soso.mains >= 15 && bec.mains >= 15);
  assert.ok(bec.montrees.some((m) => m.classe === '72o'));
  assert.ok(soso.contreToi.mains > 0);

  const fautes = r.nImporteQuoi.map((f) => `${f.id}:${f.joueur}:${f.genre}`);
  assert.ok(fautes.includes('250100000021:bec:tapis-faible'), '7-2 poussé avec 37 bb');
  assert.ok(fautes.includes('250100000032:SosoCourt:call-sans-cote'), 'Q-4 qui paie un tapis de 20 bb');
  assert.equal(fautes.length, 2, 'A9s qui paie le tapis de bec avait la cote');
});

test('le percentile d’une main de départ', () => {
  assert.ok(percentileMain(...lireCartes('As Ah')) < 0.01);
  assert.equal(percentileMain(...lireCartes('3c 2d')), 1);
  assert.ok(percentileMain(...lireCartes('7d 2c')) > 0.95);
});

test('le rapport de session intègre le rythme, le tilt et les adversaires', () => {
  const r = analyserSession(lireSpin(), { graine: 1 });
  assert.equal(r.rythme.tilt.detecte, true);
  assert.equal(r.fuites[0].titre, 'Tilt après les grosses pertes');
  assert.equal(r.adversaires.adversaires.length, 2);
  assert.ok(r.fuites.some((f) => /absurde/.test(f.titre)));
  const texte = formaterRapport(r);
  for (const section of ['Rythme', 'Tilt', 'Adversaires', 'Ils font n’importe quoi', 'Multi-table', 'Maniaque']) {
    assert.ok(texte.includes(section), `section « ${section} »`);
  }
  // Sans héros, les nouveaux champs gardent leur forme.
  const vide = analyserSession([]);
  assert.equal(vide.rythme, null);
  assert.deepEqual(vide.adversaires.adversaires, []);
});
