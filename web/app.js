// La page : trois outils branchés sur le même moteur que la ligne de commande.

import { RANGS, SYMBOLES, NOMS_RANGS, carte, rangDe, couleurDe, afficherCartes } from '../src/cartes.js';
import { lireRange, decrireRange } from '../src/ranges.js';
import { calculerEquite } from '../src/equite.js';
import { deciderSuivre, analyserTapis } from '../src/decision.js';
import { lireHistorique } from '../src/historique.js';
import { analyserSession } from '../src/detection.js';
import { pct, montant, signe } from '../src/format.js';

const NOMS_COULEURS = ['trèfle', 'carreau', 'cœur', 'pique'];
const $ = (id) => document.getElementById(id);

/** Crée un élément : el('p', { class: 'aide' }, 'texte', autreElement). Jamais d'innerHTML. */
function el(nom, attributs = {}, ...enfants) {
  const e = document.createElement(nom);
  for (const [k, v] of Object.entries(attributs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const enfant of enfants.flat()) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    e.append(enfant instanceof Node ? enfant : String(enfant));
  }
  return e;
}

const estRouge = (c) => couleurDe(c) === 1 || couleurDe(c) === 2;
const lettreRang = (c) => (RANGS[rangDe(c)] === 'T' ? '10' : RANGS[rangDe(c)]);

function visuelCarte(c) {
  return el('span', { class: `carte ${estRouge(c) ? 'rouge' : 'noir'}` }, el('b', {}, lettreRang(c)), el('i', {}, SYMBOLES[couleurDe(c)]));
}

/** Des cartes dans une phrase : « A♥ K♦ ». */
function cartesEnLigne(cartes) {
  return el(
    'span',
    { class: 'carte-texte' },
    cartes.map((c) => el('span', { class: estRouge(c) ? 'rouge' : 'noir' }, lettreRang(c) + SYMBOLES[couleurDe(c)])),
  );
}

function debounce(fn, ms) {
  let minuterie;
  return (...args) => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => fn(...args), ms);
  };
}

function nombre(id, defaut = 0) {
  const brut = $(id).value.trim().replace(',', '.');
  if (brut === '') return defaut;
  const n = Number(brut);
  return Number.isFinite(n) ? n : NaN;
}

/* ------------------------------------------------------------------ */
/* Le sélecteur de cartes : des cases, un paquet.                       */
/* ------------------------------------------------------------------ */

function creerSelecteur({ emplacements, paquet, groupes, surChangement }) {
  const valeurs = Object.fromEntries(groupes.map((g) => [g.nom, Array(g.taille).fill(null)]));
  let actif = { groupe: groupes[0].nom, index: 0 };
  const boutonsPaquet = new Map();

  const toutes = () => groupes.flatMap((g) => valeurs[g.nom]).filter((c) => c !== null);

  function suivantVide() {
    const ordre = groupes.flatMap((g) => valeurs[g.nom].map((c, i) => ({ groupe: g.nom, index: i, c })));
    const depart = ordre.findIndex((o) => o.groupe === actif.groupe && o.index === actif.index);
    for (let k = 1; k <= ordre.length; k++) {
      const o = ordre[(depart + k) % ordre.length];
      if (o.c === null) return { groupe: o.groupe, index: o.index };
    }
    return actif;
  }

  function dessiner() {
    emplacements.replaceChildren();
    groupes.forEach((g, gi) => {
      if (gi > 0) emplacements.append(el('span', { class: 'separateur', 'aria-hidden': 'true' }));
      valeurs[g.nom].forEach((c, i) => {
        const estActif = actif.groupe === g.nom && actif.index === i;
        const libelle = g.libelles?.[i] ?? g.libelle;
        const bouton = el(
          'button',
          {
            type: 'button',
            class: `emplacement${c !== null ? ' plein' : ''}${estActif ? ' actif' : ''}`,
            'aria-label': c !== null ? `${libelle} : ${nomComplet(c)}, toucher pour retirer` : `${libelle} : vide`,
            'aria-pressed': estActif ? 'true' : 'false',
          },
          c !== null ? visuelCarte(c) : '+',
        );
        bouton.addEventListener('click', () => {
          if (c !== null) valeurs[g.nom][i] = null;
          actif = { groupe: g.nom, index: i };
          dessiner();
          if (c !== null) surChangement();
        });
        emplacements.append(bouton);
      });
    });
    const prises = new Set(toutes());
    for (const [c, b] of boutonsPaquet) b.disabled = prises.has(c);
  }

  // Le paquet : une ligne par couleur, de l'as au deux.
  for (const couleur of [3, 2, 1, 0]) {
    for (let r = 12; r >= 0; r--) {
      const c = carte(r, couleur);
      const b = el(
        'button',
        { type: 'button', class: estRouge(c) ? 'rouge' : 'noir', 'aria-label': nomComplet(c) },
        el('span', {}, lettreRang(c)),
        el('span', {}, SYMBOLES[couleur]),
      );
      b.addEventListener('click', () => {
        valeurs[actif.groupe][actif.index] = c;
        actif = suivantVide();
        dessiner();
        surChangement();
      });
      boutonsPaquet.set(c, b);
      paquet.append(b);
    }
  }

  return {
    valeurs: (nom) => valeurs[nom].filter((c) => c !== null),
    remplir(nom, cartes) {
      valeurs[nom] = Array(valeurs[nom].length).fill(null);
      cartes.forEach((c, i) => (valeurs[nom][i] = c));
      actif = suivantVide();
      dessiner();
    },
  };
}

function nomComplet(c) {
  return `${NOMS_RANGS[rangDe(c)]} de ${NOMS_COULEURS[couleurDe(c)]}`;
}

/** Une range tapée au clavier, avec sa description ou son erreur. */
function lireRangeChamp(champ, info) {
  try {
    const combos = lireRange(champ.value);
    info.className = 'aide';
    info.textContent = decrireRange(combos);
    return combos;
  } catch (e) {
    info.className = 'erreur';
    info.textContent = e.message;
    return null;
  }
}

function pastillesDeRange(conteneur, champ, choix, surChangement) {
  const boutons = choix.map(([libelle, valeur]) => {
    const b = el('button', { type: 'button', 'aria-pressed': 'false' }, libelle);
    b.addEventListener('click', () => {
      champ.value = valeur;
      marquer();
      surChangement();
    });
    conteneur.append(b);
    return [b, valeur];
  });
  const marquer = () => boutons.forEach(([b, v]) => b.setAttribute('aria-pressed', String(champ.value.trim() === v)));
  champ.addEventListener('input', marquer);
  marquer();
}

function compteur(moins, plus, sortie, min, max, surChangement) {
  let n = Number(sortie.textContent);
  const definir = (v) => {
    n = Math.min(max, Math.max(min, v));
    sortie.textContent = String(n);
    surChangement();
  };
  moins.addEventListener('click', () => definir(n - 1));
  plus.addEventListener('click', () => definir(n + 1));
  return { valeur: () => n, definir };
}

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

const TON = { SUIVRE: 'bon', MISER: 'bon', TAPIS: 'bon', SE_COUCHER: 'mauvais', LIMITE: 'limite', CHECKER: 'neutre' };

function etatVide(conteneur, titre, texte) {
  conteneur.replaceChildren(
    el('div', { class: 'verdict' }, el('p', { class: 'etiquette' }, 'Verdict'), el('p', { class: 'mot neutre' }, titre), el('p', { class: 'resume' }, texte)),
  );
}

function jauge(equite, requise) {
  const rempli = el('span', { class: 'rempli', style: `width: ${(equite * 100).toFixed(1)}%` });
  const piste = el('div', { class: 'piste', role: 'img', 'aria-label': `Équité ${pct(equite)}${requise > 0 ? `, il faut ${pct(requise)}` : ''}` }, rempli);
  if (requise > 0) piste.append(el('span', { class: 'repere', style: `left: calc(${(Math.min(requise, 1) * 100).toFixed(1)}% - 1px)` }));
  return el(
    'div',
    { class: 'jauge' },
    piste,
    el('div', { class: 'legende' }, el('span', {}, `Ton équité ${pct(equite)}`), requise > 0 ? el('span', {}, `Il faut ${pct(requise)}`) : null),
  );
}

function chiffres(lignes) {
  return el(
    'dl',
    { class: 'chiffres' },
    lignes.map(([dt, dd, ton]) => el('div', {}, el('dt', {}, dt), el('dd', { class: ton ?? null }, dd))),
  );
}

function repartition(r) {
  const lignes = r.repartition.filter((x) => x.frequence >= 0.005).reverse();
  return el(
    'div',
    { class: 'groupe' },
    el('p', { class: 'etiquette' }, 'Ta main à la fin du coup'),
    el(
      'div',
      { class: 'repartition' },
      lignes.map((x) =>
        el(
          'div',
          { class: 'barre' },
          el('span', {}, x.categorie),
          el('div', {}, el('span', { style: `width: ${(x.frequence * 100).toFixed(1)}%` })),
          el('output', {}, pct(x.frequence, 0)),
        ),
      ),
    ),
  );
}

function methode(r) {
  return r.methode === 'exacte'
    ? `Calcul exact sur ${r.echantillons.toLocaleString('fr-FR')} distributions.`
    : `Monte-Carlo, ${r.echantillons.toLocaleString('fr-FR')} tirages, à ±${pct(1.96 * r.joueurs[0].erreurType, 1)} près.`;
}

/* ------------------------------------------------------------------ */
/* Suivre ou pas                                                       */
/* ------------------------------------------------------------------ */

function brancherDecision() {
  const verdict = $('decision-verdict');
  const champRange = $('decision-range');
  const infoRange = $('decision-range-info');
  const recalculer = debounce(calculer, 180);
  const adversaires = compteur($('adv-moins'), $('adv-plus'), $('adv-nombre'), 1, 8, recalculer);

  const selecteur = creerSelecteur({
    emplacements: $('decision-emplacements'),
    paquet: $('decision-paquet'),
    groupes: [
      { nom: 'main', taille: 2, libelle: 'Ta carte' },
      { nom: 'tableau', taille: 5, libelles: ['Flop', 'Flop', 'Flop', 'Tournant', 'Rivière'] },
    ],
    surChangement: recalculer,
  });

  pastillesDeRange(
    $('decision-pastilles'),
    champRange,
    [
      ['Aléatoire', 'aléatoire'],
      ['Large · 45 %', '45%'],
      ['Moyenne · 25 %', '25%'],
      ['Serrée · 12 %', '12%'],
      ['Très serrée', 'QQ+, AK'],
    ],
    recalculer,
  );
  for (const id of ['decision-range', 'decision-pot', 'decision-suivre', 'decision-rake', 'decision-plafond', 'decision-implicites']) {
    $(id).addEventListener('input', recalculer);
  }

  function calculer() {
    const range = lireRangeChamp(champRange, infoRange);
    const main = selecteur.valeurs('main');
    const tableau = selecteur.valeurs('tableau');
    if (main.length < 2) return etatVide(verdict, 'À toi de jouer', 'Choisis tes deux cartes pour voir le verdict.');
    if (tableau.length === 1 || tableau.length === 2) {
      return etatVide(verdict, 'Flop incomplet', 'Le flop compte trois cartes : ajoute-les, ou retire le tableau pour un calcul avant le flop.');
    }
    if (!range) return etatVide(verdict, 'Range illisible', 'Corrige la range adverse pour relancer le calcul.');
    const pot = nombre('decision-pot');
    const aSuivre = nombre('decision-suivre');
    const rake = nombre('decision-rake') / 100;
    const plafond = nombre('decision-plafond', Infinity);
    const implicites = nombre('decision-implicites');
    if ([pot, aSuivre, rake, plafond, implicites].some((x) => Number.isNaN(x) || x < 0)) {
      return etatVide(verdict, 'Montant à corriger', 'Le pot, la mise et le rake doivent être des nombres positifs.');
    }

    try {
      const n = adversaires.valeur();
      const r = calculerEquite({
        joueurs: [[main], ...Array.from({ length: n }, () => range)],
        tableau,
        iterations: 150_000,
        limiteExacte: 400_000,
        tempsMaxMs: 700,
      });
      const d = deciderSuivre({
        equite: r.joueurs[0].equite,
        pot,
        aSuivre,
        nbAdversaires: n,
        rake,
        plafondRake: plafond,
        gainsImplicites: implicites,
        cartesARetourner: 5 - tableau.length,
      });
      const contexte = `${afficherCartes(main)}${tableau.length ? ` sur ${afficherCartes(tableau)}` : ', avant le flop'}, contre ${n} adversaire${n > 1 ? 's' : ''}`;
      verdict.replaceChildren(
        el('div', { class: 'verdict' }, el('p', { class: 'etiquette' }, 'Verdict'), el('p', { class: `mot ${TON[d.action]}` }, d.titre), el('p', { class: 'resume' }, contexte)),
        jauge(d.equite, d.equiteRequise),
        chiffres([
          ['Ton équité', pct(d.equite)],
          ['Il faut', aSuivre > 0 ? pct(d.equiteRequise) : '—'],
          ['Espérance du call', aSuivre > 0 ? signe(d.ev) : '—', aSuivre > 0 ? (d.ev >= 0 ? 'bon' : 'mauvais') : null],
          ['Cote du pot', aSuivre > 0 ? `${montant(pot / aSuivre)} : 1` : '—'],
        ]),
        el('ul', { class: 'raisons' }, d.raisons.map((t) => el('li', {}, t))),
        repartition(r),
        el('p', { class: 'methode' }, methode(r)),
      );
    } catch (e) {
      etatVide(verdict, 'Calcul impossible', e.message);
    }
  }

  // Une situation d'exemple pour que la page parle dès l'ouverture.
  selecteur.remplir('main', [carte(12, 2), carte(11, 2)]); // A♥ K♥
  selecteur.remplir('tableau', [carte(10, 2), carte(5, 2), carte(0, 0)]); // Q♥ 7♥ 2♣
  calculer();
}

/* ------------------------------------------------------------------ */
/* Tapis ou pas                                                        */
/* ------------------------------------------------------------------ */

function brancherTapis() {
  const verdict = $('tapis-verdict');
  const champRange = $('tapis-range');
  const infoRange = $('tapis-range-info');
  const recalculer = debounce(calculer, 180);
  const derriere = compteur($('derriere-moins'), $('derriere-plus'), $('derriere-nombre'), 1, 8, recalculer);

  const selecteur = creerSelecteur({
    emplacements: $('tapis-emplacements'),
    paquet: $('tapis-paquet'),
    groupes: [{ nom: 'main', taille: 2, libelle: 'Ta carte' }],
    surChangement: recalculer,
  });

  pastillesDeRange(
    $('tapis-pastilles'),
    champRange,
    [
      ['Serré · 10 %', '10%'],
      ['Moyen · 18 %', '18%'],
      ['Large · 30 %', '30%'],
      ['Très large · 45 %', '45%'],
    ],
    recalculer,
  );

  // Les places courantes remplissent ce qui est déjà au pot.
  const places = [
    ['Petite blinde', { poste: 0.5, posteAdverse: 1, pot: 1.5, derriere: 1 }],
    ['Bouton', { poste: 0, posteAdverse: 1, pot: 1.5, derriere: 2 }],
    ['Cut-off', { poste: 0, posteAdverse: 1, pot: 1.5, derriere: 3 }],
  ];
  const conteneurPlaces = $('tapis-places');
  for (const [libelle, p] of places) {
    const b = el('button', { type: 'button', 'aria-pressed': libelle === 'Petite blinde' ? 'true' : 'false' }, libelle);
    b.addEventListener('click', () => {
      $('tapis-poste').value = p.poste;
      $('tapis-poste-adverse').value = p.posteAdverse;
      $('tapis-pot').value = p.pot;
      for (const autre of conteneurPlaces.children) autre.setAttribute('aria-pressed', String(autre === b));
      derriere.definir(p.derriere);
    });
    conteneurPlaces.append(b);
  }

  for (const id of ['tapis-range', 'tapis-hero', 'tapis-poste', 'tapis-pot', 'tapis-adverse', 'tapis-poste-adverse']) {
    $(id).addEventListener('input', recalculer);
  }

  function calculer() {
    const range = lireRangeChamp(champRange, infoRange);
    const main = selecteur.valeurs('main');
    if (main.length < 2) return etatVide(verdict, 'À toi de jouer', 'Choisis tes deux cartes pour voir le verdict.');
    if (!range) return etatVide(verdict, 'Range illisible', 'Corrige la range d’appel pour relancer le calcul.');
    const montants = {
      tapisHero: nombre('tapis-hero'),
      posteHero: nombre('tapis-poste'),
      pot: nombre('tapis-pot'),
      tapisAdverse: nombre('tapis-adverse'),
      posteAdverse: nombre('tapis-poste-adverse'),
    };
    if (Object.values(montants).some((x) => Number.isNaN(x) || x < 0)) {
      return etatVide(verdict, 'Montant à corriger', 'Les tapis et le pot doivent être des nombres positifs.');
    }
    try {
      const d = analyserTapis({ main, rangeAppel: range, nbAdversaires: derriere.valeur(), iterations: 80_000, tempsMaxMs: 600, ...montants });
      verdict.replaceChildren(
        el(
          'div',
          { class: 'verdict' },
          el('p', { class: 'etiquette' }, 'Verdict'),
          el('p', { class: `mot ${TON[d.action]}` }, d.titre),
          el('p', { class: 'resume' }, `${afficherCartes(main)}, ${montant(montants.tapisHero + montants.posteHero)} au total, ${derriere.valeur()} joueur${derriere.valeur() > 1 ? 's' : ''} derrière`),
        ),
        jauge(d.equiteSiSuivi, d.risque / d.potFinal),
        chiffres([
          ['Tous se couchent', pct(d.probaTousSeCouchent, 0)],
          ['Équité si suivi', pct(d.equiteSiSuivi)],
          ['Espérance si suivi', signe(d.evSiSuivi), d.evSiSuivi >= 0 ? 'bon' : 'mauvais'],
          ['Espérance du tapis', signe(d.ev), d.ev >= 0 ? 'bon' : 'mauvais'],
        ]),
        el('ul', { class: 'raisons' }, d.raisons.map((t) => el('li', {}, t))),
        el('p', { class: 'methode' }, methode(d.calcul)),
      );
    } catch (e) {
      etatVide(verdict, 'Calcul impossible', e.message);
    }
  }

  selecteur.remplir('main', [carte(12, 0), carte(5, 1)]); // A♣ 7♦
  calculer();
}

/* ------------------------------------------------------------------ */
/* Analyse de session                                                  */
/* ------------------------------------------------------------------ */

function brancherSession() {
  const zone = $('session-texte');
  const resultat = $('session-resultat');

  $('session-fichier').addEventListener('change', (ev) => {
    const fichier = ev.target.files?.[0];
    if (!fichier) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      zone.value = String(lecteur.result ?? '');
      analyser();
    };
    lecteur.onerror = () => {
      resultat.replaceChildren(el('p', { class: 'erreur' }, `Lecture du fichier impossible : ${lecteur.error?.message ?? 'erreur inconnue'}.`));
    };
    lecteur.readAsText(fichier);
  });
  $('session-analyser').addEventListener('click', analyser);

  function analyser() {
    resultat.replaceChildren(el('p', { class: 'aide' }, 'Analyse en cours…'));
    setTimeout(() => {
      try {
        afficher();
      } catch (e) {
        resultat.replaceChildren(el('p', { class: 'erreur' }, `Analyse impossible : ${e.message}`));
      }
    }, 20);
  }

  function afficher() {
    const { mains, ignorees } = lireHistorique(zone.value);
    const hero = $('session-hero').value.trim() || undefined;
    const r = analyserSession(mains, { hero, rangeAdverse: $('session-range').value.trim() || '30%', iterations: 3000 });
    const blocs = [];

    if (!r.hero) {
      blocs.push(el('p', { class: 'erreur' }, r.avertissements.join(' ')));
      if (ignorees.length) blocs.push(listeIgnorees(ignorees));
      resultat.replaceChildren(...blocs);
      return;
    }

    const s = r.stats;
    blocs.push(
      el('div', { class: 'verdict' }, el('p', { class: 'etiquette' }, `${r.hero} · ${r.nbMains} mains`), el('p', { class: `mot ${s.resultat >= 0 ? 'bon' : 'mauvais'}` }, signe(s.resultat))),
      chiffres([
        ['bb / 100 mains', Number.isFinite(s.bb100) ? signe(s.bb100) : '—', s.bb100 >= 0 ? 'bon' : 'mauvais'],
        ['VPIP', pct(s.vpip, 0)],
        ['PFR', pct(s.pfr, 0)],
        ['Agression', Number.isFinite(s.af) ? s.af.toFixed(1).replace('.', ',') : '—'],
        ['Abattage', pct(s.wtsd, 0)],
        ['Gagné à l’abattage', pct(s.wsd, 0)],
      ]),
    );
    for (const a of r.avertissements) blocs.push(el('p', { class: 'aide' }, a));

    blocs.push(
      el(
        'div',
        { class: 'groupe' },
        el('p', { class: 'etiquette' }, 'Ce que l’analyse détecte'),
        r.fuites.length === 0
          ? el('p', { class: 'aide' }, 'Aucune fuite nette sur cet échantillon.')
          : el(
              'ul',
              { class: 'fuites' },
              r.fuites.map((f) =>
                el('li', {}, el('span', { class: `gravite ${f.gravite}` }, { forte: 'Forte', moyenne: 'À surveiller', info: 'Info' }[f.gravite]), el('strong', {}, f.titre), el('p', {}, f.detail)),
              ),
            ),
      ),
    );

    if (r.decisions.erreurs.length > 0) {
      blocs.push(
        tableau(
          `Calls et abandons contraires à la cote (range supposée : ${r.decisions.rangeAdverse})`,
          ['Main', 'Rue', 'Décision', 'Tes cartes', 'Tableau', 'Équité', 'Il fallait', 'Coût'],
          r.decisions.erreurs.map((e) => [
            `#${e.id}`,
            { preflop: 'Préflop', flop: 'Flop', turn: 'Tournant', river: 'Rivière' }[e.rue],
            e.action,
            cartesTexte(e.main),
            e.tableau ? cartesTexte(e.tableau) : '—',
            [pct(e.equite), 'n'],
            [pct(e.requise), 'n'],
            [montant(e.cout), 'n negatif'],
          ]),
        ),
      );
    }

    if (r.tapis.mains.length > 0) {
      blocs.push(
        tableau(
          `Tapis montrés · attendu ${signe(r.tapis.attendu)}, réel ${signe(r.tapis.reel)}, chance ${signe(r.tapis.chance)}`,
          ['Main', 'Toi', 'Adversaire', 'Tableau', 'Équité', 'Attendu', 'Réel'],
          r.tapis.mains.map((t) => [
            `#${t.id}`,
            cartesTexte(t.hero),
            cartesTexte(t.cartesAdverses),
            t.tableau ? cartesTexte(t.tableau) : 'Préflop',
            [pct(t.equite), 'n'],
            [signe(t.attendu), `n ${t.attendu >= 0 ? 'positif' : 'negatif'}`],
            [signe(t.reel), `n ${t.reel >= 0 ? 'positif' : 'negatif'}`],
          ]),
        ),
      );
    }

    const ordre = ['UTG', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    const positions = Object.entries(r.parPosition).sort((a, b) => ordre.indexOf(a[0]) - ordre.indexOf(b[0]));
    if (positions.length > 0) {
      blocs.push(
        tableau(
          'Par position',
          ['Position', 'Mains', 'VPIP', 'PFR', 'Résultat'],
          positions.map(([p, st]) => [p, [String(st.mains), 'n'], [pct(st.vpip, 0), 'n'], [pct(st.pfr, 0), 'n'], [signe(st.resultat), `n ${st.resultat >= 0 ? 'positif' : 'negatif'}`]]),
        ),
      );
    }
    if (ignorees.length) blocs.push(listeIgnorees(ignorees));
    resultat.replaceChildren(...blocs);
  }

  function cartesTexte(texte) {
    // « A♥ K♦ » déjà mis en forme par le moteur : on le recolore.
    return el(
      'span',
      { class: 'carte-texte' },
      texte.split(' ').filter(Boolean).map((t) => el('span', { class: /[♥♦]/.test(t) ? 'rouge' : 'noir' }, t)),
    );
  }

  function tableau(titre, entetes, lignes) {
    const numerique = (i) => lignes.some((l) => Array.isArray(l[i]) && l[i][1].startsWith('n'));
    return el(
      'div',
      { class: 'groupe' },
      el('p', { class: 'etiquette' }, titre),
      el(
        'div',
        { class: 'tableau-defile' },
        el(
          'table',
          {},
          el('thead', {}, el('tr', {}, entetes.map((h, i) => el('th', { class: numerique(i) ? 'n' : null }, h)))),
          el('tbody', {}, lignes.map((l) => el('tr', {}, l.map((v) => (Array.isArray(v) ? el('td', { class: v[1] }, v[0]) : el('td', {}, v)))))),
        ),
      ),
    );
  }

  function listeIgnorees(ignorees) {
    return el(
      'div',
      { class: 'groupe' },
      el('p', { class: 'etiquette' }, `${ignorees.length} main${ignorees.length > 1 ? 's' : ''} non lue${ignorees.length > 1 ? 's' : ''}`),
      el('p', { class: 'aide' }, 'Si ton fichier vient de Betclic et que beaucoup de mains ne sont pas lues, le format diffère : le lecteur s’adapte en un seul fichier (src/historique.js).'),
      el('ul', { class: 'raisons' }, ignorees.slice(0, 8).map((m) => el('li', {}, `${m.id ? `#${m.id} : ` : ''}${m.erreur}`))),
    );
  }

  // L'exemple livré avec l'outil, analysé tout de suite.
  fetch('exemples/session-exemple.txt')
    .then((rep) => (rep.ok ? rep.text() : Promise.reject(new Error(`HTTP ${rep.status}`))))
    .then((texte) => {
      if (!zone.value) zone.value = texte;
      analyser();
    })
    .catch((e) => {
      resultat.replaceChildren(el('p', { class: 'aide' }, `Colle tes mains puis touche « Analyser ». (Exemple indisponible : ${e.message}.)`));
    });
}

/* ------------------------------------------------------------------ */
/* Onglets                                                             */
/* ------------------------------------------------------------------ */

const VUES = ['decision', 'tapis', 'session'];
function montrer(vue) {
  const choisie = VUES.includes(vue) ? vue : 'decision';
  for (const v of VUES) $(`vue-${v}`).hidden = v !== choisie;
  for (const a of document.querySelectorAll('nav.onglets a')) {
    if (a.dataset.vue === choisie) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}
for (const a of document.querySelectorAll('nav.onglets a')) {
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    montrer(a.dataset.vue);
    try {
      history.replaceState(null, '', `#${a.dataset.vue}`);
    } catch {
      // Certains cadres refusent de toucher l'adresse : l'onglet change quand même.
    }
  });
}

window.addEventListener('hashchange', () => montrer(location.hash.slice(1)));

brancherDecision();
brancherTapis();
brancherSession();
montrer(location.hash.slice(1));
