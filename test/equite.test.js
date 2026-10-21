import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerEquite } from '../src/equite.js';
import { lireCartes } from '../src/cartes.js';
import { lireRange } from '../src/ranges.js';

const main = (texte) => [lireCartes(texte)];
const proche = (x, attendu, tolerance, message) =>
  assert.ok(Math.abs(x - attendu) <= tolerance, `${message ?? ''} ${x} au lieu de ${attendu} ± ${tolerance}`);

test('AA contre KK avant le flop : la valeur de référence, au calcul exact', () => {
  const r = calculerEquite({ joueurs: [main('As Ah'), main('Kd Kc')] });
  assert.equal(r.methode, 'exacte');
  assert.equal(r.echantillons, 1712304); // C(48, 5)
  // Valeur publiée par PokerStove : 81,06 % de victoires, 0,38 % de partages.
  proche(r.joueurs[0].victoire, 0.8106, 0.0005, 'victoires');
  proche(r.joueurs[0].egalite, 0.0038, 0.0002, 'partages');
  proche(r.joueurs[0].equite + r.joueurs[1].equite, 1, 1e-9, 'somme');
});

test('une main dominée et une pièce de monnaie', () => {
  const pieceDeMonnaie = calculerEquite({ joueurs: [main('Ah Kh'), main('Qs Qd')] });
  proche(pieceDeMonnaie.joueurs[0].equite, 0.462, 0.002, 'AKs contre QQ');
  const domine = calculerEquite({ joueurs: [main('7c 2d'), main('As Ah')] });
  proche(domine.joueurs[0].equite, 0.126, 0.002, '72o contre AA');
});

test('à la rivière, le résultat est certain', () => {
  const r = calculerEquite({ joueurs: [main('Ah Kh'), main('Qs Qd')], tableau: lireCartes('Th 9h 2c 3d 4h') });
  assert.equal(r.echantillons, 1);
  assert.equal(r.joueurs[0].equite, 1);
  assert.equal(r.joueurs[1].equite, 0);
});

test('le tableau joue pour tout le monde : partage parfait', () => {
  const r = calculerEquite({ joueurs: [main('2c 3d'), main('4c 5d')], tableau: lireCartes('Ah Kh Qh Jh Th') });
  assert.equal(r.joueurs[0].equite, 0.5);
  assert.equal(r.joueurs[0].egalite, 1);
});

test('Monte-Carlo retombe sur le calcul exact', () => {
  const joueurs = [main('Ah Kh'), main('Qs Qd')];
  const tableau = lireCartes('Th 9h 2c');
  const exact = calculerEquite({ joueurs, tableau });
  const mc = calculerEquite({ joueurs, tableau, methode: 'monte-carlo', iterations: 200_000, graine: 7 });
  assert.equal(exact.methode, 'exacte');
  assert.equal(mc.methode, 'monte-carlo');
  proche(mc.joueurs[0].equite, exact.joueurs[0].equite, 4 * mc.joueurs[0].erreurType + 1e-9, 'écart');
});

test('une graine fixée rejoue le même tirage', () => {
  const opts = { joueurs: [main('Ah Kh'), lireRange('20%')], methode: 'monte-carlo', iterations: 5000, graine: 42 };
  assert.equal(calculerEquite(opts).joueurs[0].equite, calculerEquite(opts).joueurs[0].equite);
});

test('contre une range, à plusieurs, les équités font 100 %', () => {
  const r = calculerEquite({
    joueurs: [main('Jh Jd'), lireRange('22+, AK'), lireRange('aléatoire')],
    tableau: lireCartes('9c 5s 2d'),
    iterations: 50_000,
    graine: 3,
  });
  proche(r.joueurs.reduce((s, j) => s + j.equite, 0), 1, 1e-9, 'somme');
  const freq = r.repartition.reduce((s, x) => s + x.frequence, 0);
  proche(freq, 1, 1e-9, 'répartition');
});

test('les cartes du tableau retirent les combinaisons adverses', () => {
  // Contre AA alors que deux as sont au tableau : il ne reste qu'une combinaison.
  const r = calculerEquite({ joueurs: [main('Kh Kd'), lireRange('AA')], tableau: lireCartes('Ah As 7c') });
  assert.equal(r.joueurs[1].combinaisons, 1);
});

test('les erreurs se disent', () => {
  assert.throws(() => calculerEquite({ joueurs: [main('Ah Kh')] }), /deux joueurs/);
  assert.throws(() => calculerEquite({ joueurs: [main('Ah Kh'), main('Ah Qd')], methode: 'exacte' }), /marchent dessus/);
  assert.throws(() => calculerEquite({ joueurs: [main('Ah Kh'), lireRange('AA')], tableau: lireCartes('Ad As Ac') }), /plus aucune main/);
});
