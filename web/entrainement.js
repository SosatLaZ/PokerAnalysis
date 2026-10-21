// L'onglet Entraînement : une table contre les bots, un chronomètre sur
// chacune de tes décisions, le verdict des quatre profils, et le bilan de la séance.

import { creerPartie, FORMATS } from '../src/jeu/table.js';
import { jouerUnBot } from '../src/jeu/bots.js';
import { conseillerTous } from '../src/strategie/bot.js';
import { PROFILS } from '../src/strategie/profils.js';
import { evaluerDecision, bilanEntrainement, LIBELLES_VERDICTS } from '../src/analyse/entrainement.js';
import { pct, court, signe } from '../src/moteur/format.js';
import { $, el, visuelCarte, dosDeCarte, chiffres } from './ui.js';

const NOMS_BOTS = ['bec', 'SosoCourt', 'Lucien', 'Margot', 'Paulo'];
const TON_VERDICT = { bon: 'bon', style: 'neutre', erreur: 'limite', nimportequoi: 'mauvais' };
const RUES = { preflop: 'Préflop', flop: 'Flop', turn: 'Tournant', river: 'Rivière' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export function brancherEntrainement({ envoyerVersAnalyse }) {
  const reglages = $('ent-reglages');
  const zoneTable = $('ent-table');
  const zoneActions = $('ent-actions');
  const zoneRetour = $('ent-retour');
  const zoneBilan = $('ent-bilan');

  let partie = null;
  let hero = 0;
  let decisions = [];
  let mains = [];
  let tour = null; // { situation, conseils, debut }
  let enCours = false;

  // Réglages : format et profil de chaque adversaire.
  const choixFormat = $('ent-format');
  for (const f of Object.values(FORMATS)) choixFormat.append(el('option', { value: f.id }, `${f.nom} · ${f.libelle}`));
  const zoneProfils = $('ent-profils');
  function dessinerChoixProfils() {
    const n = FORMATS[choixFormat.value].nbJoueurs - 1;
    zoneProfils.replaceChildren(
      ...Array.from({ length: n }, (_, k) =>
        el(
          'label',
          { class: 'champ' },
          NOMS_BOTS[k],
          el(
            'select',
            { id: `ent-profil-${k}`, 'data-index': String(k) },
            PROFILS.map((p) => el('option', { value: p.id, selected: p.id === PROFILS[(k + 1) % 4].id ? true : null }, `${p.nom} · risque ${p.risque}/4`)),
          ),
        ),
      ),
    );
  }
  choixFormat.addEventListener('change', dessinerChoixProfils);
  dessinerChoixProfils();
  $('ent-lancer').addEventListener('click', lancer);

  function lancer() {
    const f = FORMATS[choixFormat.value];
    const nom = $('ent-nom').value.trim() || 'Toi';
    const bots = Array.from({ length: f.nbJoueurs - 1 }, (_, k) => ({ nom: NOMS_BOTS[k] === nom ? `${NOMS_BOTS[k]}2` : NOMS_BOTS[k], type: 'bot', profil: $(`ent-profil-${k}`).value }));
    partie = creerPartie({ format: f.id, joueurs: [{ nom, type: 'humain' }, ...bots] });
    hero = 0;
    decisions = [];
    mains = [];
    zoneRetour.replaceChildren();
    dessinerBilan();
    nouvelleMain();
  }

  async function nouvelleMain() {
    if (!partie || partie.partieFinie()) return finDePartie();
    if (enCours || (partie.etat().numeroMain > 0 && !partie.etat().terminee)) return; // double clic
    zoneActions.replaceChildren(el('p', { class: 'aide' }, 'Les bots réfléchissent…'));
    partie.nouvelleMain();
    dessinerTable();
    await faireJouerLesBots();
  }

  async function faireJouerLesBots() {
    if (enCours) return;
    enCours = true;
    try {
      for (;;) {
        const i = partie.aQui();
        if (i < 0) break;
        if (i === hero) return ouvrirMonTour();
        await pause(550 + Math.random() * 500);
        const coup = jouerUnBot(partie, { iterations: 1500 });
        dessinerTable(coup);
      }
      finDeMain();
    } catch (e) {
      zoneActions.replaceChildren(el('p', { class: 'erreur' }, `La table s’est arrêtée : ${e.message}`));
    } finally {
      enCours = false;
    }
  }

  function ouvrirMonTour() {
    const situation = partie.situationPour(hero);
    tour = { situation, conseils: conseillerTous(situation, { iterations: 2500 }), debut: performance.now() };
    dessinerTable();
    dessinerActions();
  }

  async function jouer(action) {
    if (!tour) return;
    const tempsMs = performance.now() - tour.debut;
    const { situation, conseils } = tour;
    tour = null;
    try {
      partie.jouer(hero, action);
    } catch (e) {
      tour = { situation, conseils, debut: performance.now() - tempsMs };
      zoneActions.prepend(el('p', { class: 'erreur' }, e.message));
      return;
    }
    const verdict = evaluerDecision({ situation, action, tempsMs, conseils });
    decisions.push({ ...verdict, numeroMain: partie.etat().numeroMain, situation, action, conseils });
    afficherRetour(verdict, conseils, action);
    zoneActions.replaceChildren();
    dessinerTable();
    dessinerBilan();
    await faireJouerLesBots();
  }

  function finDeMain() {
    const e = partie.etat(hero);
    const net = e.resultat.net[e.joueurs[hero].nom] ?? 0;
    mains.push({ numero: e.numeroMain, netBb: net / e.grosseBlinde });
    dessinerTable();
    dessinerBilan();
    const fini = partie.partieFinie() || e.joueurs[hero].elimine;
    const resume = e.resultat.abattage
      ? Object.entries(e.resultat.mainsMontrees).map(([nom, m]) => `${nom} : ${m.description}`).join(' · ')
      : `${e.resultat.gagnants.join(', ')} remporte le pot sans abattage.`;
    zoneActions.replaceChildren(
      ...[
      el('p', { class: `resultat-main ${net > 0 ? 'positif' : net < 0 ? 'negatif' : ''}` }, `Main ${e.numeroMain} : ${signe(net)} jetons (${signe(net / e.grosseBlinde)} bb). ${resume}`),
      fini
        ? el('p', { class: 'aide' }, e.joueurs[hero].elimine ? 'Tu es éliminé.' : 'Tu as gagné la partie !')
        : bouton('Main suivante', () => nouvelleMain(), 'bouton'),
      fini ? bouton('Nouvelle partie', lancer, 'bouton') : null,
      ].filter(Boolean),
    );
    if (fini) finDePartie();
  }

  function finDePartie() {
    dessinerBilan(true);
  }

  /* ---------------- Dessin ---------------- */

  function dessinerTable(dernierCoup) {
    const e = partie.etat(hero);
    const sieges = e.joueurs.map((j) => {
      const cartes = j.cartes ? j.cartes.map(visuelCarte) : j.elimine || j.couche || !e.numeroMain ? [] : [dosDeCarte(), dosDeCarte()];
      const etatJoueur = j.elimine ? 'Éliminé' : j.couche ? 'Couché' : j.aTapis ? 'Tapis' : '';
      const profil = j.type === 'bot' ? PROFILS.find((p) => p.id === j.profil) : null;
      return el(
        'div',
        { class: `siege${j.index === e.aQui ? ' parle' : ''}${j.couche || j.elimine ? ' eteint' : ''}${j.index === hero ? ' moi' : ''}` },
        el(
          'div',
          { class: 'siege-tete' },
          el('strong', {}, j.nom),
          j.position ? el('span', { class: 'puce' }, j.index === e.bouton ? 'D' : j.position) : null,
          profil ? el('span', { class: `puce risque-${profil.risque}` }, profil.nom) : null,
        ),
        el('div', { class: 'siege-cartes' }, cartes),
        el('div', { class: 'siege-pied' }, el('span', { class: 'jetons' }, String(j.tapis)), j.mise > 0 ? el('span', { class: 'mise' }, `mise ${j.mise}`) : null, etatJoueur ? el('span', { class: 'etat' }, etatJoueur) : null),
      );
    });
    const centre = el(
      'div',
      { class: 'centre' },
      el('p', { class: 'etiquette' }, `Main ${e.numeroMain} · niveau ${e.niveau} · ${e.petiteBlinde}/${e.grosseBlinde}${e.mainsAvantNiveau ? ` · blindes en hausse dans ${e.mainsAvantNiveau} main${e.mainsAvantNiveau > 1 ? 's' : ''}` : ''}`),
      el('div', { class: 'tableau-cartes' }, e.tableau.map(visuelCarte), Array.from({ length: 5 - e.tableau.length }, () => el('span', { class: 'carte vide' }))),
      el('p', { class: 'pot' }, `Pot ${e.pot}`),
      dernierCoup ? el('p', { class: 'aide' }, `${dernierCoup.nom} : ${dernierCoup.decision.titre}`) : null,
    );
    zoneTable.replaceChildren(el('div', { class: 'sieges' }, sieges), centre);
  }

  function dessinerActions() {
    const a = partie.actionsPossibles(hero);
    const s = tour.situation;
    const bb = s.grosseBlinde;
    const boutons = [];
    if (a.couche) boutons.push(bouton('Se coucher', () => jouer({ type: 'couche' }), 'action couche'));
    if (a.parole) boutons.push(bouton('Checker', () => jouer({ type: 'parole' }), 'action'));
    if (a.suit) boutons.push(bouton(a.aSuivre >= s.tapis ? `Suivre à tapis ${a.aSuivre}` : `Suivre ${a.aSuivre}`, () => jouer({ type: 'suit' }), 'action'));
    const bornes = a.mise ?? a.relance;
    let ligneMontant = null;
    if (bornes && bornes.max > bornes.min) {
      const champ = el('input', { type: 'number', id: 'ent-montant', min: String(bornes.min), max: String(bornes.max), step: '1', value: String(bornes.min), inputmode: 'numeric' });
      const verbe = a.mise ? 'Miser' : 'Relancer à';
      const valider = bouton(`${verbe} ${bornes.min}`, () => jouer({ type: a.mise ? 'mise' : 'relance', montant: Number(champ.value) }), 'action attaque');
      champ.addEventListener('input', () => (valider.textContent = `${verbe} ${champ.value}`));
      const fixer = (x) => {
        champ.value = String(Math.min(bornes.max, Math.max(bornes.min, Math.round(x))));
        valider.textContent = `${verbe} ${champ.value}`;
      };
      const pot = s.pot;
      const raccourcis = a.mise
        ? [['½ pot', pot / 2], ['¾ pot', (pot * 3) / 4], ['Pot', pot]]
        : s.tableau.length === 0
          ? [['2,5 bb', 2.5 * bb], ['3 bb', 3 * bb], ['×3', s.miseActuelle * 3]]
          : [['×2,5', s.miseActuelle * 2.5], ['×3', s.miseActuelle * 3], ['Pot', s.miseActuelle + pot + a.aSuivre]];
      ligneMontant = el(
        'div',
        { class: 'ligne' },
        el('label', { class: 'champ etroit' }, `Montant (${bornes.min} à ${bornes.max})`, champ),
        el('div', { class: 'pastilles' }, raccourcis.map(([t, x]) => bouton(t, () => fixer(x)))),
        valider,
      );
    }
    boutons.push(bouton(`Tapis ${a.tapis}`, () => jouer({ type: 'tapis' }), 'action tapis'));
    const coach = $('ent-coach').checked
      ? el(
          'div',
          { class: 'coach' },
          el('p', { class: 'etiquette' }, 'Le coach (les 4 bots, avant que tu joues)'),
          tour.conseils.map((c) => el('p', {}, el('strong', {}, `${c.nomProfil} : `), c.titre)),
        )
      : null;
    zoneActions.replaceChildren(
      ...[
      el('p', { class: 'a-toi' }, 'À toi de jouer', el('span', { class: 'chrono', id: 'ent-chrono-vue' }, '')),
      el('div', { class: 'ligne' }, boutons),
      ligneMontant,
      coach,
      ].filter(Boolean),
    );
  }

  function afficherRetour(v, conseils, action) {
    const libelleAction = { couche: 'Se coucher', parole: 'Checker', suit: 'Suivre', mise: `Miser ${action.montant}`, relance: `Relancer à ${action.montant}`, tapis: 'Tapis' }[action.type];
    zoneRetour.replaceChildren(
      el(
        'div',
        { class: 'retour' },
        el('p', { class: 'etiquette' }, `Ta décision · ${RUES[v.rue] ?? v.rue} · ${court(v.tempsMs / 1000)} s`),
        el('p', { class: `mot-petit ${TON_VERDICT[v.verdict]}` }, `${LIBELLES_VERDICTS[v.verdict]} : ${libelleAction}`),
        v.raisons.length ? el('ul', { class: 'raisons' }, v.raisons.map((r) => el('li', {}, r))) : null,
        el(
          'div',
          { class: 'quatre' },
          conseils.map((c) =>
            el(
              'details',
              { class: `avis${v.accords[c.profil] ? ' accord' : ''}` },
              el('summary', {}, el('strong', {}, c.nomProfil), ` ${c.titre}`),
              el('ul', { class: 'raisons' }, c.raisons.map((r) => el('li', {}, r))),
            ),
          ),
        ),
      ),
    );
  }

  function dessinerBilan(final = false) {
    if (!decisions.length && !mains.length) {
      zoneBilan.replaceChildren(el('p', { class: 'aide' }, 'Le bilan de ta séance s’affiche ici dès ta première décision : score de discipline, temps de décision, style, tilt.'));
      return;
    }
    const b = bilanEntrainement(decisions, mains);
    const blocs = [
      el('p', { class: 'etiquette' }, final ? 'Bilan de la partie' : 'Bilan de la séance'),
      chiffres([
        ['Discipline', b.score === null ? '—' : `${b.score} / 100`, b.score >= 75 ? 'bon' : b.score < 50 ? 'mauvais' : null],
        ['Résultat', `${signe(b.resultatBb)} bb`, b.resultatBb >= 0 ? 'bon' : 'mauvais'],
        ['Décisions', String(b.decisions)],
        ['Temps médian', Number.isFinite(b.temps.median) ? `${court(b.temps.median / 1000)} s` : '—'],
      ]),
      el(
        'p',
        { class: 'aide' },
        `${b.compte.bon} bonnes · ${b.compte.style} de style · ${b.compte.erreur} erreurs · ${b.compte.nimportequoi} n’importe quoi · ${b.temps.eclairs} décisions éclair (< 2 s), ${b.temps.longues} hésitations (> 20 s).`,
      ),
    ];
    if (b.style.length && b.decisions >= 3) {
      blocs.push(
        el('p', { class: 'etiquette' }, 'Ton jeu ressemble à'),
        el(
          'div',
          { class: 'repartition' },
          b.style.map((x) =>
            el('div', { class: 'barre' }, el('span', {}, PROFILS.find((p) => p.id === x.profil).nom), el('div', {}, el('span', { style: `width: ${(x.accord * 100).toFixed(0)}%` })), el('output', {}, pct(x.accord, 0))),
          ),
        ),
      );
    }
    if (b.alertes.length) {
      blocs.push(
        el(
          'ul',
          { class: 'fuites' },
          b.alertes.map((a) => el('li', {}, el('span', { class: `gravite ${a.gravite}` }, a.gravite === 'forte' ? 'Forte' : 'À surveiller'), el('strong', {}, a.titre), el('p', {}, a.detail))),
        ),
      );
    }
    const fautes = decisions.filter((d) => d.verdict === 'erreur' || d.verdict === 'nimportequoi').slice(-6).reverse();
    if (fautes.length) {
      blocs.push(
        el('p', { class: 'etiquette' }, 'Tes dernières fautes'),
        el('ul', { class: 'raisons' }, fautes.map((d) => el('li', {}, `Main ${d.numeroMain}, ${RUES[d.rue] ?? d.rue} (${court(d.tempsMs / 1000)} s) : ${d.raisons[0]}`))),
      );
    }
    if (partie && mains.length) {
      blocs.push(bouton('Analyser ces mains en détail', () => envoyerVersAnalyse(partie.historique(), partie.etat().joueurs[hero].nom), 'bouton-secondaire'));
    }
    zoneBilan.replaceChildren(...blocs);
  }

  // Le chronomètre de ta décision, dans la barre d'actions.
  setInterval(() => {
    const vue = document.getElementById('ent-chrono-vue');
    if (vue && tour) vue.textContent = `${court((performance.now() - tour.debut) / 1000)} s`;
  }, 200);

  reglages.hidden = false;
  dessinerBilan();
}

function bouton(texte, action, classe = 'bouton-secondaire') {
  const b = el('button', { type: 'button', class: classe }, texte);
  b.addEventListener('click', action);
  return b;
}
