import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerPartie, FORMATS } from '../src/jeu/table.js';
import { jouerLesBots, versActionMoteur } from '../src/jeu/bots.js';
import { lireHistorique } from '../src/analyse/historique.js';
import { creerAleatoire } from '../src/moteur/aleatoire.js';

const somme = (e) => e.joueurs.reduce((t, j) => t + j.tapis, 0);
const trois = (types = ['humain', 'bot', 'bot']) =>
  ['Toi', 'bec', 'SosoCourt'].map((nom, i) => ({ nom, type: types[i], profil: ['solide', 'agressif', 'prudent'][i] }));

test('Spin & Rush : 3 joueurs, 500 jetons, blindes 10/20 au départ', () => {
  const p = creerPartie({ format: 'spin-rush', joueurs: trois(), graine: 1 });
  const e = p.nouvelleMain();
  assert.equal(e.petiteBlinde, 10);
  assert.equal(e.grosseBlinde, 20);
  assert.equal(e.pot, 30);
  assert.equal(somme(e), 1500 - 30);
  // On ne voit que ses propres cartes.
  const vue = p.etat(0);
  assert.equal(vue.joueurs[0].cartes.length, 2);
  assert.equal(vue.joueurs[1].cartes, null);
});

test('les blindes montent toutes les 6 mains', () => {
  const p = creerPartie({ format: 'spin-rush', joueurs: trois(['bot', 'bot', 'bot']), graine: 3 });
  const niveaux = [];
  for (let n = 0; n < 13 && !p.partieFinie(); n++) {
    niveaux.push(p.nouvelleMain().grosseBlinde);
    jouerLesBots(p, { iterations: 300 });
  }
  assert.deepEqual(niveaux.slice(0, 13), [20, 20, 20, 20, 20, 20, 30, 30, 30, 30, 30, 30, 40].slice(0, niveaux.length));
});

test('relance minimum, et un tapis trop court ne rouvre pas les relances', () => {
  const p = creerPartie({ format: 'cash-6max', joueurs: ['A', 'B', 'C'].map((nom) => ({ nom, type: 'humain' })), graine: 2 });
  p.nouvelleMain(); // bouton A (siège 1), B petite blinde 1, C grosse blinde 2 ; A parle
  assert.equal(p.aQui(), 0);
  assert.throws(() => p.jouer(0, { type: 'relance', montant: 3 }), /minimum est 4/);
  p.jouer(0, { type: 'relance', montant: 10 }); // relance de 8
  assert.equal(p.actionsPossibles(1).relance.min, 18);
  p.jouer(1, { type: 'suit' });
  p.jouer(2, { type: 'suit' });
  assert.equal(p.etat().rue, 'flop');
  assert.equal(p.etat().pot, 30);
});

test('une main tête-à-tête : le bouton paie la petite blinde et parle en premier', () => {
  const p = creerPartie({ format: 'tete-a-tete', joueurs: [{ nom: 'A', type: 'humain' }, { nom: 'B', type: 'humain' }], graine: 4 });
  const e = p.nouvelleMain();
  const bouton = e.joueurs[e.bouton];
  assert.equal(bouton.mise, 10);
  assert.equal(p.aQui(), e.bouton);
  p.jouer(e.bouton, { type: 'suit' });
  p.jouer(1 - e.bouton, { type: 'parole' });
  // Après le flop, la grosse blinde parle en premier.
  assert.equal(p.etat().rue, 'flop');
  assert.equal(p.aQui(), 1 - e.bouton);
});

test('tout le monde à tapis : les cartes se retournent, les jetons se conservent', () => {
  const p = creerPartie({ format: 'spin-rush', joueurs: trois(['humain', 'humain', 'humain']), graine: 9 });
  const e = p.nouvelleMain();
  let i = p.aQui();
  p.jouer(i, { type: 'tapis' });
  i = p.aQui();
  p.jouer(i, { type: 'tapis' });
  i = p.aQui();
  p.jouer(i, { type: 'suit' });
  const fin = p.etat();
  assert.equal(fin.terminee, true);
  assert.equal(fin.tableau.length, 5);
  assert.equal(somme(fin), 1500);
  assert.ok(fin.resultat.abattage);
  assert.ok(e.numeroMain === 1);
});

test('se coucher quand checker est gratuit est permis, et noté', () => {
  const p = creerPartie({ format: 'tete-a-tete', joueurs: [{ nom: 'A', type: 'humain' }, { nom: 'B', type: 'humain' }], graine: 4 });
  const e = p.nouvelleMain();
  p.jouer(e.bouton, { type: 'suit' });
  p.jouer(1 - e.bouton, { type: 'couche' });
  const journal = p.etat().journal;
  assert.equal(journal.at(-1).gratuit, true);
});

test('cent parties de bots : aucun jeton perdu, chaque historique relu à l’identique', () => {
  const profils = ['prudent', 'solide', 'agressif', 'sans-peur'];
  let mains = 0;
  for (let g = 0; g < 12; g++) {
    const p = creerPartie({
      format: 'spin-rush',
      joueurs: [0, 1, 2].map((k) => ({ nom: `Bot${k}`, type: 'bot', profil: profils[(g + k) % 4] })),
      graine: 100 + g,
      horloge: () => 1760000000000,
    });
    const aleatoire = creerAleatoire(g);
    while (!p.partieFinie()) {
      p.nouvelleMain();
      jouerLesBots(p, { iterations: 300, aleatoire });
      assert.equal(somme(p.etat()), 1500);
      mains++;
    }
    const { mains: lues, ignorees } = lireHistorique(p.historique());
    assert.deepEqual(ignorees, []);
    const resultats = p.resultats();
    assert.equal(lues.length, resultats.length);
    lues.forEach((m, k) => {
      for (const [nom, net] of Object.entries(resultats[k].net)) {
        const lu = Math.round(((m.gains[nom] ?? 0) - (m.investi[nom] ?? 0)) * 100) / 100;
        assert.equal(lu, net, `main ${m.id}, ${nom}`);
      }
    });
  }
  assert.ok(mains > 100, `${mains} mains`);
});

test('la traduction des décisions du bot en actions légales', () => {
  const possibles = { couche: false, parole: true, suit: false, mise: { min: 20, max: 500 }, relance: null };
  assert.deepEqual(versActionMoteur({ action: 'couche' }, possibles), { type: 'parole' });
  assert.deepEqual(versActionMoteur({ action: 'relance', montant: 60 }, possibles), { type: 'mise', montant: 60 });
  assert.deepEqual(versActionMoteur({ action: 'mise', montant: 900 }, possibles), { type: 'tapis' });
  assert.ok(FORMATS['spin-rush'].tournoi);
});
