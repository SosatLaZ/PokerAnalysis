// Les quatre profils du bot, du plus sûr au plus risqué.
//
// Un profil n'est pas une humeur : c'est un jeu de seuils. Les pourcentages de
// mains suivent le classement des 169 mains (src/moteur/classement.js) ; les
// fréquences de bluff sont des probabilités, tirées au hasard à chaque coup.

export const PROFILS = [
  {
    id: 'prudent',
    nom: 'Prudent',
    risque: 1,
    devise: 'Ne met son tapis qu’avec le meilleur jeu. Peu de variance, peu de bluffs.',
    // % des mains ouvertes en relance, selon la position (personne n'a relancé avant).
    ouverture: { UTG: 11, MP: 13, HJ: 16, CO: 21, BTN: 32, SB: 26 },
    tailleOuverture: 2.5, // en grosses blindes
    troisMise: 3.5, // % des mains relancées pour la valeur face à une relance
    troisMiseBluff: 0, // % de mains en plus, relancées en bluff
    defense: 12, // % des mains qui paient une relance
    quatreMise: 2.2, // % des mains qui relancent une sur-relance (ou partent à tapis)
    margeAppel: 0.05, // équité exigée en plus de la cote du pot
    seuilValeur: 0.64, // équité pour miser pour la valeur
    frequenceCbet: 0.4,
    frequenceBluff: 0.03,
    frequenceSemiBluff: 0.25,
    tailleMise: 0.5, // fraction du pot
    multiplicateurRelance: 2.8,
    seuilEngagement: 0.62, // équité exigée pour engager plus du tiers de son tapis
    creditTirage: 0.01, // gains implicites crédités à un gros tirage
    tapisCourt: { maxBb: 12, margeBb: 0.4 }, // mode tapis-ou-rien et EV minimale du tapis
    pessimisme: 1.25, // les adversaires suivent un tapis plus large qu'on ne le croit
  },
  {
    id: 'solide',
    nom: 'Solide',
    risque: 2,
    devise: 'Le régulier serré et agressif : joue peu de mains, mais les joue fort.',
    ouverture: { UTG: 15, MP: 18, HJ: 21, CO: 27, BTN: 45, SB: 38 },
    tailleOuverture: 2.3,
    troisMise: 5,
    troisMiseBluff: 2.5,
    defense: 18,
    quatreMise: 3,
    margeAppel: 0.02,
    seuilValeur: 0.57,
    frequenceCbet: 0.6,
    frequenceBluff: 0.12,
    frequenceSemiBluff: 0.55,
    tailleMise: 0.66,
    multiplicateurRelance: 3,
    seuilEngagement: 0.5,
    creditTirage: 0.03,
    tapisCourt: { maxBb: 15, margeBb: 0.1 },
    pessimisme: 1,
  },
  {
    id: 'agressif',
    nom: 'Agressif',
    risque: 3,
    devise: 'Met la pression : ouvre large, relance beaucoup, semi-bluffe ses tirages.',
    ouverture: { UTG: 19, MP: 23, HJ: 28, CO: 36, BTN: 60, SB: 48 },
    tailleOuverture: 2.2,
    troisMise: 7,
    troisMiseBluff: 5,
    defense: 24,
    quatreMise: 4.5,
    margeAppel: 0,
    seuilValeur: 0.53,
    frequenceCbet: 0.75,
    frequenceBluff: 0.25,
    frequenceSemiBluff: 0.8,
    tailleMise: 0.75,
    multiplicateurRelance: 3,
    seuilEngagement: 0.42,
    creditTirage: 0.05,
    tapisCourt: { maxBb: 18, margeBb: 0 },
    pessimisme: 0.9,
  },
  {
    id: 'sans-peur',
    nom: 'Sans peur',
    risque: 4,
    devise: 'N’a pas peur de la variance : croit à la fold equity, part à tapis dès que c’est rentable, gros bluffs, suit un peu sous la cote quand il reste des jetons à gagner.',
    ouverture: { UTG: 26, MP: 30, HJ: 36, CO: 46, BTN: 78, SB: 66 },
    tailleOuverture: 2.5,
    troisMise: 10,
    troisMiseBluff: 10,
    defense: 30,
    quatreMise: 7,
    margeAppel: -0.03,
    seuilValeur: 0.5,
    frequenceCbet: 0.9,
    frequenceBluff: 0.4,
    frequenceSemiBluff: 1,
    tailleMise: 1,
    multiplicateurRelance: 3.5,
    seuilEngagement: 0, // n'a jamais peur d'engager son tapis quand la cote est bonne
    creditTirage: 0.07,
    tapisCourt: { maxBb: 22, margeBb: 0 },
    pessimisme: 0.8,
  },
];

export const ID_PROFILS = PROFILS.map((p) => p.id);

export function profil(id) {
  const p = PROFILS.find((x) => x.id === id);
  if (!p) throw new Error(`Profil inconnu : « ${id} » (profils : ${ID_PROFILS.join(', ')})`);
  return p;
}
