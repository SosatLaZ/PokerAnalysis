// Les cartes.
//
// Une carte est un entier de 0 à 51 : rang × 4 + couleur.
//   rang    : 0 = 2, 1 = 3, …, 8 = T (10), 9 = J (valet), 10 = Q (dame), 11 = K (roi), 12 = A (as)
//   couleur : 0 = ♣ (c), 1 = ♦ (d), 2 = ♥ (h), 3 = ♠ (s)
//
// On écrit les cartes à l'anglaise, comme tous les logiciels de poker :
// « Ah » = as de cœur, « Td » ou « 10d » = dix de carreau. Les symboles
// ♣ ♦ ♥ ♠ sont acceptés aussi : « A♥ K♦ ».

export const RANGS = '23456789TJQKA';
export const COULEURS = 'cdhs';
export const SYMBOLES = ['♣', '♦', '♥', '♠'];
export const NOMS_RANGS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Valet', 'Dame', 'Roi', 'As'];

const SYMBOLE_VERS_COULEUR = { '♣': 0, '♦': 1, '♥': 2, '♠': 3, c: 0, d: 1, h: 2, s: 3 };

export const carte = (rang, couleur) => rang * 4 + couleur;
export const rangDe = (c) => c >> 2;
export const couleurDe = (c) => c & 3;

export function rangDepuisLettre(lettre) {
  const r = RANGS.indexOf(String(lettre).toUpperCase());
  if (r < 0) throw new Error(`Rang inconnu : « ${lettre} »`);
  return r;
}

/** « Ah » → 50. Lève une erreur lisible si le texte n'est pas une carte. */
export function lireCarte(texte) {
  const cartes = lireCartes(texte);
  if (cartes.length !== 1) throw new Error(`Une seule carte attendue : « ${texte} »`);
  return cartes[0];
}

/**
 * « AhKd », « Ah Kd », « Ah,Kd », « A♥ K♦ », « 10h 9h » → tableau d'entiers.
 * Refuse les doublons : une carte n'existe qu'une fois dans le paquet.
 */
export function lireCartes(texte) {
  if (Array.isArray(texte)) return texte.map((c) => (typeof c === 'number' ? c : lireCarte(c)));
  const brut = String(texte ?? '').replace(/[\s,;\[\]]+/g, '');
  if (brut === '') return [];
  const motif = /(10|[2-9TJQKA])([cdhs♣♦♥♠])/giy;
  const cartes = [];
  let fin = 0;
  let m;
  while ((m = motif.exec(brut)) !== null) {
    const rang = m[1] === '10' ? 8 : rangDepuisLettre(m[1]);
    const couleur = SYMBOLE_VERS_COULEUR[m[2].toLowerCase()] ?? SYMBOLE_VERS_COULEUR[m[2]];
    cartes.push(carte(rang, couleur));
    fin = motif.lastIndex;
  }
  if (fin !== brut.length) {
    throw new Error(`Cartes illisibles : « ${texte} » (exemple attendu : « Ah Kd », « Td 9s 2c »)`);
  }
  verifierSansDoublon(cartes);
  return cartes;
}

export function verifierSansDoublon(cartes) {
  const vues = new Set();
  for (const c of cartes) {
    if (!Number.isInteger(c) || c < 0 || c > 51) throw new Error(`Carte invalide : ${c}`);
    if (vues.has(c)) throw new Error(`La carte ${nomCarte(c)} apparaît deux fois`);
    vues.add(c);
  }
}

/** 50 → « Ah » */
export const nomCarte = (c) => RANGS[rangDe(c)] + COULEURS[couleurDe(c)];

/** 50 → « A♥ » */
export const afficherCarte = (c) => (RANGS[rangDe(c)] === 'T' ? '10' : RANGS[rangDe(c)]) + SYMBOLES[couleurDe(c)];

export const nomCartes = (cartes) => cartes.map(nomCarte).join(' ');
export const afficherCartes = (cartes) => cartes.map(afficherCarte).join(' ');

/** Les 52 cartes, moins celles qu'on exclut. */
export function paquet(exclues = []) {
  const pris = new Set(exclues);
  const cartes = [];
  for (let c = 0; c < 52; c++) if (!pris.has(c)) cartes.push(c);
  return cartes;
}

/** AhKd → « AKo », 7c7d → « 77 », 9s8s → « 98s » : la classe parmi les 169 mains de départ. */
export function classeDeMain(c1, c2) {
  let r1 = rangDe(c1);
  let r2 = rangDe(c2);
  if (r1 < r2) [r1, r2] = [r2, r1];
  if (r1 === r2) return RANGS[r1] + RANGS[r2];
  return RANGS[r1] + RANGS[r2] + (couleurDe(c1) === couleurDe(c2) ? 's' : 'o');
}
