import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lireHistorique, lireMontant, calculerPositions, decouperMains } from '../src/historique.js';
import { analyserSession, detecterFuites, formaterRapport } from '../src/detection.js';
import { nomCartes } from '../src/cartes.js';

const EXEMPLE = readFileSync(new URL('../exemples/session-exemple.txt', import.meta.url), 'utf8');
const proche = (x, attendu, tolerance = 1e-9) => assert.ok(Math.abs(x - attendu) <= tolerance, `${x} au lieu de ${attendu}`);

test('les montants dans tous les formats', () => {
  assert.equal(lireMontant('€0.05'), 0.05);
  assert.equal(lireMontant('0.05€'), 0.05);
  assert.equal(lireMontant('0,05 €'), 0.05);
  assert.equal(lireMontant('(€3.80)'), 3.8);
  assert.equal(lireMontant('1,500'), 1500);
  assert.equal(lireMontant('1.500,25'), 1500.25);
  assert.equal(lireMontant('2,000.50'), 2000.5);
  assert.equal(lireMontant('12,50'), 12.5);
  assert.ok(Number.isNaN(lireMontant('abc')));
});

test('les positions autour du bouton', () => {
  const p = calculerPositions([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((s) => p.get(s)), ['HJ', 'CO', 'BTN', 'SB', 'BB', 'UTG']);
  const tete = calculerPositions([2, 5], 5);
  assert.equal(tete.get(5), 'BTN');
  assert.equal(tete.get(2), 'BB');
});

test('le fichier d’exemple : six mains lues, aucune ignorée', () => {
  assert.equal(decouperMains(EXEMPLE).length, 6);
  const { mains, ignorees } = lireHistorique(EXEMPLE);
  assert.deepEqual(ignorees, []);
  assert.equal(mains.length, 6);
  assert.deepEqual(mains.map((m) => m.site), ['pokerstars', 'pokerstars', 'pokerstars', 'pokerstars', 'winamax', 'pokerstars']);
  assert.ok(mains.every((m) => m.hero === 'Hero' && m.grosseBlinde === 0.1));
});

test('une main rejouée : investissements, gains, décisions', () => {
  const [premiere, deuxieme, , , winamax] = lireHistorique(EXEMPLE).mains;

  assert.equal(nomCartes(premiere.cartesHero), 'Ah Kd');
  assert.equal(nomCartes(premiere.tableau), 'Kc 7h 2d 9s 3c');
  assert.equal(premiere.investi.Hero, 1.9);
  assert.equal(premiere.gains.Ines, 3.8);
  assert.equal(premiere.positionHero, 'CO');
  assert.deepEqual(premiere.decisions.map((d) => [d.rue, d.action, d.pot, d.aSuivre]), [['turn', 'suit', 2.65, 1.2]]);

  // Tapis : la mise non suivie revient à Margot.
  assert.equal(deuxieme.investi.Margot, 8.15);
  assert.equal(deuxieme.investi.Hero, 8.15);
  assert.equal(deuxieme.tapisEngage, true);
  assert.equal(deuxieme.derniereRueAvecMise, 'preflop');
  assert.deepEqual(deuxieme.restants.sort(), ['Hero', 'Margot']);
  assert.equal(deuxieme.decisions[0].finDesMises, true);

  // Winamax n'écrit pas la mise non suivie : elle est déduite.
  assert.equal(winamax.rendus.Hero, 1.2);
  assert.equal(winamax.investi.Hero, 1);
  assert.equal(winamax.gains.Hero, 2);
});

test('un historique en français (format supposé) se lit aussi', () => {
  const texte = `Betclic Poker - Main #77 - Hold'em No Limit (0,05 €/0,10 €) - 20/10/2026 21:30:00
Table 'Paris 3' 6-max Siège #1 est le bouton
Siège 1: Lucien (10 €)
Siège 2: Moi (10 €)
Siège 3: Margot (10 €)
Moi paye la petite blinde 0,05 €
Margot paye la grosse blinde 0,10 €
*** PRÉ-FLOP ***
Cartes distribuées à Moi [Ah Kd]
Lucien relance de 0,20 € à 0,30 €
Moi relance de 0,70 € à 1 €
Margot se couche
Lucien suit 0,70 €
*** FLOP *** [Kc 7h 2d]
Moi mise 1,50 €
Lucien se couche
Moi remporte 3,40 €
*** RÉSUMÉ ***
Pot total 3,50 € | Rake 0,10 €`;
  const { mains, ignorees } = lireHistorique(texte);
  assert.deepEqual(ignorees, []);
  const [m] = mains;
  assert.equal(m.site, 'betclic');
  assert.equal(m.hero, 'Moi');
  assert.equal(m.grosseBlinde, 0.1);
  assert.equal(m.positionHero, 'SB');
  assert.equal(m.investi.Moi, 1);
  assert.equal(m.gains.Moi, 3.4);
  assert.equal(m.rake, 0.1);
});

test('une main illisible est signalée, pas avalée', () => {
  const { mains, ignorees } = lireHistorique(`PokerStars Hand #1: Hold'em No Limit (€0.05/€0.10 EUR)\nRien d'autre ici.`);
  assert.equal(mains.length, 0);
  assert.equal(ignorees.length, 1);
  assert.match(ignorees[0].erreur, /joueurs/);
});

test('l’analyse de la session d’exemple', () => {
  const { mains } = lireHistorique(EXEMPLE);
  const r = analyserSession(mains, { graine: 1 });
  assert.equal(r.hero, 'Hero');
  assert.equal(r.nbMains, 6);
  proche(r.stats.vpip, 5 / 6);
  proche(r.stats.pfr, 3 / 6);
  // −1,90 −8,15 +0 +6,40 +1 −4,35
  proche(r.stats.resultat, -7, 1e-6);

  // Deux tapis montrés : AA contre KK (perdu), 98h contre AK sur le flop (gagné).
  assert.equal(r.tapis.mains.length, 2);
  const [aa, tirage] = r.tapis.mains;
  proche(aa.equite, 0.819, 0.002);
  proche(aa.reel, -8.15, 1e-6);
  proche(aa.attendu, aa.equite * 16.35 - 8.15, 1e-6);
  proche(tirage.reel, 6.4, 1e-6);
  proche(r.tapis.chance, r.tapis.reel - r.tapis.attendu, 1e-6);

  // Les calls du tournant et de la rivière avec JT sans rien sont signalés.
  const fautes = r.decisions.erreurs.map((e) => `${e.id}:${e.rue}:${e.action}`);
  assert.ok(fautes.includes('250000000006:river:Payé'));
  assert.ok(fautes.includes('250000000006:turn:Payé'));
  assert.ok(!fautes.some((f) => f.startsWith('250000000002')), 'payer le tapis avec AA est juste');

  const texte = formaterRapport(r);
  assert.match(texte, /Tu joues trop de mains/);
  assert.match(texte, /Malchance sur les tapis/);
});

test('les fuites suivent les repères', () => {
  const sain = detecterFuites({ mains: 1000, vpip: 0.24, pfr: 0.19, af: 2.5, wtsd: 0.28, wsd: 0.52 });
  assert.deepEqual(sain, []);
  const passif = detecterFuites({ mains: 1000, vpip: 0.45, pfr: 0.08, af: 0.8, wtsd: 0.4, wsd: 0.4 });
  const titres = passif.map((f) => f.titre);
  assert.ok(titres.includes('Tu joues trop de mains'));
  assert.ok(titres.includes('Trop de calls avant le flop'));
  assert.ok(titres.includes('Trop passif après le flop'));
  assert.ok(titres.some((t) => /abattage/.test(t)));
});

test('sans cartes du héros, rien à analyser mais un message clair', () => {
  const r = analyserSession([]);
  assert.equal(r.hero, null);
  assert.match(r.avertissements[0], /Dealt to/);
});
