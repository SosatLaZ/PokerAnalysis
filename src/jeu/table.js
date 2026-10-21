// La table : une partie de No Limit Hold'em complète, pour s'entraîner contre
// les bots. Règles appliquées :
//   - blindes (et passage de niveau en tournoi), bouton qui tourne ; en
//     tête-à-tête le bouton paie la petite blinde et parle en premier avant le flop ;
//   - relance minimum = taille de la dernière relance complète ; un tapis trop
//     court pour être une relance complète ne rouvre pas les relances à ceux
//     qui ont déjà parlé ;
//   - mise non suivie rendue, pots annexes, jetons impairs au premier gagnant
//     après le bouton ;
//   - un historique texte de chaque main, lisible par l'analyse de session.
// Les jetons sont des entiers.

import { creerAleatoire } from '../moteur/aleatoire.js';
import { evaluer, decrireScore } from '../moteur/evaluateur.js';
import { nomCartes } from '../moteur/cartes.js';
import { calculerPositions } from '../analyse/historique.js';

export const FORMATS = {
  'spin-rush': {
    id: 'spin-rush',
    nom: 'Spin & Rush',
    nbJoueurs: 3,
    tapis: 500,
    niveaux: [[10, 20], [15, 30], [20, 40], [25, 50], [30, 60], [40, 80], [50, 100], [60, 120], [80, 160], [100, 200], [150, 300], [200, 400]],
    mainsParNiveau: 6,
    tournoi: true,
    libelle: '3 joueurs, 500 jetons, blindes qui montent toutes les 6 mains',
  },
  'tete-a-tete': {
    id: 'tete-a-tete',
    nom: 'Tête-à-tête',
    nbJoueurs: 2,
    tapis: 500,
    niveaux: [[10, 20], [15, 30], [20, 40], [30, 60], [40, 80], [50, 100], [75, 150], [100, 200]],
    mainsParNiveau: 6,
    tournoi: true,
    libelle: 'La fin d’un Spin : 2 joueurs, 500 jetons',
  },
  'cash-6max': {
    id: 'cash-6max',
    nom: 'Cash 6-max',
    nbJoueurs: 6,
    tapis: 200,
    niveaux: [[1, 2]],
    mainsParNiveau: Infinity,
    tournoi: false,
    libelle: '6 joueurs, 100 grosses blindes, recave automatique',
  },
};

const ROMAINS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

/**
 * @param {object} options
 * @param {string} [options.format]      'spin-rush' | 'tete-a-tete' | 'cash-6max'
 * @param {Array}  options.joueurs       [{ nom, type: 'humain' | 'bot', profil? }] dans l'ordre des sièges
 * @param {number} [options.graine]      pour rejouer exactement les mêmes cartes
 * @param {Function} [options.horloge]   () => millisecondes (Date.now par défaut)
 */
export function creerPartie({ format = 'spin-rush', joueurs, graine, horloge = Date.now, mainsParNiveau } = {}) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Format inconnu : « ${format} » (${Object.keys(FORMATS).join(', ')})`);
  if (!Array.isArray(joueurs) || joueurs.length < 2 || joueurs.length > 9) throw new Error('De 2 à 9 joueurs.');
  if (new Set(joueurs.map((j) => j.nom)).size !== joueurs.length) throw new Error('Deux joueurs portent le même nom.');

  const aleatoire = creerAleatoire(graine);
  const idTournoi = String(Math.floor(aleatoire() * 9e8) + 1e8);
  const parNiveau = mainsParNiveau ?? f.mainsParNiveau;
  const sieges = joueurs.map((j, i) => ({
    siege: i + 1,
    nom: j.nom,
    type: j.type ?? 'bot',
    profil: j.profil ?? null,
    tapis: f.tapis,
    tapisDepart: f.tapis,
    cartes: [],
    couche: false,
    mise: 0, // sur la rue en cours
    investi: 0, // sur la main
    aAgi: false, // a parlé depuis la dernière relance complète
    elimine: false,
  }));

  let numeroMain = 0;
  let bouton = -1;
  let main = null;
  const historiques = [];
  const resultats = [];

  const enJeu = (s) => !s.elimine;
  const dansLeCoup = (s) => !s.elimine && !s.couche;
  const peutAgir = (s) => dansLeCoup(s) && s.tapis > 0;
  const partieFinie = () => f.tournoi && sieges.filter(enJeu).length <= 1;
  const niveauDeLaMain = (n) => Math.min(Math.floor((n - 1) / parNiveau), f.niveaux.length - 1);

  function suivant(index, condition = enJeu) {
    for (let k = 1; k <= sieges.length; k++) {
      const j = (index + k) % sieges.length;
      if (condition(sieges[j])) return j;
    }
    return -1;
  }
  const suivantQuiDoitParler = (depuis) => suivant(depuis, (s) => peutAgir(s) && (!s.aAgi || s.mise < main.miseActuelle));

  function nouvelleMain() {
    if (main && !main.terminee) throw new Error('La main en cours n’est pas finie.');
    if (partieFinie()) throw new Error('La partie est finie.');
    if (!f.tournoi) for (const s of sieges) if (s.tapis === 0) s.tapis = f.tapis; // recave
    numeroMain++;
    const niveau = niveauDeLaMain(numeroMain);
    const [pb, gb] = f.niveaux[niveau];
    bouton = suivant(bouton < 0 ? sieges.length - 1 : bouton);
    for (const s of sieges) Object.assign(s, { cartes: [], couche: s.elimine, mise: 0, investi: 0, aAgi: false, tapisDepart: s.tapis });

    const presents = sieges.filter(enJeu);
    const iPB = presents.length === 2 ? bouton : suivant(bouton);
    const iGB = suivant(iPB);
    const paquet = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) {
      const j = Math.floor(aleatoire() * (i + 1));
      [paquet[i], paquet[j]] = [paquet[j], paquet[i]];
    }
    const positions = calculerPositions(presents.map((s) => s.siege), sieges[bouton].siege);
    main = {
      numero: numeroMain,
      id: `${idTournoi}${String(numeroMain).padStart(4, '0')}`,
      debut: horloge(),
      niveau,
      petiteBlinde: pb,
      grosseBlinde: gb,
      bouton,
      iGB,
      positions,
      paquet,
      tableau: [],
      rue: 'preflop',
      miseActuelle: 0,
      derniereRelance: gb,
      journal: [],
      terminee: false,
      abattage: false,
      gains: new Map(),
      rendus: new Map(),
      aQui: -1,
    };

    // Deux cartes chacun, en commençant après le bouton.
    for (let tour = 0; tour < 2; tour++) {
      let i = bouton;
      for (let k = 0; k < presents.length; k++) {
        i = suivant(i);
        sieges[i].cartes.push(paquet.pop());
      }
    }
    poster(iPB, pb, 'small blind');
    poster(iGB, gb, 'big blind');
    main.miseActuelle = gb;
    passerLaParole(iGB);
    return etat();
  }

  function poster(i, montant, genre) {
    const s = sieges[i];
    const m = Math.min(montant, s.tapis);
    deplacer(s, m);
    main.journal.push({ rue: 'preflop', siege: i, nom: s.nom, type: 'poste', genre, montant: m, tapis: s.tapis === 0 });
  }

  function deplacer(s, montant) {
    s.tapis -= montant;
    s.mise += montant;
    s.investi += montant;
  }

  /** Après une action : la main s'arrête, le tour s'arrête, ou quelqu'un d'autre parle. */
  function passerLaParole(depuis) {
    if (sieges.filter(dansLeCoup).length === 1) return terminer();
    const prochain = suivantQuiDoitParler(depuis);
    const peuvent = sieges.filter(peutAgir);
    const seulEtAJour = peuvent.length === 1 && prochain >= 0 && sieges[prochain].mise >= main.miseActuelle;
    if (prochain < 0 || seulEtAJour) return finDuTour();
    main.aQui = prochain;
  }

  function distribuerRue() {
    const n = main.tableau.length === 0 ? 3 : 1;
    for (let k = 0; k < n; k++) main.tableau.push(main.paquet.pop());
    main.rue = main.tableau.length === 3 ? 'flop' : main.tableau.length === 4 ? 'turn' : 'river';
    main.journal.push({ rue: main.rue, type: 'tableau', cartes: [...main.tableau] });
  }

  function finDuTour() {
    for (const s of sieges) {
      s.mise = 0;
      s.aAgi = false;
    }
    main.miseActuelle = 0;
    main.derniereRelance = main.grosseBlinde;
    main.aQui = -1;
    if (main.rue === 'river') return terminer();
    if (sieges.filter(peutAgir).length <= 1) {
      // Plus personne ne peut miser : on retourne toutes les cartes.
      while (main.tableau.length < 5) distribuerRue();
      return terminer();
    }
    distribuerRue();
    passerLaParole(main.bouton);
  }

  /** Ce que le joueur d'index i a le droit de faire (null si ce n'est pas à lui). */
  function actionsPossibles(i) {
    if (!main || main.terminee || main.aQui !== i) return null;
    const s = sieges[i];
    const aSuivre = Math.max(0, main.miseActuelle - s.mise);
    const max = s.mise + s.tapis;
    const a = {
      aSuivre: Math.min(aSuivre, s.tapis),
      couche: aSuivre > 0,
      parole: aSuivre === 0,
      suit: aSuivre > 0,
      mise: null, // { min, max } en total de la rue
      relance: null,
      tapis: max,
      miseActuelle: main.miseActuelle,
    };
    if (main.miseActuelle === 0) a.mise = { min: Math.min(main.grosseBlinde, max), max };
    else if (!s.aAgi && s.tapis > aSuivre) a.relance = { min: Math.min(main.miseActuelle + main.derniereRelance, max), max };
    return a;
  }

  /**
   * L'action du joueur dont c'est le tour.
   * { type: 'couche' | 'parole' | 'suit' | 'mise' | 'relance' | 'tapis', montant? (total de la rue) }
   * Se coucher alors que checker est gratuit est permis (c'est une faute, pas une triche) : le journal le note.
   */
  function jouer(i, action) {
    const a = actionsPossibles(i);
    if (!a) throw new Error(main?.terminee ? 'La main est finie.' : `Ce n’est pas à ${sieges[i]?.nom ?? '?'} de parler.`);
    const s = sieges[i];
    let type = action.type;
    let total = action.montant;
    if (type === 'tapis') {
      total = s.mise + s.tapis;
      if (total <= main.miseActuelle || (!a.mise && !a.relance)) type = 'suit';
      else type = a.mise ? 'mise' : 'relance';
    }
    const base = { rue: main.rue, siege: i, nom: s.nom };
    switch (type) {
      case 'couche':
        s.couche = true;
        main.journal.push({ ...base, type: 'couche', montant: 0, gratuit: !a.couche });
        break;
      case 'parole':
        if (!a.parole) throw new Error(`${s.nom} ne peut pas checker : il y a ${a.aSuivre} à suivre.`);
        main.journal.push({ ...base, type: 'parole', montant: 0 });
        break;
      case 'suit': {
        if (!a.suit) throw new Error(`${s.nom} n’a rien à suivre : il peut checker.`);
        deplacer(s, a.aSuivre);
        main.journal.push({ ...base, type: 'suit', montant: a.aSuivre, tapis: s.tapis === 0 });
        break;
      }
      case 'mise':
      case 'relance': {
        const bornes = type === 'mise' ? a.mise : a.relance;
        if (!bornes) throw new Error(type === 'mise' ? 'Il y a déjà une mise : il faut relancer.' : 'Relancer n’est pas possible ici.');
        if (!Number.isFinite(total)) throw new Error('Il faut un montant.');
        total = Math.round(total);
        const toutDehors = total === s.mise + s.tapis;
        if (total > bornes.max) throw new Error(`${s.nom} n’a que ${bornes.max} au total.`);
        if (total < bornes.min && !toutDehors) throw new Error(`Le minimum est ${bornes.min}.`);
        const avant = main.miseActuelle;
        const ajout = total - s.mise;
        deplacer(s, ajout);
        if (total - avant >= main.derniereRelance) {
          // Relance complète : tout le monde doit reparler.
          main.derniereRelance = total - avant;
          for (const autre of sieges) if (autre !== s) autre.aAgi = false;
        }
        main.miseActuelle = total;
        main.journal.push({ ...base, type: avant === 0 ? 'mise' : 'relance', montant: ajout, increment: total - avant, total, tapis: s.tapis === 0 });
        break;
      }
      default:
        throw new Error(`Action inconnue : « ${type} »`);
    }
    s.aAgi = true;
    passerLaParole(i);
    return etat();
  }

  function terminer() {
    // La mise que personne n'a égalisée revient à son auteur.
    const tri = sieges.filter((s) => s.investi > 0).sort((a, b) => b.investi - a.investi);
    const surplus = tri.length ? tri[0].investi - (tri[1]?.investi ?? 0) : 0;
    if (surplus > 0 && !tri[0].couche) {
      tri[0].investi -= surplus;
      tri[0].tapis += surplus;
      main.rendus.set(tri[0], surplus);
    }
    const restants = sieges.filter(dansLeCoup);
    main.abattage = restants.length > 1;
    if (!main.abattage) {
      main.gains.set(restants[0], sieges.reduce((t, s) => t + s.investi, 0));
    } else {
      for (const pot of calculerPots(restants)) {
        const scores = pot.eligibles.map((s) => ({ s, score: evaluer([...s.cartes, ...main.tableau]) }));
        const meilleur = Math.max(...scores.map((x) => x.score));
        const gagnants = scores.filter((x) => x.score === meilleur).map((x) => x.s).sort((a, b) => distanceDuBouton(a) - distanceDuBouton(b));
        const part = Math.floor(pot.montant / gagnants.length);
        let impairs = pot.montant - part * gagnants.length;
        for (const g of gagnants) {
          main.gains.set(g, (main.gains.get(g) ?? 0) + part + (impairs-- > 0 ? 1 : 0));
        }
      }
    }
    for (const [s, m] of main.gains) s.tapis += m;
    main.terminee = true;
    main.aQui = -1;
    if (f.tournoi) for (const s of sieges) if (s.tapis === 0) s.elimine = true;
    resultats.push({
      numero: main.numero,
      id: main.id,
      net: Object.fromEntries(sieges.filter((s) => s.tapisDepart > 0).map((s) => [s.nom, s.tapis - s.tapisDepart])),
      gagnants: [...main.gains.keys()].map((s) => s.nom),
      abattage: main.abattage,
      mainsMontrees: main.abattage
        ? Object.fromEntries(restants.map((s) => [s.nom, { cartes: [...s.cartes], description: decrireScore(evaluer([...s.cartes, ...main.tableau])) }]))
        : {},
      tableau: [...main.tableau],
    });
    historiques.push(ecrireHistorique(restants));
  }

  /** Pots principal et annexes, à partir de ce que chacun a investi. */
  function calculerPots(restants) {
    const niveaux = [...new Set(restants.map((s) => s.investi))].sort((a, b) => a - b);
    const pots = [];
    let precedent = 0;
    for (const n of niveaux) {
      let montant = 0;
      for (const s of sieges) montant += Math.max(0, Math.min(s.investi, n) - Math.min(s.investi, precedent));
      if (montant > 0) pots.push({ montant, eligibles: restants.filter((s) => s.investi >= n) });
      precedent = n;
    }
    // Un joueur couché qui aurait investi plus que tous les restants : son surplus va au dernier pot.
    const mort = sieges.reduce((t, s) => t + Math.max(0, s.investi - precedent), 0);
    if (mort > 0 && pots.length) pots[pots.length - 1].montant += mort;
    return pots;
  }

  function distanceDuBouton(s) {
    return (sieges.indexOf(s) - main.bouton - 1 + sieges.length) % sieges.length;
  }

  /** L'historique de la main, au format texte « à la PokerStars » que lit src/analyse/historique.js. */
  function ecrireHistorique(restants) {
    const l = [];
    const { petiteBlinde: pb, grosseBlinde: gb } = main;
    const date = formaterDate(main.debut);
    l.push(
      f.tournoi
        ? `Entraînement Hand #${main.id}: Tournament #${idTournoi}, ${f.nom} Hold'em No Limit - Level ${ROMAINS[main.niveau] ?? main.niveau + 1} (${pb}/${gb}) - ${date}`
        : `Entraînement Hand #${main.id}: Hold'em No Limit (${pb}/${gb}) - ${date}`,
    );
    l.push(`Table '${f.nom} ${idTournoi}' ${f.nbJoueurs}-max Seat #${sieges[main.bouton].siege} is the button`);
    for (const s of sieges) if (s.tapisDepart > 0) l.push(`Seat ${s.siege}: ${s.nom} (${s.tapisDepart} in chips)`);
    const postes = main.journal.filter((e) => e.type === 'poste');
    for (const e of postes) l.push(`${e.nom}: posts ${e.genre} ${e.montant}${e.tapis ? ' and is all-in' : ''}`);
    l.push('*** HOLE CARDS ***');
    for (const s of sieges) if (s.type === 'humain' && s.cartes.length) l.push(`Dealt to ${s.nom} [${nomCartes(s.cartes)}]`);
    for (const e of main.journal) {
      if (e.type === 'poste') continue;
      if (e.type === 'tableau') {
        const c = e.cartes;
        if (e.rue === 'flop') l.push(`*** FLOP *** [${nomCartes(c.slice(0, 3))}]`);
        else if (e.rue === 'turn') l.push(`*** TURN *** [${nomCartes(c.slice(0, 3))}] [${nomCartes(c.slice(3, 4))}]`);
        else l.push(`*** RIVER *** [${nomCartes(c.slice(0, 4))}] [${nomCartes(c.slice(4, 5))}]`);
        continue;
      }
      const tapis = e.tapis ? ' and is all-in' : '';
      if (e.type === 'couche') l.push(`${e.nom}: folds`);
      else if (e.type === 'parole') l.push(`${e.nom}: checks`);
      else if (e.type === 'suit') l.push(`${e.nom}: calls ${e.montant}${tapis}`);
      else if (e.type === 'mise') l.push(`${e.nom}: bets ${e.montant}${tapis}`);
      else if (e.type === 'relance') l.push(`${e.nom}: raises ${e.increment} to ${e.total}${tapis}`);
    }
    for (const [s, m] of main.rendus) l.push(`Uncalled bet (${m}) returned to ${s.nom}`);
    if (main.abattage) {
      l.push('*** SHOW DOWN ***');
      for (const s of restants) l.push(`${s.nom}: shows [${nomCartes(s.cartes)}] (${decrireScore(evaluer([...s.cartes, ...main.tableau]))})`);
    }
    for (const [s, m] of main.gains) if (m > 0) l.push(`${s.nom} collected ${m} from pot`);
    l.push('*** SUMMARY ***');
    l.push(`Total pot ${[...main.gains.values()].reduce((a, b) => a + b, 0)} | Rake 0`);
    if (main.tableau.length) l.push(`Board [${nomCartes(main.tableau)}]`);
    return l.join('\n');
  }

  /** Ce que voit le joueur d'index i, au format de situation du bot (src/strategie/bot.js). */
  function situationPour(i) {
    const s = sieges[i];
    const a = actionsPossibles(i);
    if (!a) throw new Error(`Ce n’est pas à ${s.nom} de parler.`);
    const preflop = main.journal.filter((e) => e.rue === 'preflop' && e.type !== 'poste' && e.type !== 'tableau');
    const relances = preflop.filter((e) => e.type === 'mise' || e.type === 'relance');
    const actionPreflop = (k) => {
      const siennes = preflop.filter((e) => e.siege === k);
      const derniere = siennes.at(-1);
      if (!derniere) return k === main.iGB ? 'grosse-blinde' : null;
      if (derniere.type === 'mise' || derniere.type === 'relance') {
        if (derniere.tapis) return 'tapis';
        return ['ouverture', 'relance'][relances.indexOf(derniere)] ?? 'surrelance';
      }
      if (derniere.type === 'suit') return relances.some((r) => preflop.indexOf(r) < preflop.indexOf(derniere)) ? 'suivi' : 'limp';
      return derniere.type === 'parole' ? 'grosse-blinde' : null;
    };
    const adversaires = sieges
      .map((x, k) => ({ x, k }))
      .filter(({ x, k }) => k !== i && dansLeCoup(x))
      .map(({ x, k }) => ({
        nom: x.nom,
        position: main.positions.get(x.siege),
        tapis: x.tapis,
        mise: x.mise,
        profil: x.type === 'bot' ? x.profil : undefined,
        actionPreflop: actionPreflop(k),
        actionsPostflop: main.journal
          .filter((e) => e.siege === k && e.rue !== 'preflop' && ['mise', 'relance', 'suit', 'parole'].includes(e.type))
          .map((e) => ({ rue: e.rue, type: e.tapis && e.type !== 'suit' ? 'tapis' : e.type })),
      }));
    const dernier = relances.at(-1);
    return {
      main: [...s.cartes],
      tableau: [...main.tableau],
      rue: main.rue,
      position: main.positions.get(s.siege),
      grosseBlinde: main.grosseBlinde,
      pot: sieges.reduce((t, x) => t + x.investi, 0),
      aSuivre: a.aSuivre,
      dejaMise: s.mise,
      miseActuelle: main.miseActuelle,
      relanceMin: (a.relance ?? a.mise)?.min ?? main.miseActuelle * 2,
      peutRelancer: Boolean(a.relance || a.mise),
      tapis: s.tapis,
      adversaires,
      nbRelancesPreflop: relances.length,
      agresseurPreflop: dernier ? (dernier.siege === i ? 'hero' : dernier.nom) : null,
      joueursDerriere: sieges.filter((x, k) => k !== i && peutAgir(x) && (!x.aAgi || x.mise < main.miseActuelle)).length,
    };
  }

  /** La table vue du siège `pourSiege` : les cartes des autres restent cachées jusqu'à l'abattage. */
  function etat(pourSiege) {
    if (!main) return { numeroMain: 0, terminee: true, partieFinie: partieFinie(), joueurs: sieges.map((s) => ({ nom: s.nom, tapis: s.tapis })) };
    return {
      format: f.id,
      numeroMain: main.numero,
      idMain: main.id,
      niveau: main.niveau + 1,
      petiteBlinde: main.petiteBlinde,
      grosseBlinde: main.grosseBlinde,
      mainsAvantNiveau:
        Number.isFinite(parNiveau) && main.niveau < f.niveaux.length - 1 ? parNiveau - ((main.numero - 1) % parNiveau) : null,
      rue: main.rue,
      tableau: [...main.tableau],
      pot: sieges.reduce((t, s) => t + s.investi, 0),
      aQui: main.aQui,
      bouton: main.bouton,
      terminee: main.terminee,
      partieFinie: main.terminee && partieFinie(),
      joueurs: sieges.map((s, k) => ({
        index: k,
        siege: s.siege,
        nom: s.nom,
        type: s.type,
        profil: s.profil,
        tapis: s.tapis,
        mise: s.mise,
        investi: s.investi,
        couche: s.couche,
        elimine: s.elimine && s.tapisDepart === 0,
        aTapis: dansLeCoup(s) && s.tapis === 0,
        position: main.positions.get(s.siege) ?? null,
        cartes: k === pourSiege || (main.terminee && main.abattage && dansLeCoup(s)) ? [...s.cartes] : null,
        net: main.terminee ? s.tapis - s.tapisDepart : null,
      })),
      actions: main.aQui >= 0 ? actionsPossibles(main.aQui) : null,
      resultat: main.terminee ? resultats.at(-1) : null,
      journal: main.journal.map((e) => ({ ...e })),
    };
  }

  return {
    format: f,
    nouvelleMain,
    jouer,
    actionsPossibles,
    situationPour,
    etat,
    partieFinie,
    aQui: () => (main && !main.terminee ? main.aQui : -1),
    joueur: (i) => ({ ...sieges[i], cartes: undefined }),
    nbSieges: sieges.length,
    historique: () => historiques.join('\n\n\n'),
    resultats: () => [...resultats],
  };
}

function formaterDate(ms) {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${z(d.getMonth() + 1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}
