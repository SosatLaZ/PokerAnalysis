#!/usr/bin/env node
// La ligne de commande. `node bin/poker.js aide` pour l'aide.

import { readFileSync } from 'node:fs';
import {
  lireCartes,
  afficherCartes,
  lireJoueur,
  lireRange,
  decrireRange,
  calculerEquite,
  deciderSuivre,
  analyserTapis,
  lireHistorique,
  analyserSession,
  formaterRapport,
  decrireScore,
  evaluer,
  pct,
  montant,
} from '../src/index.js';

const AIDE = `Analyse d'équité au Texas Hold'em No Limit.

  poker equite <ta main> <adversaire> [<adversaire>…] [--tableau "Kh 7d 2c"] [--mortes "…"] [--iterations N]
      Équité de chaque joueur. Un joueur est une main (« Ah Kh ») ou une range (« QQ+,AK », « 20% », « aléatoire »).
      ex. poker equite "Ah Kh" "QQ+,AK" --tableau "Qh 7h 2c"

  poker decision <ta main> --contre <range> --pot <pot> --a-suivre <mise> [--adversaires N] [--tableau "…"]
                 [--rake 0.05] [--plafond-rake 3] [--implicites X]
      Suivre ou se coucher : ton équité face à la cote du pot. Le pot compte la mise adverse.
      ex. poker decision "Ah Kh" --contre "25%" --tableau "Qh 7h 2c" --pot 12 --a-suivre 6

  poker tapis <ta main> --pot <pot> --tapis <ton tapis> --tapis-adverse <tapis> [--poste X] [--poste-adverse Y]
              [--derriere N] [--appel <range>]
      Tapis ou se coucher, pour les tapis courts (tournois, Twister). Montants en grosses blindes ou en jetons.
      ex. poker tapis "A7o" --pot 1.5 --poste 0.5 --poste-adverse 1 --tapis 9.5 --tapis-adverse 20 --appel "25%"

  poker analyser <fichier> [--hero Nom] [--range-adverse "30%"] [--json]
      Détection des fuites, de la chance sur les tapis et des calls contraires à la cote, dans un historique de mains.

  poker range "<range>"     Ce que contient une range.
  poker main "<cartes>"     Ce que vaut une main de 5 à 7 cartes.
`;

function lireArguments(argv) {
  const positionnels = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const cle = a.slice(2);
      const suivant = argv[i + 1];
      if (suivant === undefined || suivant.startsWith('--')) options[cle] = true;
      else {
        options[cle] = suivant;
        i++;
      }
    } else positionnels.push(a);
  }
  return { positionnels, options };
}

function nombre(options, cle, defaut) {
  if (options[cle] === undefined) {
    if (defaut === undefined) throw new Error(`Option manquante : --${cle}`);
    return defaut;
  }
  const n = Number(String(options[cle]).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`--${cle} attend un nombre (reçu : « ${options[cle]} »)`);
  return n;
}

/** Ta main : deux cartes (« Ah 7d ») ou, avant le flop, sa classe (« A7o », « 99 »). */
function lireMainHero(texte) {
  const t = String(texte).trim();
  if (/^(10|[2-9TJQKA])(10|[2-9TJQKA])[so]?$/i.test(t)) {
    const combos = lireRange(t);
    // « A7 » sans s ni o : on ne devine pas.
    if (!/^(.)\1$/.test(t.replace(/10/g, 'T')) && !/[so]$/i.test(t)) {
      throw new Error(`Précise assortie ou dépareillée : « ${t}s » ou « ${t}o »`);
    }
    return combos[0];
  }
  const cartes = lireCartes(t);
  if (cartes.length !== 2) throw new Error(`Il faut tes deux cartes (« Ah 7d ») ou leur classe (« A7o ») : « ${t} »`);
  return cartes;
}

function commandeEquite({ positionnels, options }) {
  if (positionnels.length < 2) throw new Error('Il faut au moins deux joueurs : poker equite "Ah Kh" "QQ"');
  const joueurs = positionnels.map(lireJoueur);
  const tableau = lireCartes(options.tableau ?? '');
  const mortes = lireCartes(options.mortes ?? '');
  const r = calculerEquite({ joueurs, tableau, mortes, iterations: nombre(options, 'iterations', 200_000) });
  console.log(tableau.length ? `Tableau : ${afficherCartes(tableau)}` : 'Avant le flop');
  positionnels.forEach((texte, i) => {
    const j = r.joueurs[i];
    const nom = (i === 0 ? 'Toi' : `Adversaire ${i}`).padEnd(12);
    const qui = joueurs[i].length === 1 ? afficherCartes(joueurs[i][0]) : `${texte} — ${decrireRange(joueurs[i])}`;
    console.log(`${nom} ${pct(j.equite, 2).padStart(8)}   gagne ${pct(j.victoire).padStart(7)}  partage ${pct(j.egalite).padStart(6)}   ${qui}`);
  });
  console.log(methode(r));
}

function methode(r) {
  return r.methode === 'exacte'
    ? `Calcul exact sur ${r.echantillons.toLocaleString('fr-FR')} distributions (${r.dureeMs} ms).`
    : `Monte-Carlo, ${r.echantillons.toLocaleString('fr-FR')} tirages, à ±${pct(1.96 * r.joueurs[0].erreurType, 2)} près (${r.dureeMs} ms).`;
}

function commandeDecision({ positionnels, options }) {
  if (positionnels.length !== 1) throw new Error('Il faut ta main : poker decision "Ah Kh" --contre "25%" …');
  const main = lireMainHero(positionnels[0]);
  const range = lireRange(options.contre ?? 'aléatoire');
  const nbAdversaires = nombre(options, 'adversaires', 1);
  const tableau = lireCartes(options.tableau ?? '');
  const joueurs = [[main], ...Array.from({ length: nbAdversaires }, () => range)];
  const r = calculerEquite({ joueurs, tableau, iterations: nombre(options, 'iterations', 200_000) });
  const d = deciderSuivre({
    equite: r.joueurs[0].equite,
    pot: nombre(options, 'pot'),
    aSuivre: nombre(options, 'a-suivre', 0),
    nbAdversaires,
    rake: nombre(options, 'rake', 0),
    plafondRake: nombre(options, 'plafond-rake', Infinity),
    gainsImplicites: nombre(options, 'implicites', 0),
    cartesARetourner: 5 - tableau.length,
  });
  console.log(`${afficherCartes(main)}${tableau.length ? ` sur ${afficherCartes(tableau)}` : ''} contre ${nbAdversaires} × ${options.contre ?? 'aléatoire'}`);
  console.log('');
  console.log(`  → ${d.titre.toUpperCase()}`);
  console.log('');
  for (const raison of d.raisons) console.log(`  · ${raison}`);
  console.log('');
  console.log(methode(r));
}

function commandeTapis({ positionnels, options }) {
  if (positionnels.length !== 1) throw new Error('Il faut ta main : poker tapis "A7o" --pot 1.5 --tapis 9.5 …');
  const main = lireMainHero(positionnels[0]);
  const d = analyserTapis({
    main,
    rangeAppel: lireRange(options.appel ?? '25%'),
    nbAdversaires: nombre(options, 'derriere', 1),
    pot: nombre(options, 'pot'),
    posteHero: nombre(options, 'poste', 0),
    posteAdverse: nombre(options, 'poste-adverse', 0),
    tapisHero: nombre(options, 'tapis'),
    tapisAdverse: nombre(options, 'tapis-adverse'),
    iterations: nombre(options, 'iterations', 100_000),
  });
  console.log(`${afficherCartes(main)}, tapis de ${montant(nombre(options, 'tapis'))}, range d'appel « ${options.appel ?? '25%'} »`);
  console.log('');
  console.log(`  → ${d.titre.toUpperCase()}`);
  console.log('');
  for (const raison of d.raisons) console.log(`  · ${raison}`);
}

function commandeAnalyser({ positionnels, options }) {
  if (positionnels.length !== 1) throw new Error('Il faut un fichier : poker analyser mes-mains.txt');
  const texte = readFileSync(positionnels[0], 'utf8');
  const { mains, ignorees } = lireHistorique(texte);
  const rapport = analyserSession(mains, {
    hero: typeof options.hero === 'string' ? options.hero : undefined,
    rangeAdverse: typeof options['range-adverse'] === 'string' ? options['range-adverse'] : '30%',
  });
  if (options.json) {
    console.log(JSON.stringify({ ...rapport, ignorees }, null, 2));
    return;
  }
  console.log(formaterRapport(rapport));
  if (ignorees.length > 0) {
    console.log('');
    console.log(`${ignorees.length} main(s) non lue(s) :`);
    for (const m of ignorees.slice(0, 10)) console.log(`  ${m.id ?? '?'} : ${m.erreur} — « ${m.debut} »`);
  }
}

function commandeRange({ positionnels }) {
  const combos = lireRange(positionnels.join(' '));
  console.log(decrireRange(combos));
}

function commandeMain({ positionnels }) {
  const cartes = lireCartes(positionnels.join(' '));
  if (cartes.length < 5 || cartes.length > 7) throw new Error('Il faut de 5 à 7 cartes.');
  console.log(`${afficherCartes(cartes)} : ${decrireScore(evaluer(cartes))}`);
}

const COMMANDES = {
  equite: commandeEquite,
  équité: commandeEquite,
  decision: commandeDecision,
  décision: commandeDecision,
  tapis: commandeTapis,
  analyser: commandeAnalyser,
  range: commandeRange,
  main: commandeMain,
};

const [commande, ...reste] = process.argv.slice(2);
if (!commande || commande === 'aide' || commande === '--aide' || commande === '-h' || commande === '--help') {
  console.log(AIDE);
} else if (!COMMANDES[commande]) {
  console.error(`Commande inconnue : « ${commande} ».\n`);
  console.log(AIDE);
  process.exitCode = 1;
} else {
  try {
    COMMANDES[commande](lireArguments(reste));
  } catch (e) {
    console.error(`Erreur : ${e.message}`);
    process.exitCode = 1;
  }
}
