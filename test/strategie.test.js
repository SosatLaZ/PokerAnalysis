import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCartes } from '../src/moteur/cartes.js';
import { lireMain, texture, tirages } from '../src/strategie/lecture.js';
import { PROFILS, profil } from '../src/strategie/profils.js';
import { percentileMain, rangePreflop, affinerRange, tranchePreflop } from '../src/strategie/ranges-adverses.js';
import { deciderBot, conseillerTous } from '../src/strategie/bot.js';

const c = lireCartes;

test('la lecture d’une main sur le tableau', () => {
  assert.equal(lireMain(c('9h 9d'), c('Kc 7h 9s')).force, 'monstre'); // brelan servi
  assert.equal(lireMain(c('Ah Kd'), c('Kc 7h 2d')).force, 'forte'); // paire supérieure, kicker as
  assert.equal(lireMain(c('5c 5d'), c('Ks Qd Jh')).force, 'faible'); // petite paire sous le tableau
  assert.equal(lireMain(c('Ah 2h'), c('Kh 9h 4h')).force, 'monstre'); // couleur max
  assert.equal(lireMain(c('2c 3d'), c('Ah Kh Qh Jh Th')).force, 'rien'); // le tableau joue
  assert.equal(lireMain(c('Kh 7h'), c('2s 5d 7d Jc 4d')).detail, 'Deuxième paire (7)');
});

test('les tirages et leurs outs', () => {
  const t1 = tirages(c('Ah 5h'), c('Kh 9h 4c'));
  assert.ok(t1.couleur && t1.couleurMax);
  assert.equal(t1.outs, 9);
  const t2 = tirages(c('8h 6c'), c('9d 7s 2c'));
  assert.ok(t2.quinteOuverte);
  assert.equal(t2.outs, 8);
  const t3 = tirages(c('Ah 5h'), c('Kh 9h 4c 2s'));
  assert.ok(t3.couleur && t3.quinteVentrale);
  assert.equal(t3.outs, 12);
  // À la rivière, plus de tirage.
  assert.equal(tirages(c('Ah 5h'), c('Kh 9h 4c 2s 7d')).outs, 0);
});

test('la texture du tableau', () => {
  assert.ok(texture(c('Kc 7h 2d')).sec);
  assert.ok(texture(c('9h 8h 7c')).coordonne);
  assert.ok(texture(c('Kh 9h 4h')).couleurPossible);
  assert.ok(texture(c('8c 8d 3s')).paire);
});

test('les profils vont du plus sûr au plus risqué', () => {
  assert.deepEqual(PROFILS.map((p) => p.id), ['prudent', 'solide', 'agressif', 'sans-peur']);
  for (let i = 1; i < PROFILS.length; i++) {
    const [a, b] = [PROFILS[i - 1], PROFILS[i]];
    assert.ok(b.ouverture.BTN > a.ouverture.BTN, 'ouvre plus large');
    assert.ok(b.frequenceBluff > a.frequenceBluff, 'bluffe plus');
    assert.ok(b.margeAppel < a.margeAppel, 'exige moins de marge');
    assert.ok(b.seuilEngagement < a.seuilEngagement, 'a moins peur d’engager son tapis');
  }
  assert.throws(() => profil('kamikaze'), /Profil inconnu/);
});

test('le classement en percentile et les ranges adverses', () => {
  assert.ok(percentileMain(c('As Ah')) < 1);
  assert.equal(percentileMain(c('3d 2h')), 100);
  const ouverture = rangePreflop('ouverture', { position: 'BTN', profil: 'solide' });
  const relance = rangePreflop('relance', { position: 'BTN', profil: 'solide' });
  assert.ok(relance.length < ouverture.length);
  // Plus on est court, plus le tapis est large.
  assert.ok(tranchePreflop('tapis', { bbEffectives: 8 })[1] > tranchePreflop('tapis', { bbEffectives: 25 })[1]);
  // Une mise resserre la range ; un check retire des mains fortes.
  const tableau = c('9d 7d Ac');
  const range = rangePreflop('ouverture', { position: 'BTN' }, tableau);
  assert.ok(affinerRange(range, tableau, 'mise').length < range.length);
  assert.ok(affinerRange(range, tableau, 'relance').length < affinerRange(range, tableau, 'mise').length);
});

const situationKJo = {
  main: c('Kd Js'),
  position: 'SB',
  grosseBlinde: 20,
  pot: 30,
  aSuivre: 10,
  dejaMise: 10,
  miseActuelle: 20,
  relanceMin: 40,
  tapis: 490,
  adversaires: [{ nom: 'bec', position: 'BB', tapis: 480, mise: 20, actionPreflop: 'grosse-blinde' }],
  nbRelancesPreflop: 0,
  joueursDerriere: 1,
};

test('KJo en petite blinde à 25 bb : les quatre profils ouvrent', () => {
  for (const d of conseillerTous(situationKJo)) {
    assert.equal(d.action, 'relance', d.nomProfil);
    assert.ok(d.montant >= 40 && d.montant <= 80, `${d.nomProfil} relance à ${d.montant}`);
    assert.ok(d.raisons.length >= 2);
  }
});

test('32o au bouton à 5 bb : personne ne part à tapis', () => {
  const d = conseillerTous({
    main: c('3d 2h'),
    position: 'BTN',
    grosseBlinde: 60,
    pot: 90,
    aSuivre: 60,
    dejaMise: 0,
    miseActuelle: 60,
    relanceMin: 120,
    tapis: 300,
    adversaires: [
      { nom: 'SosoCourt', position: 'SB', tapis: 770, mise: 30 },
      { nom: 'bec', position: 'BB', tapis: 330, mise: 60, actionPreflop: 'grosse-blinde' },
    ],
    nbRelancesPreflop: 0,
    joueursDerriere: 2,
  });
  assert.deepEqual(d.map((x) => x.action), ['couche', 'couche', 'couche', 'couche']);
  assert.ok(d.every((x) => x.ev < 0));
});

test('AA part toujours à tapis quand on est court', () => {
  for (const d of conseillerTous({ ...situationKJo, main: c('As Ah'), tapis: 170, adversaires: [{ ...situationKJo.adversaires[0], tapis: 480 }] })) {
    assert.equal(d.action, 'tapis', d.nomProfil);
  }
});

test('face à un tapis : le prudent jette ce que le sans-peur paie', () => {
  const s = {
    main: c('Ah 9c'),
    position: 'BB',
    grosseBlinde: 20,
    pot: 270,
    aSuivre: 220,
    dejaMise: 20,
    miseActuelle: 240,
    relanceMin: 460,
    tapis: 220,
    adversaires: [{ nom: 'bec', position: 'BTN', tapis: 0, mise: 240, actionPreflop: 'tapis' }],
    nbRelancesPreflop: 1,
  };
  assert.equal(deciderBot(s, 'prudent').action, 'couche');
  assert.equal(deciderBot(s, 'sans-peur').action, 'suit');
});

test('après le flop : un tirage max paie une demi-mise au pot, une main morte se couche', () => {
  const base = {
    tableau: c('Kh 9h 4c 2s'),
    position: 'BTN',
    grosseBlinde: 2,
    pot: 30,
    aSuivre: 10,
    dejaMise: 0,
    miseActuelle: 10,
    relanceMin: 20,
    tapis: 170,
    adversaires: [{ nom: 'V', position: 'BB', tapis: 160, mise: 10, actionPreflop: 'suivi', actionsPostflop: [{ rue: 'flop', type: 'parole' }, { rue: 'turn', type: 'mise' }] }],
    nbRelancesPreflop: 1,
    agresseurPreflop: 'hero',
  };
  for (const d of conseillerTous({ ...base, main: c('Ah 5h') })) assert.notEqual(d.action, 'couche', d.nomProfil);
  for (const d of conseillerTous({ ...base, main: c('7c 6d') })) assert.equal(d.action, 'couche', d.nomProfil);
});

test('une même situation donne une même décision', () => {
  const s = { ...situationKJo, main: c('7h 6h'), tableau: c('8h 5c 2d'), aSuivre: 0, dejaMise: 0, miseActuelle: 0, pot: 120, nbRelancesPreflop: 1, agresseurPreflop: 'hero' };
  for (const p of PROFILS) assert.deepEqual(deciderBot(s, p.id), deciderBot(s, p.id));
});

test('une situation incomplète est refusée clairement', () => {
  assert.throws(() => deciderBot({ ...situationKJo, main: c('Ah') }), /deux cartes/);
  assert.throws(() => deciderBot({ ...situationKJo, adversaires: [] }), /adversaire/);
  assert.throws(() => deciderBot({ ...situationKJo, tableau: c('Ah Kd') }), /0, 3, 4 ou 5/);
});
