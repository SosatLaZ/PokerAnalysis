# Poker Analysis — la table de décision

Savoir si un coup se joue, au Texas Hold'em No Limit : ton **équité** contre la
range adverse, la **cote du pot**, et le **verdict** (suivre, se coucher, tapis).
Puis, après la session, **détecter** où part l'argent dans ton historique de mains.

JavaScript natif, zéro dépendance, Node 18 ou plus récent.

## Ce que ça fait

| Outil | Question | Comment |
|---|---|---|
| **Entraînement** | « Est-ce que je joue bien, et est-ce que je fais n'importe quoi ? » | Une table Spin & Rush (3 joueurs, 500 jetons, blindes qui montent), tête-à-tête ou cash 6-max contre des bots à 4 profils. Chaque décision est chronométrée et jugée par les 4 profils : bon, choix de style, erreur, n'importe quoi. Bilan : score de discipline, temps de décision, style le plus proche, tilt. |
| **Suivre ou pas** | « Je paie 6 dans un pot de 12 avec A♥K♥ sur Q♥7♥2♣, c'est rentable ? » | Équité exacte (ou Monte-Carlo) contre une range, comparée à la cote du pot ; EV du call, rake et gains implicites compris. |
| **Tapis ou pas** | « 10 bb en petite blinde avec A7o, je pousse ? » | Probabilité que tout le monde se couche, équité quand on est suivi, espérance du tapis. Fait pour les tournois et les Twister. |
| **Suivi** | « Combien je gagne vraiment, où, et contre qui ? » | Comme PokerTracker : base de mains sans doublon, courbe de gains et d'all-in EV, résultats par jour, limite et position, filtres (cartes, position, tapis, abattage, adversaire…), rejeu coup par coup, stats de chaque adversaire. |
| **Analyse de session** | « Je perds parce que je joue mal ou parce que je n'ai pas de chance ? » | VPIP, PFR, agression, abattages, résultats par position ; fuites détectées ; chance sur les tapis (attendu contre réel) ; calls et abandons contraires à la cote. |

## Démarrer

```bash
npm test                 # 78 tests
npm run web              # la page sur http://localhost:8080 (ta base de mains est gardée dans data/)
node bin/poker.js aide   # la ligne de commande
```

### La page

`npm run web`, puis http://localhost:8080. Trois onglets : *Suivre ou pas*,
*Tapis ou pas*, *Analyse de session*. Tout se recalcule dès qu'une carte ou un
montant change. Les modules ES ne se chargent pas en ouvrant `index.html`
directement depuis le disque : passe par le serveur.

### La ligne de commande

```bash
# Équité : un joueur est une main (« Ah Kh ») ou une range (« QQ+,AK », « 20% », « aléatoire »)
node bin/poker.js equite "Ah Kh" "QQ+,AK" --tableau "Qh 7h 2c"

# Suivre ou se coucher (le pot compte la mise adverse)
node bin/poker.js decision "Ah Kh" --contre "25%" --tableau "Qh 7h 2c" --pot 12 --a-suivre 6
node bin/poker.js decision "9h 8h" --contre "30%" --adversaires 2 --tableau "Ah 7h 2c" --pot 8 --a-suivre 4 --rake 0.05 --plafond-rake 3

# Tapis ou se coucher (petite blinde, 10 bb, contre une grosse blinde qui suit 25 % des mains)
node bin/poker.js tapis "A7o" --pot 1.5 --poste 0.5 --poste-adverse 1 --tapis 9.5 --tapis-adverse 19 --appel "25%"

# Détection sur un historique de mains
node bin/poker.js analyser exemples/session-exemple.txt
node bin/poker.js analyser mes-mains.txt --hero MonPseudo --range-adverse "25%" --json
```

## Le bot, quatre profils

| Profil | Risque | Caractère |
|---|---|---|
| Prudent | 1/4 | Ne met son tapis qu'avec le meilleur jeu ; exige 5 points d'équité au-dessus de la cote. |
| Solide | 2/4 | Régulier serré et agressif : peu de mains, jouées fort. |
| Agressif | 3/4 | Ouvre large, relance beaucoup, semi-bluffe ses tirages. |
| Sans peur | 4/4 | Croit à la fold equity, n'a jamais peur d'engager son tapis quand la cote est bonne, gros bluffs. |

Chaque bot ne voit que ce qu'un joueur voit : il estime la range de chaque
adversaire d'après ses actions, calcule son équité et décide selon ses seuils
(`src/strategie/`). Il explique chaque décision. Il ne joue que dans cet
outil : il ne se branche sur aucun logiciel de poker.

## La notation des ranges

| Écriture | Contenu |
|---|---|
| `AA`, `AKs`, `AKo`, `AK` | une classe (`AK` = assorties et dépareillées) |
| `77+` | 77, 88, …, AA |
| `A2s+`, `KTo+` | A2s à AKs ; KTo, KJo, KQo |
| `QQ-88`, `A5s-A2s` | un intervalle |
| `AhKh` | une combinaison précise |
| `15%` | les 15 % meilleures mains (classement contre une main au hasard) |
| `aléatoire` ou `*` | les 1 326 combinaisons |

Les morceaux se séparent par des virgules : `22+, A2s+, KTo+`.

## Comment c'est calculé

- **Évaluateur** (`src/evaluateur.js`) : 5 à 7 cartes, par masques de bits,
  environ 10 millions de mains par seconde. Vérifié sur les 2 598 960 mains de
  5 cartes (test) et les 133 784 560 mains de 7 cartes : les fréquences de
  chaque catégorie sont exactement les fréquences théoriques.
- **Équité** (`src/equite.js`) : énumération exacte de toutes les
  distributions quand il y en a moins de 2 millions (AA contre KK avant le
  flop : 1 712 304 tableaux, 0,4 s), sinon Monte-Carlo avec l'erreur type.
  AsAh contre KdKc donne 81,06 % de victoires et 0,38 % de partages, la valeur
  publiée par PokerStove.
- **Classement des 169 mains** (`src/classement.js`) : équité contre une main
  au hasard, 400 000 tirages par main. Se régénère avec `npm run classement`.
- **Décision** (`src/decision.js`) : équité requise = mise à suivre ÷ (pot +
  mise à suivre − rake + gains implicites). Le calcul s'arrête à la mise en
  cours : il ne voit pas les mises des rues suivantes, et le verdict le dit.
- **Tapis** : EV = P(tous se couchent) × pot + P(suivi) × (équité × pot final
  − ce que tu risques). Hypothèses affichées : chaque adversaire décide seul,
  un seul suit au plus.

## La détection

`src/analyse/historique.js` lit le format texte « à la PokerStars », que suivent
Winamax et la plupart des convertisseurs, ainsi que ses équivalents en
français (« se couche », « suit », « relance … à … »). Une main illisible
n'est jamais avalée : elle est listée avec sa raison.

`src/detection.js` en tire :

1. **Les statistiques et les fuites**, contre les repères d'un joueur gagnant
   en 6-max (VPIP 15–32 %, PFR au moins 60 % du VPIP, agression 1,5–5,
   abattage sous 33 %, gagné à l'abattage au-dessus de 45 %). Sous 300 mains,
   le rapport prévient que les chiffres bougent encore.
2. **La chance sur les tapis** : pour chaque tapis montré avant la rivière,
   l'équité au moment où l'argent est entré donne ce que tu *devais* gagner ;
   l'écart avec ce que tu as gagné, c'est la chance.
3. **Les décisions contraires à la cote** : quand tu as payé sans l'équité
   requise, ou jeté une main qui l'avait, de plus de 10 points, contre une
   range supposée (30 % par défaut, réglable). Seuls sont jugés les coups après
   le flop et les appels qui closent les mises, là où ce calcul a un sens.

### Betclic

Le format d'export des mains de Betclic n'a pas pu être vérifié : aucune
spécification publique, et aucun fichier réel dans ce dépôt. Si ton export
n'est pas lu (la page et la commande listent les mains ignorées et pourquoi),
ajoute quelques mains anonymisées dans `exemples/` : l'adaptation tient dans
`src/analyse/historique.js`.

## Ce que l'outil ne fait pas

Il ne lit pas l'écran ni le logiciel de Betclic, et ne joue pas à ta place.
Les salles régulées interdisent en général les logiciels d'aide pendant le
jeu, sous peine de fermeture du compte : vérifie le règlement de Betclic.
C'est un outil d'étude, pour préparer ses décisions et relire ses sessions.

## Organisation

```
src/moteur/     cartes, évaluateur, ranges, équité
src/strategie/  décision (cote, tapis), lecture du coup, profils, bot
src/jeu/        la table d'entraînement et les bots qui y jouent
src/analyse/    historiques, détection, rythme et tilt, adversaires, entraînement
bin/poker.js  la ligne de commande
index.html    la page ; web/ (app.js, entrainement.js, ui.js) la branche sur le moteur
scripts/      serveur local, génération du classement
exemples/     une session fictive pour essayer l'analyse
test/         node --test
```
