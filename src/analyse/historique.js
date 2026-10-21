// La lecture des historiques de mains (hand histories).
//
// Lit le format texte « à la PokerStars », que suivent aussi Winamax et la
// plupart des convertisseurs, ainsi que ses équivalents en français
// (« se couche », « suit », « relance … à … »). Le format d'export de Betclic
// n'a pas pu être vérifié sur un vrai fichier : si une main n'est pas
// reconnue, elle est comptée dans `ignorees` avec la raison, jamais avalée.

import { lireCartes } from '../moteur/cartes.js';

export const RUES = ['preflop', 'flop', 'turn', 'river'];

/** « €1.50 », « 1,50 € », « 1.500 », « 2,000 » → nombre. NaN si illisible. */
export function lireMontant(texte) {
  let s = String(texte ?? '')
    .replace(/[€$£]|EUR|USD|GBP|\(|\)/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (s === '') return NaN;
  const virgule = s.lastIndexOf(',');
  const point = s.lastIndexOf('.');
  if (virgule >= 0 && point >= 0) {
    // Le dernier séparateur est la décimale, l'autre sépare les milliers.
    s = virgule > point ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (virgule >= 0) {
    s = /,\d{3}$/.test(s) && s.split(',').length > 1 && !/^0,/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const ENTETE =
  /^(PokerStars|Winamax|Betclic|PMU|Unibet|iPoker|Poker\s+Hand|Hand\s*#)|Hand\s*#|HandId|(Main|Coup|Partie)\s*(n°|#)/i;

/** Découpe un texte en mains, une par en-tête. */
export function decouperMains(texte) {
  const lignes = String(texte ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocs = [];
  let courant = null;
  for (const ligne of lignes) {
    if (ENTETE.test(ligne.trim()) && !/^\*\*\*/.test(ligne.trim())) {
      if (courant) blocs.push(courant);
      courant = [ligne];
    } else if (courant) courant.push(ligne);
  }
  if (courant) blocs.push(courant);
  if (blocs.length > 0) return blocs.map((b) => b.join('\n').trim()).filter(Boolean);
  // Pas d'en-tête reconnu : un bloc par paragraphe qui ressemble à une main.
  return String(texte ?? '')
    .split(/\n\s*\n\s*\n|\n\s*\n(?=\S)/)
    .map((b) => b.trim())
    .filter((b) => /\*\*\*/.test(b));
}

function rueDepuisMarqueur(nom) {
  const n = nom.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/HOLE|PRE.?FLOP|ANTE|BLIND|CARTES/.test(n)) return 'preflop';
  if (/FIRST|SECOND|1ST|2ND|DEUXIEME|PREMIER/.test(n)) return 'double';
  if (/FLOP/.test(n)) return 'flop';
  if (/TURN|TOURNANT/.test(n)) return 'turn';
  if (/RIVER|RIVIERE/.test(n)) return 'river';
  if (/SHOW|ABATTAGE/.test(n)) return 'abattage';
  if (/SUMMARY|RESUME/.test(n)) return 'resume';
  return null;
}

/** Positions autour de la table, à partir du siège du bouton. */
export function calculerPositions(sieges, siegeBouton) {
  const ordre = [...sieges].sort((a, b) => a - b);
  const n = ordre.length;
  const positions = new Map();
  if (n < 2) return positions;
  let depart = ordre.indexOf(siegeBouton);
  if (depart < 0) {
    // Bouton inconnu ou siège vide : on prend le premier siège avant lui.
    depart = ordre.reduce((meilleur, s, i) => (s < siegeBouton ? i : meilleur), n - 1);
  }
  const tour = Array.from({ length: n }, (_, i) => ordre[(depart + i) % n]);
  if (n === 2) {
    positions.set(tour[0], 'BTN');
    positions.set(tour[1], 'BB');
    return positions;
  }
  positions.set(tour[0], 'BTN');
  positions.set(tour[1], 'SB');
  positions.set(tour[2], 'BB');
  const reste = tour.slice(3);
  reste.forEach((siege, i) => {
    const depuisFin = reste.length - 1 - i;
    let nom = 'MP';
    if (depuisFin === 0) nom = 'CO';
    else if (depuisFin === 1) nom = 'HJ';
    else if (i === 0) nom = 'UTG';
    positions.set(siege, nom);
  });
  return positions;
}

const VERBES = [
  // « poste » d'abord : « paye la petite blinde » n'est pas un call.
  {
    type: 'poste',
    re: /^(?:posts?|poste|paye|paie)\s+(?:the\s+|la\s+|l')?(small\s*&\s*big\s*blinds?|small blind|big blind|petite blinde|grosse blinde|straddle|ante)\s+(\S+)/i,
  },
  { type: 'couche', re: /^(folds|fold|se couche|abandonne)\b/i },
  { type: 'parole', re: /^(checks|check|checke|parole)\b/i },
  { type: 'relance', re: /^(raises|raise|relance)(?:\s+de)?\s+(\S+)\s+(?:to|à|a)\s+(\S+)/i },
  { type: 'relanceA', re: /^(?:relance)\s+(?:à|a)\s+(\S+)/i },
  { type: 'suit', re: /^(calls|call|suit|paye|paie)\s+(\S+)/i },
  { type: 'mise', re: /^(bets|bet|mise)\s+(\S+)/i },
  { type: 'montre', re: /^(?:shows|showed|montre|dévoile|devoile)\s+\[([^\]]+)\]/i },
  { type: 'gagne', re: /^(?:collected|wins|won|remporte|gagne|ramasse|récupère|recupere)\s+\(?([^\s)]+)/i },
];

/**
 * Lit une main. Retourne `{ main }` ou `{ erreur }` (jamais d'exception pour
 * une main mal formée : un historique entier ne doit pas tomber pour une main).
 */
export function lireMain(texte) {
  const lignes = texte.split('\n').map((l) => l.trim()).filter(Boolean);
  const entete = lignes[0] ?? '';
  const main = {
    id: (/#\s*([\w.-]+)/.exec(entete) ?? /(?:n°|HandId:?)\s*([\w.-]+)/i.exec(entete))?.[1] ?? null,
    entete,
    site: /winamax/i.test(entete) ? 'winamax' : /pokerstars/i.test(entete) ? 'pokerstars' : /betclic/i.test(entete) ? 'betclic' : 'inconnu',
    tournoi: /tournament|tournoi|level|niveau|twister|spin|expresso|sit\s*&?\s*go/i.test(entete),
    petiteBlinde: NaN,
    grosseBlinde: NaN,
    joueurs: [], // { siege, nom, tapis }
    siegeBouton: NaN,
    hero: null,
    cartesHero: null,
    tableau: [],
    actions: [], // { rue, joueur, type, ajout, total, tapis }
    montrees: {}, // nom → [c1, c2]
    gains: {}, // nom → montant
    rendus: {}, // nom → montant
    rake: NaN,
    abattage: false,
    doubleTirage: false,
  };

  const blindes = /\(([^()\/]+)\/([^()\/]+?)(?:\s*-[^()]*)?\)/.exec(entete);
  if (blindes) {
    main.petiteBlinde = lireMontant(blindes[1]);
    main.grosseBlinde = lireMontant(blindes[2]);
  }

  let rue = 'preflop';
  let vuMarqueur = false;
  const gainsResume = {};
  for (const ligne of lignes.slice(1)) {
    const marqueur = /^\*\*\*\s*(.+?)\s*\*\*\*\s*(.*)$/.exec(ligne);
    if (marqueur) {
      vuMarqueur = true;
      const r = rueDepuisMarqueur(marqueur[1]);
      if (r === 'double') {
        main.doubleTirage = true;
        continue;
      }
      if (r) rue = r;
      if (r === 'abattage') main.abattage = true;
      if (r === 'flop' || r === 'turn' || r === 'river') {
        const cartes = [...marqueur[2].matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).join(' ');
        try {
          main.tableau = lireCartes(cartes);
        } catch (e) {
          return { erreur: `tableau illisible (${e.message})`, id: main.id };
        }
      }
      continue;
    }

    const bouton = !vuMarqueur && /Seat\s*#?\s*(\d+)\s+is the button|Si[eè]ge\s*#?\s*(\d+)\s+est (?:le )?bouton/i.exec(ligne);
    if (bouton) main.siegeBouton = Number(bouton[1] ?? bouton[2]);

    const siege = /^(?:Seat|Si[eè]ge)\s+(\d+)\s*:\s*(.+?)\s+\(([^)]*)\)/i.exec(ligne);
    if (siege && !vuMarqueur && rue === 'preflop' && main.actions.length === 0) {
      const tapis = lireMontant(siege[3].replace(/in chips|jetons|,?\s*\d+\s*bounty.*$/gi, '').split(/\s+/)[0]);
      if (Number.isFinite(tapis)) main.joueurs.push({ siege: Number(siege[1]), nom: siege[2].trim(), tapis });
      continue;
    }
    if (siege && rue === 'resume') {
      // « Seat 4: Joueur (big blind) showed [9h 9d] and won (€0.66) » : on garde les gains en secours.
      const gagne = /(?:won|collected|remporte|gagne)\s+\(?([^\s)]+)\)?/i.exec(ligne);
      if (gagne) {
        const nom = trouverJoueur(main.joueurs, siege[2].trim());
        if (nom) gainsResume[nom] = (gainsResume[nom] ?? 0) + lireMontant(gagne[1]);
      }
      continue;
    }

    const distribue = /^(?:Dealt to|Cartes? (?:distribu[ée]es?|re[çc]ues?)(?: [àa])?|Distribu[ée]e?s? [àa])\s+(.+?)\s*\[([^\]]+)\]/i.exec(ligne);
    if (distribue) {
      try {
        const cartes = lireCartes(distribue[2]);
        if (cartes.length === 2) {
          main.hero = distribue[1].replace(/:$/, '').trim();
          main.cartesHero = cartes;
        }
      } catch (e) {
        return { erreur: `cartes du héros illisibles (${e.message})`, id: main.id };
      }
      continue;
    }

    const rendu = /^(?:Uncalled bet|Mise non suivie)\s*\(([^)]+)\)\s*(?:returned to|rendue? [àa]|retourn[ée]e? [àa])\s+(.+)$/i.exec(ligne);
    if (rendu) {
      const nom = trouverJoueur(main.joueurs, rendu[2].trim());
      if (nom) main.rendus[nom] = (main.rendus[nom] ?? 0) + lireMontant(rendu[1]);
      continue;
    }

    const pot = /Total pot\s+([^\s|]+).*?Rake\s+([^\s|]+)/i.exec(ligne) ?? /Pot total\s*:?\s+([^\s|]+).*?Rake\s*:?\s+([^\s|]+)/i.exec(ligne);
    if (pot) {
      main.rake = lireMontant(pot[2]);
      continue;
    }

    if (rue === 'resume') continue;

    const nom = joueurEnDebutDeLigne(main.joueurs, ligne);
    if (!nom) continue;
    // Les symboles monétaires collés ou détachés (« €0.20 », « 0,20 € ») sont retirés.
    const reste = ligne
      .slice(nom.length)
      .replace(/^\s*:?\s*/, '')
      .replace(/[€$£]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tapis = /all-in|all in|tapis/i.test(reste);
    for (const { type, re } of VERBES) {
      const m = re.exec(reste);
      if (!m) continue;
      if (type === 'couche' || type === 'parole') main.actions.push({ rue, joueur: nom, type });
      else if (type === 'suit' || type === 'mise') main.actions.push({ rue, joueur: nom, type, montant: lireMontant(m[2]), tapis });
      else if (type === 'relance') main.actions.push({ rue, joueur: nom, type: 'relance', total: lireMontant(m[3]), tapis });
      else if (type === 'relanceA') main.actions.push({ rue, joueur: nom, type: 'relance', total: lireMontant(m[1]), tapis });
      else if (type === 'poste') {
        const genre = /ante/i.test(m[1]) ? 'ante' : 'blinde';
        const montant = lireMontant(m[2]);
        main.actions.push({ rue: 'preflop', joueur: nom, type: 'poste', genre, montant, tapis });
        if (/big|grosse/i.test(m[1]) && !/small|petite/i.test(m[1]) && !Number.isFinite(main.grosseBlinde)) main.grosseBlinde = montant;
        if (/small|petite/i.test(m[1]) && !/big/i.test(m[1]) && !Number.isFinite(main.petiteBlinde)) main.petiteBlinde = montant;
      } else if (type === 'montre') {
        try {
          const cartes = lireCartes(m[1]);
          if (cartes.length === 2) main.montrees[nom] = cartes;
        } catch (e) {
          return { erreur: `cartes montrées illisibles (${e.message})`, id: main.id };
        }
      } else if (type === 'gagne') {
        const g = lireMontant(m[1]);
        if (Number.isFinite(g)) main.gains[nom] = arrondir((main.gains[nom] ?? 0) + g);
      }
      break;
    }
  }

  if (Object.keys(main.gains).length === 0) Object.assign(main.gains, gainsResume);
  if (main.joueurs.length < 2) return { erreur: 'pas de liste de joueurs lisible (lignes « Seat 1: Nom (tapis) »)', id: main.id };
  if (main.actions.length === 0) return { erreur: 'aucune action lisible', id: main.id };
  const inconnues = main.actions.filter((a) => (a.type === 'suit' || a.type === 'mise' || a.type === 'poste') && !Number.isFinite(a.montant));
  if (inconnues.length > 0 || main.actions.some((a) => a.type === 'relance' && !Number.isFinite(a.total))) {
    return { erreur: 'montant illisible dans une action', id: main.id };
  }
  return { main: rejouer(main) };
}

function trouverJoueur(joueurs, texte) {
  const exact = joueurs.find((j) => j.nom === texte);
  if (exact) return exact.nom;
  return joueurEnDebutDeLigne(joueurs, texte);
}

/** Le nom de joueur le plus long par lequel la ligne commence (les noms peuvent contenir des espaces). */
function joueurEnDebutDeLigne(joueurs, ligne) {
  let meilleur = null;
  for (const { nom } of joueurs) {
    if (ligne.startsWith(nom) && /^(\s|:|$)/.test(ligne.slice(nom.length)) && (!meilleur || nom.length > meilleur.length)) {
      meilleur = nom;
    }
  }
  return meilleur;
}

/**
 * Rejoue la main action par action pour savoir, à chaque instant, ce qu'il y a
 * au pot et ce que chacun doit payer. On en tire les décisions du héros, ce que
 * chacun a investi, et l'éventuel tapis.
 */
function rejouer(main) {
  const tapisDepart = new Map(main.joueurs.map((j) => [j.nom, j.tapis]));
  // Ceux qui jouent la main : les joueurs assis mais absents n'ont aucune action.
  const participants = new Set(main.actions.map((a) => a.joueur));
  const investi = new Map(main.joueurs.map((j) => [j.nom, 0]));
  const couche = new Set();
  let parRue = new Map();
  let rueCourante = 'preflop';
  const tableauParRue = { preflop: [], flop: main.tableau.slice(0, 3), turn: main.tableau.slice(0, 4), river: main.tableau.slice(0, 5) };
  const decisions = [];
  let derniereRueAvecMise = 'preflop';
  let tapisEngage = false;

  for (const a of main.actions) {
    if (a.rue !== rueCourante) {
      rueCourante = a.rue;
      parRue = new Map();
    }
    const deja = parRue.get(a.joueur) ?? 0;
    const niveau = Math.max(0, ...parRue.values());
    const restant = (tapisDepart.get(a.joueur) ?? Infinity) - (investi.get(a.joueur) ?? 0);

    if (a.joueur === main.hero && a.type !== 'poste' && a.type !== 'montre') {
      const aSuivre = arrondir(Math.min(niveau - deja, restant));
      if (aSuivre > 1e-9 && (a.type === 'couche' || a.type === 'suit')) {
        const actifs = [...participants].filter((nom) => nom !== main.hero && !couche.has(nom));
        // Le call clôt-il toute mise future ? (le héros ou tous ses adversaires à tapis)
        const finDesMises =
          aSuivre >= restant - 1e-9 ||
          (actifs.length > 0 && actifs.every((nom) => (tapisDepart.get(nom) ?? 0) - (investi.get(nom) ?? 0) <= 1e-9));
        decisions.push({
          rue: a.rue,
          action: a.type,
          tableau: tableauParRue[a.rue] ?? [],
          pot: sommer(investi),
          aSuivre,
          nbAdversaires: actifs.length,
          finDesMises,
        });
      }
    }

    let ajout = 0;
    if (a.type === 'poste') {
      ajout = a.montant;
      if (a.genre !== 'ante') parRue.set(a.joueur, arrondir(deja + a.montant));
    } else if (a.type === 'suit' || a.type === 'mise') {
      ajout = a.montant;
      parRue.set(a.joueur, arrondir(deja + a.montant));
    } else if (a.type === 'relance') {
      ajout = arrondir(a.total - deja);
      parRue.set(a.joueur, a.total);
    } else if (a.type === 'couche') couche.add(a.joueur);

    if (ajout > 0) {
      investi.set(a.joueur, arrondir((investi.get(a.joueur) ?? 0) + ajout));
      if (a.type !== 'poste') derniereRueAvecMise = a.rue;
      const reste = (tapisDepart.get(a.joueur) ?? Infinity) - investi.get(a.joueur);
      if (a.tapis || reste <= 1e-9) tapisEngage = true;
    }
  }

  // La mise que personne n'a suivie revient à son auteur. Certains formats
  // l'écrivent (« Uncalled bet … returned to … »), d'autres non : on la déduit.
  if (Object.keys(main.rendus).length === 0 && parRue.size > 0) {
    const tri = [...parRue.entries()].sort((x, y) => y[1] - x[1]);
    const [premier, montantPremier] = tri[0];
    const second = tri[1]?.[1] ?? 0;
    if (montantPremier - second > 1e-9) main.rendus[premier] = arrondir(montantPremier - second);
  }
  for (const [nom, montant] of Object.entries(main.rendus)) investi.set(nom, arrondir((investi.get(nom) ?? 0) - montant));

  const restants = [...participants].filter((nom) => !couche.has(nom));
  const positions = calculerPositions(main.joueurs.map((j) => j.siege), main.siegeBouton);
  const siegeHero = main.joueurs.find((j) => j.nom === main.hero)?.siege;

  return {
    ...main,
    investi: Object.fromEntries(investi),
    restants,
    decisions,
    derniereRueAvecMise,
    tapisEngage,
    positionHero: siegeHero !== undefined && Number.isFinite(main.siegeBouton) ? positions.get(siegeHero) ?? null : null,
  };
}

function sommer(map) {
  let s = 0;
  for (const v of map.values()) s += v;
  return arrondir(s);
}

/** Les montants sont au centime (ou au jeton) : on efface le bruit des flottants. */
const arrondir = (x) => Math.round(x * 100) / 100;

/** Texte complet → { mains, ignorees: [{ id, erreur }] } */
export function lireHistorique(texte) {
  const mains = [];
  const ignorees = [];
  for (const bloc of decouperMains(texte)) {
    const r = lireMain(bloc);
    if (r.main) mains.push(r.main);
    else ignorees.push({ id: r.id ?? null, erreur: r.erreur, debut: bloc.split('\n')[0].slice(0, 120) });
  }
  return { mains, ignorees };
}
