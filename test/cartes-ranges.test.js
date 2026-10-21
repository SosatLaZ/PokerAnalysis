import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCartes, nomCartes, afficherCartes, classeDeMain } from '../src/moteur/cartes.js';
import { lireRange, lireJoueur, classesPourcentage, retirerBloquees, decrireRange, TOTAL_COMBOS } from '../src/moteur/ranges.js';
import { CLASSES } from '../src/moteur/classes.js';
import { CLASSEMENT } from '../src/moteur/classement.js';

test('les cartes se lisent dans toutes les écritures courantes', () => {
  const attendu = 'Ah Kd Tc 9s';
  for (const texte of ['Ah Kd Tc 9s', 'AhKdTc9s', 'Ah,Kd,Tc,9s', 'ah kd tc 9s', 'A♥ K♦ 10♣ 9♠', '[Ah Kd Tc 9s]', 'Ah Kd 10c 9s']) {
    assert.equal(nomCartes(lireCartes(texte)), attendu, texte);
  }
  assert.equal(afficherCartes(lireCartes('Ah Td')), 'A♥ 10♦');
  assert.deepEqual(lireCartes(''), []);
});

test('une carte en double ou illisible est refusée avec un message clair', () => {
  assert.throws(() => lireCartes('Ah Ah'), /deux fois/);
  assert.throws(() => lireCartes('Ah Kx'), /illisibles/);
  assert.throws(() => lireCartes('1h'), /illisibles/);
});

test('la classe d’une main', () => {
  assert.equal(classeDeMain(...lireCartes('Kd Ah')), 'AKo');
  assert.equal(classeDeMain(...lireCartes('9s 8s')), '98s');
  assert.equal(classeDeMain(...lireCartes('7c 7d')), '77');
});

test('169 classes, 1 326 combinaisons, toutes classées', () => {
  assert.equal(CLASSES.length, 169);
  assert.equal(new Set(CLASSEMENT).size, 169);
  assert.deepEqual([...CLASSEMENT].sort(), [...CLASSES].sort());
  assert.equal(lireRange('aléatoire').length, TOTAL_COMBOS);
  assert.equal(lireRange('*').length, TOTAL_COMBOS);
  assert.equal(lireRange('100%').length, TOTAL_COMBOS);
  assert.equal(CLASSEMENT[0], 'AA');
});

test('la notation des ranges', () => {
  const cas = {
    AA: 6,
    AKs: 4,
    AKo: 12,
    AK: 16,
    '22+': 78,
    '77+': 48,
    'A2s+': 48,
    'KTo+': 36,
    'QQ-88': 30,
    '88-QQ': 30,
    'A5s-A2s': 16,
    'K9o-KJo': 36,
    AhKh: 1,
    'A10s': 4,
    'AA, AA, AsAh': 6,
    'QQ+, AK': 34,
    '22+, A2s+, KTo+': 162,
  };
  for (const [texte, n] of Object.entries(cas)) assert.equal(lireRange(texte).length, n, texte);
});

test('les ranges en pourcentage suivent le classement', () => {
  const dix = lireRange('10%');
  assert.ok(Math.abs(dix.length / TOTAL_COMBOS - 0.1) < 0.01, `10 % → ${dix.length}`);
  assert.ok(classesPourcentage(10).includes('AA'));
  assert.ok(!classesPourcentage(10).includes('72o'));
  assert.ok(lireRange('5%').length < lireRange('20%').length);
});

test('une range illisible lève une erreur qui montre des exemples', () => {
  assert.throws(() => lireRange('AKx'), /exemples/);
  assert.throws(() => lireRange('AKs-QJs'), /Intervalle/);
  assert.throws(() => lireRange('AAs'), /ni assortie/);
  assert.throws(() => lireRange('150%'), /hors limites/);
  assert.throws(() => lireRange(''), /vide/);
});

test('un joueur : deux cartes donnent une main, le reste une range', () => {
  assert.equal(lireJoueur('Ah Kh').length, 1);
  assert.equal(lireJoueur('AhKh').length, 1);
  assert.equal(lireJoueur('AK').length, 16);
  assert.equal(lireJoueur('20%').length, lireRange('20%').length);
});

test('les cartes connues retirent des combinaisons', () => {
  const aa = lireRange('AA');
  assert.equal(retirerBloquees(aa, lireCartes('Ah')).length, 3);
  assert.equal(retirerBloquees(aa, lireCartes('Ah As')).length, 1);
  assert.equal(decrireRange(lireRange('AA')), '6 combinaisons (0,5 % des mains)');
});
