import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCartes } from '../src/moteur/cartes.js';
import { conseillerTous } from '../src/strategie/bot.js';
import { evaluerDecision, bilanEntrainement } from '../src/analyse/entrainement.js';

const c = lireCartes;
const s32 = {
  main: c('3d 2h'), position: 'SB', grosseBlinde: 20, pot: 30, aSuivre: 10, dejaMise: 10, miseActuelle: 20, relanceMin: 40, tapis: 490,
  adversaires: [{ nom: 'bec', position: 'BB', tapis: 480, mise: 20, actionPreflop: 'grosse-blinde' }], nbRelancesPreflop: 0, joueursDerriere: 1,
};

test('tapis 32o à 25 bb : n’importe quoi', () => {
  const d = evaluerDecision({ situation: s32, action: { type: 'tapis' }, tempsMs: 900, conseils: conseillerTous(s32) });
  assert.equal(d.verdict, 'nimportequoi');
  assert.match(d.raisons[0], /Sans peur/);
});

test('se coucher quand checker est gratuit : n’importe quoi', () => {
  const s = { ...s32, position: 'BB', aSuivre: 0, dejaMise: 20, tapis: 480 };
  const d = evaluerDecision({ situation: s, action: { type: 'couche' }, tempsMs: 500, conseils: conseillerTous(s) });
  assert.equal(d.verdict, 'nimportequoi');
});

test('jouer comme le Solide : bon ; comme un autre profil : style', () => {
  const s = { ...s32, main: c('Kd Js') };
  const conseils = conseillerTous(s);
  assert.equal(evaluerDecision({ situation: s, action: { type: 'relance', montant: 56 }, tempsMs: 3000, conseils }).verdict, 'bon');
  const sAA = { ...s32, main: c('As Ah') };
  assert.notEqual(evaluerDecision({ situation: sAA, action: { type: 'couche' }, tempsMs: 3000, conseils: conseillerTous(sAA) }).verdict, 'bon');
});

test('le bilan : score, temps, style, tilt', () => {
  const dec = (numeroMain, verdict, tempsMs, solide = true) => ({ numeroMain, verdict, tempsMs, rue: 'preflop', accords: { prudent: false, solide, agressif: !solide, 'sans-peur': false } });
  const decisions = [
    ...Array.from({ length: 10 }, (_, k) => dec(k + 1, 'bon', 6000)),
    ...Array.from({ length: 6 }, (_, k) => dec(12 + k, k < 4 ? 'nimportequoi' : 'erreur', 1200, false)),
  ];
  const b = bilanEntrainement(decisions, [{ numero: 11, netBb: -25 }, { numero: 1, netBb: 3 }]);
  assert.equal(b.decisions, 16);
  assert.equal(b.compte.nimportequoi, 4);
  assert.ok(b.score < 50);
  assert.equal(b.style[0].profil, 'solide');
  assert.ok(b.tilt.detecte);
  assert.ok(b.alertes.some((a) => /Tilt/.test(a.titre)));
  assert.equal(b.resultatBb, -22);
});
