import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluer, categorieDe, decrireMain, CATEGORIES } from '../src/evaluateur.js';
import { lireCartes } from '../src/cartes.js';

const score = (texte) => evaluer(lireCartes(texte));

test('les 2 598 960 mains de 5 cartes tombent dans les bonnes catégories', () => {
  const comptes = new Array(9).fill(0);
  const m = [0, 0, 0, 0, 0];
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++)
        for (let d = c + 1; d < 52; d++)
          for (let e = d + 1; e < 52; e++) {
            m[0] = a; m[1] = b; m[2] = c; m[3] = d; m[4] = e;
            comptes[categorieDe(evaluer(m))]++;
          }
  // Les fréquences théoriques du poker à 5 cartes.
  assert.deepEqual(comptes, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
});

test('l’ordre des catégories', () => {
  const mains = [
    'Ah Kd 9c 7s 3h 2d 4c', // hauteur
    '2h 2d 9c 7s 3h Kd 4c', // paire
    '2h 2d 9c 9s 3h Kd 4c', // double paire
    '2h 2d 2c 9s 3h Kd 4c', // brelan
    '2h 3d 4c 5s 6h Kd Qc', // quinte
    '2h 7h 9h Jh Kh Ad 4c', // couleur
    '2h 2d 2c 9s 9h Kd 4c', // full
    '2h 2d 2c 2s 9h Kd 4c', // carré
    '5h 6h 7h 8h 9h Kd 4c', // quinte flush
  ];
  mains.forEach((m, i) => assert.equal(categorieDe(score(m)), i, `${m} → ${CATEGORIES[i]}`));
});

test('la roue est la plus petite quinte, et l’as ne fait pas le tour', () => {
  assert.ok(score('Ah 2d 3c 4s 5h') < score('2d 3c 4s 5h 6d'));
  assert.equal(categorieDe(score('Qh Kd Ac 2s 3h')), 0); // Q-K-A-2-3 n'est pas une quinte
  assert.ok(score('Th Jd Qc Ks Ah') > score('9h Td Jc Qs Kh'));
});

test('les départageants comptent', () => {
  assert.ok(score('Ah Ad Kc 9s 3h') > score('Ah Ad Qc Js Th'));
  assert.ok(score('Kh Kd 7c 7s Ah') > score('Kh Kd 7c 7s Qh'));
  // Trois paires : la meilleure carte restante départage, même si elle vient d'une paire.
  assert.equal(score('Kh Kd 7c 7s 5h 5d 2c'), score('Kh Kd 7c 7s 5c 2d 3c'));
  assert.ok(score('Kh Kd 7c 7s 5h 5d 2c') > score('Kh Kd 7c 7s 4h 3d 2c'));
  // Deux brelans : full avec le plus haut, par le second.
  assert.ok(score('9c 9d 9h 8s 8d 3h 2c') > score('9c 9d 9h 2s 2d 2h Ac'));
  // Couleur : on compare les cinq cartes.
  assert.ok(score('Ah Jh 9h 7h 3h') > score('Ah Jh 9h 7h 2h'));
});

test('deux mains de même force ont le même score', () => {
  assert.equal(score('Ah Kd Qc Js 9h'), score('As Kc Qd Jh 9d'));
  assert.equal(score('7h 7d 7c 7s Ah 2d 3c'), score('7h 7d 7c 7s Ac Kd Qc'));
  assert.equal(score('7h 7d 7c 7s Ah 2d 3c'), score('7h 7d 7c 7s As'));
});

test('la description en français', () => {
  assert.equal(decrireMain('Ah Kh Qh Jh Th'), 'Quinte flush royale');
  assert.equal(decrireMain('5c 4d 3h 2s Ac'), 'Quinte hauteur 5');
  assert.equal(decrireMain('As Ah Ad Kc Kd Qs Qh'), 'Full aux As par les Rois');
  assert.equal(decrireMain('Ah Ad Kc Ks 7h 7d 2c'), 'Double paire, As et Rois');
  assert.equal(decrireMain('Qc Qd 9h 7s 2d'), 'Paire de Dames');
});
