import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lireHistorique } from '../src/analyse/historique.js';
import { analyserSession } from '../src/analyse/detection.js';
import { resumeMain, courbeGains, regrouper, filtrerMains, etapesDeMain } from '../src/analyse/suivi.js';

const lire = (f) => lireHistorique(readFileSync(new URL(`../exemples/${f}`, import.meta.url), 'utf8')).mains;

test('une ligne par main, et la courbe retombe sur le résultat total', () => {
  const mains = lire('spin-rush-exemple.txt');
  const lignes = mains.map((m) => resumeMain(m));
  const total = lignes.reduce((t, l) => t + l.net, 0);
  const courbe = courbeGains(lignes);
  assert.equal(courbe.length, lignes.length);
  assert.equal(courbe.at(-1).cumul, Math.round(total * 100) / 100);
  const r = analyserSession(mains);
  assert.equal(Math.round(total * 100) / 100, Math.round(r.stats.resultat * 100) / 100);
});

test('la courbe all-in EV retire la chance des tapis', () => {
  const mains = lire('session-exemple.txt');
  const lignes = mains.map((m) => resumeMain(m));
  const r = analyserSession(mains, { graine: 1 });
  const chances = new Map(r.tapis.mains.map((t) => [t.id, t.chance]));
  const c = courbeGains(lignes, chances);
  assert.ok(Math.abs(c.at(-1).cumul - c.at(-1).ev - r.tapis.chance) < 0.02);
});

test('les regroupements et les filtres', () => {
  const lignes = lire('spin-rush-exemple.txt').map((m) => resumeMain(m));
  const parPosition = regrouper(lignes, 'position');
  assert.equal(parPosition.reduce((t, g) => t + g.mains, 0), lignes.length);
  const gagnees = filtrerMains(lignes, { resultat: 'gagnees' });
  assert.ok(gagnees.every((l) => l.net > 0));
  const paires = filtrerMains(lignes, { range: '22+' });
  assert.ok(paires.every((l) => l.classe.length === 2));
  assert.ok(filtrerMains(lignes, { tapis: true }).every((l) => l.tapis));
  assert.ok(filtrerMains(lignes, { rueMin: 'river' }).every((l) => l.rueMax === 'river'));
});

test('le rejeu : les jetons se retrouvent à la fin', () => {
  for (const m of lire('session-exemple.txt')) {
    const etapes = etapesDeMain(m);
    const fin = etapes.at(-1);
    assert.ok(fin.fin);
    const avant = m.joueurs.reduce((t, j) => t + j.tapis, 0);
    const apres = Object.values(fin.tapis).reduce((t, x) => t + x, 0);
    // Seul le rake disparaît.
    assert.ok(Math.abs(avant - apres - (Number.isFinite(m.rake) ? m.rake : 0)) < 0.02, `${m.id} : ${avant} → ${apres}`);
  }
});
