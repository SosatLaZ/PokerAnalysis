// Le calcul d'équité : la part du pot qu'une main gagne en moyenne si tout le
// monde va jusqu'à l'abattage.
//
// Deux méthodes, choisies toutes seules :
//   - exacte : on énumère toutes les distributions possibles (mains adverses
//     de la range × cartes du tableau restantes) quand il y en a assez peu ;
//   - Monte-Carlo : on tire au hasard un grand nombre de distributions et on
//     donne l'erreur type du résultat.
//
// Chaque joueur est décrit par une range : une liste de combinaisons [c1, c2].
// Une main connue est une range d'une seule combinaison.

import { evaluer, categorieDe, CATEGORIES } from './evaluateur.js';
import { verifierSansDoublon, nomCarte } from './cartes.js';
import { creerAleatoire } from './aleatoire.js';

/** Au-delà de ce nombre de distributions, on passe en Monte-Carlo. */
export const LIMITE_EXACTE = 2_000_000;

export const ITERATIONS_PAR_DEFAUT = 100_000;

function combinaisons(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/**
 * @param {object} options
 * @param {Array<Array<[number, number]>>} options.joueurs  une range par joueur ; le joueur 0 est « toi »
 * @param {number[]} [options.tableau]      cartes déjà retournées (0 à 5)
 * @param {number[]} [options.mortes]       cartes qu'on sait hors du jeu
 * @param {number}   [options.iterations]   tirages Monte-Carlo
 * @param {number}   [options.graine]       pour rejouer exactement le même tirage
 * @param {number}   [options.limiteExacte] seuil de l'énumération exacte
 * @param {'auto'|'exacte'|'monte-carlo'} [options.methode]
 * @param {number}   [options.tempsMaxMs]   coupe le Monte-Carlo au bout de ce temps (navigateur)
 */
export function calculerEquite({
  joueurs,
  tableau = [],
  mortes = [],
  iterations = ITERATIONS_PAR_DEFAUT,
  graine,
  limiteExacte = LIMITE_EXACTE,
  methode = 'auto',
  tempsMaxMs = Infinity,
}) {
  if (!Array.isArray(joueurs) || joueurs.length < 2) throw new Error('Il faut au moins deux joueurs.');
  if (joueurs.length > 10) throw new Error('Dix joueurs au plus.');
  if (tableau.length > 5) throw new Error('Le tableau a cinq cartes au plus.');
  verifierSansDoublon([...tableau, ...mortes]);

  const connues = new Set([...tableau, ...mortes]);
  const ranges = joueurs.map((range, i) => {
    const libres = range.filter(([a, b]) => a !== b && !connues.has(a) && !connues.has(b));
    if (libres.length === 0) {
      throw new Error(
        `Le joueur ${i + 1} n'a plus aucune main possible une fois retirées les cartes du tableau et les cartes mortes.`,
      );
    }
    return libres;
  });

  const n = ranges.length;
  const t = tableau.length;
  const k = 5 - t;
  const tailleTableaux = combinaisons(52 - t - mortes.length - 2 * n, k);
  const tailleExacte = ranges.reduce((p, r) => p * r.length, 1) * tailleTableaux;
  const choix =
    methode === 'auto' ? (tailleExacte <= limiteExacte ? 'exacte' : 'monte-carlo') : methode;

  // Une main de 7 cartes par joueur : [c1, c2, tableau…]. Les cases du tableau
  // sont remplies une fois pour toutes, puis au fil de l'énumération ou des tirages.
  const mains = ranges.map(() => {
    const m = new Array(7).fill(0);
    for (let j = 0; j < t; j++) m[2 + j] = tableau[j];
    return m;
  });
  const scores = new Int32Array(n);
  const part = new Float64Array(n);
  const seul = new Float64Array(n);
  const egalites = new Float64Array(n);
  const repartition = new Float64Array(CATEGORIES.length);
  let total = 0;

  const compter = () => {
    let meilleur = -1;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      const s = evaluer(mains[i], 7);
      scores[i] = s;
      if (s > meilleur) {
        meilleur = s;
        nb = 1;
      } else if (s === meilleur) nb++;
    }
    if (nb === 1) {
      for (let i = 0; i < n; i++) {
        if (scores[i] === meilleur) {
          seul[i]++;
          part[i]++;
        }
      }
    } else {
      const fraction = 1 / nb;
      for (let i = 0; i < n; i++) {
        if (scores[i] === meilleur) {
          egalites[i]++;
          part[i] += fraction;
        }
      }
    }
    repartition[categorieDe(scores[0])]++;
    total++;
  };

  const debut = Date.now();
  if (choix === 'exacte') {
    enumerer({ ranges, mains, connues, t, k, compter });
    if (total === 0) throw new Error('Aucune distribution possible : les ranges se marchent dessus.');
  } else {
    tirer({ ranges, mains, connues, t, k, compter, iterations, graine, tempsMaxMs, debut });
  }

  return {
    methode: choix,
    echantillons: total,
    dureeMs: Date.now() - debut,
    joueurs: ranges.map((range, i) => {
      const equite = part[i] / total;
      return {
        equite,
        victoire: seul[i] / total,
        egalite: egalites[i] / total,
        erreurType: choix === 'exacte' ? 0 : Math.sqrt((equite * (1 - equite)) / total),
        combinaisons: range.length,
      };
    }),
    // La main finale du joueur 0 : « Couleur 6 % », « Paire 42 % »…
    repartition: Array.from(repartition, (x, i) => ({ categorie: CATEGORIES[i], frequence: x / total })),
  };
}

function enumerer({ ranges, mains, connues, t, k, compter }) {
  const n = ranges.length;
  const prises = new Uint8Array(52);
  for (const c of connues) prises[c] = 1;

  const parcourirTableaux = (restant, depart, profondeur) => {
    if (profondeur === k) {
      compter();
      return;
    }
    const pos = 2 + t + profondeur;
    const fin = restant.length - (k - profondeur);
    for (let j = depart; j <= fin; j++) {
      const c = restant[j];
      for (let i = 0; i < n; i++) mains[i][pos] = c;
      parcourirTableaux(restant, j + 1, profondeur + 1);
    }
  };

  const distribuer = (i) => {
    if (i === n) {
      const restant = [];
      for (let c = 0; c < 52; c++) if (!prises[c]) restant.push(c);
      parcourirTableaux(restant, 0, 0);
      return;
    }
    for (const [a, b] of ranges[i]) {
      if (prises[a] || prises[b]) continue;
      prises[a] = 1;
      prises[b] = 1;
      mains[i][0] = a;
      mains[i][1] = b;
      distribuer(i + 1);
      prises[a] = 0;
      prises[b] = 0;
    }
  };
  distribuer(0);
}

function tirer({ ranges, mains, connues, t, k, compter, iterations, graine, tempsMaxMs, debut }) {
  const n = ranges.length;
  const aleatoire = creerAleatoire(graine);
  const base = [];
  for (let c = 0; c < 52; c++) if (!connues.has(c)) base.push(c);
  const prises = new Uint8Array(52);
  const marquees = new Int8Array(2 * n + 5);

  for (let it = 0; it < iterations; it++) {
    if (tempsMaxMs !== Infinity && (it & 1023) === 0 && it > 0 && Date.now() - debut > tempsMaxMs) break;

    // Les mains : on retire tout et on recommence au moindre conflit, pour que
    // chaque distribution compatible garde la même probabilité.
    let nbMarquees = 0;
    let essais = 0;
    for (let i = 0; i < n; ) {
      const range = ranges[i];
      const combo = range[Math.floor(aleatoire() * range.length)];
      const a = combo[0];
      const b = combo[1];
      if (prises[a] || prises[b]) {
        for (let j = 0; j < nbMarquees; j++) prises[marquees[j]] = 0;
        nbMarquees = 0;
        i = 0;
        if (++essais > 100_000) {
          throw new Error('Les ranges des joueurs sont incompatibles entre elles (trop de cartes en commun).');
        }
        continue;
      }
      prises[a] = 1;
      prises[b] = 1;
      marquees[nbMarquees++] = a;
      marquees[nbMarquees++] = b;
      mains[i][0] = a;
      mains[i][1] = b;
      i++;
    }

    // Le tableau.
    for (let p = 0; p < k; p++) {
      let c;
      do c = base[Math.floor(aleatoire() * base.length)];
      while (prises[c]);
      prises[c] = 1;
      marquees[nbMarquees++] = c;
      for (let i = 0; i < n; i++) mains[i][2 + t + p] = c;
    }

    compter();
    for (let j = 0; j < nbMarquees; j++) prises[marquees[j]] = 0;
  }
}

/** Pour les messages : « AhKh » ou « 34 combinaisons ». */
export function decrireJoueur(range) {
  return range.length === 1 ? nomCarte(range[0][0]) + nomCarte(range[0][1]) : `${range.length} combinaisons`;
}
