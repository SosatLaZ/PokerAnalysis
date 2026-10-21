// Génère src/moteur/classement.js : les 169 mains de départ rangées de la plus forte à
// la plus faible, selon leur équité contre une main adverse au hasard (le
// classement « PokerStove »). C'est lui qui donne un sens à « les 15 % meilleures mains ».
//
//   node scripts/generer-classement.mjs [itérations par main, défaut 400000]

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLASSES, combosDeClasse } from '../src/moteur/classes.js';
import { calculerEquite } from '../src/moteur/equite.js';

const iterations = Number(process.argv[2] ?? 400_000);
const toutes = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) toutes.push([a, b]);

const lignes = [];
const debut = Date.now();
for (const [i, classe] of CLASSES.entries()) {
  const main = combosDeClasse(classe)[0];
  const adverse = toutes.filter(([a, b]) => a !== main[0] && a !== main[1] && b !== main[0] && b !== main[1]);
  const r = calculerEquite({ joueurs: [[main], adverse], iterations, graine: 20261021 + i, methode: 'monte-carlo' });
  lignes.push({ classe, equite: r.joueurs[0].equite });
  process.stdout.write(`\r${i + 1}/${CLASSES.length} ${classe.padEnd(4)} ${(r.joueurs[0].equite * 100).toFixed(2)} %   `);
}
lignes.sort((x, y) => y.equite - x.equite);
process.stdout.write(`\nTerminé en ${((Date.now() - debut) / 1000).toFixed(1)} s\n`);

const corps = lignes.map((l) => `  ['${l.classe}', ${(l.equite * 100).toFixed(2)}],`).join('\n');
const fichier = `// Fichier généré par scripts/generer-classement.mjs (${iterations} tirages par main) : ne pas modifier à la main.
//
// Les 169 mains de départ, de la plus forte à la plus faible, avec leur équité
// (en %) contre une main adverse tirée au hasard.

export const CLASSEMENT_EQUITES = [
${corps}
];

export const CLASSEMENT = CLASSEMENT_EQUITES.map(([classe]) => classe);
`;
writeFileSync(fileURLToPath(new URL('../src/moteur/classement.js', import.meta.url)), fichier);
console.log('src/moteur/classement.js écrit.');
