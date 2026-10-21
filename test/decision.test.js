import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deciderSuivre, deciderTapis, analyserTapis, equiteRequise } from '../src/decision.js';
import { lireCartes } from '../src/cartes.js';
import { lireRange } from '../src/ranges.js';

const proche = (x, attendu, tolerance = 1e-9) => assert.ok(Math.abs(x - attendu) <= tolerance, `${x} au lieu de ${attendu}`);

test('une mise de la taille du pot demande 33 % d’équité', () => {
  // Pot de 10, l'adversaire mise 10 : le pot fait 20, il faut payer 10 pour en gagner 30.
  proche(equiteRequise({ pot: 20, aSuivre: 10 }), 1 / 3);
  // Une demi-mise au pot demande 25 %.
  proche(equiteRequise({ pot: 15, aSuivre: 5 }), 0.25);
});

test('suivre, se coucher, ou coup limite', () => {
  const base = { pot: 20, aSuivre: 10 };
  assert.equal(deciderSuivre({ ...base, equite: 0.45 }).action, 'SUIVRE');
  assert.equal(deciderSuivre({ ...base, equite: 0.2 }).action, 'SE_COUCHER');
  assert.equal(deciderSuivre({ ...base, equite: 0.34 }).action, 'LIMITE');
  // EV = 0,45 × 30 − 10 = 3,5
  proche(deciderSuivre({ ...base, equite: 0.45 }).ev, 3.5);
});

test('le rake et les gains implicites déplacent le seuil', () => {
  const sansRake = equiteRequise({ pot: 20, aSuivre: 10 });
  const avecRake = equiteRequise({ pot: 20, aSuivre: 10, rake: 0.05 });
  assert.ok(avecRake > sansRake);
  proche(avecRake, 10 / 28.5);
  proche(equiteRequise({ pot: 20, aSuivre: 10, rake: 0.05, plafondRake: 0.5 }), 10 / 29.5);
  assert.ok(equiteRequise({ pot: 20, aSuivre: 10, gainsImplicites: 20 }) < sansRake);
});

test('sans mise à payer : checker ou miser pour la valeur', () => {
  assert.equal(deciderSuivre({ equite: 0.3, pot: 10, aSuivre: 0 }).action, 'CHECKER');
  assert.equal(deciderSuivre({ equite: 0.7, pot: 10, aSuivre: 0 }).action, 'MISER');
  // À quatre, 35 % c'est bien plus que sa part (20 %).
  assert.equal(deciderSuivre({ equite: 0.35, pot: 10, aSuivre: 0, nbAdversaires: 4 }).action, 'MISER');
});

test('les entrées absurdes sont refusées', () => {
  assert.throws(() => deciderSuivre({ equite: 1.2, pot: 10, aSuivre: 5 }), /entre 0 et 1/);
  assert.throws(() => deciderSuivre({ equite: 0.5, pot: -1, aSuivre: 5 }), /positif/);
  assert.throws(() => deciderSuivre({ equite: 0.5, pot: 10, aSuivre: 5, rake: 2 }), /rake/);
});

test('tapis : le calcul à la main', () => {
  // Petite blinde avec 10 bb (0,5 posée, 9,5 derrière) contre la grosse blinde (1 posée, 19 derrière).
  const d = deciderTapis({
    equiteSiSuivi: 0.4,
    probaTousSeCouchent: 0.7,
    pot: 1.5,
    posteHero: 0.5,
    posteAdverse: 1,
    tapisHero: 9.5,
    tapisAdverse: 19,
  });
  // Suivi : pot final 20, on risque 9,5 → 0,4 × 20 − 9,5 = −1,5
  proche(d.evSiSuivi, -1.5);
  proche(d.potFinal, 20);
  // 0,7 × 1,5 + 0,3 × (−1,5) = 0,6
  proche(d.ev, 0.6);
  assert.equal(d.action, 'TAPIS');
});

test('tapis : un adversaire plus court ne peut pas suivre plus que son tapis', () => {
  const d = deciderTapis({ equiteSiSuivi: 0.5, probaTousSeCouchent: 0, pot: 1.5, posteHero: 0.5, posteAdverse: 1, tapisHero: 20, tapisAdverse: 4 });
  // Effectif : 5 (1 + 4). Pot final 10, on risque 4,5.
  proche(d.potFinal, 10);
  proche(d.risque, 4.5);
});

test('tapis de bout en bout : AA part à tapis ; 72o aussi contre une grosse blinde serrée, pas contre une large', () => {
  const commun = { pot: 1.5, posteHero: 0.5, posteAdverse: 1, tapisHero: 14.5, tapisAdverse: 30, iterations: 20_000, graine: 1 };
  assert.equal(analyserTapis({ ...commun, main: lireCartes('As Ah'), rangeAppel: lireRange('10%') }).action, 'TAPIS');
  const r = analyserTapis({ ...commun, main: lireCartes('7c 2d'), rangeAppel: lireRange('8%'), nbAdversaires: 1 });
  assert.equal(r.action, 'TAPIS', 'la grosse blinde se couche 92 % du temps : même 72o y gagne');
  assert.equal(analyserTapis({ ...commun, main: lireCartes('7c 2d'), rangeAppel: lireRange('40%') }).action, 'SE_COUCHER');
});
