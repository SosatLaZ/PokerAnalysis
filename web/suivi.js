// L'onglet Suivi : ta base de mains, comme un tracker. Import sans doublon,
// courbe de gains et d'all-in EV, résultats par jour, limite et position,
// filtres, rejeu coup par coup, et les stats de chaque adversaire.

import { lireHistorique } from '../src/analyse/historique.js';
import { analyserSession } from '../src/analyse/detection.js';
import { fusionnerMains, texteDeLaBase } from '../src/analyse/base.js';
import { resumeMain, courbeGains, regrouper, filtrerMains, etapesDeMain } from '../src/analyse/suivi.js';
import { pct, court, signe, montant } from '../src/moteur/format.js';
import { $, el, visuelCarte, chiffres } from './ui.js';

const RUES = { preflop: 'Préflop', flop: 'Flop', turn: 'Tournant', river: 'Rivière' };

/* ---------------- Le stockage : sur ton disque (npm run web) ou dans ce navigateur ---------------- */

function stockageServeur() {
  return {
    lieu: 'sur ton ordinateur (dossier data/)',
    async lire() {
      const r = await fetch('api/mains');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()).texte;
    },
    async ajouter(texte) {
      const r = await fetch('api/mains', { method: 'POST', body: texte });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    async vider() {
      const r = await fetch('api/mains', { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
  };
}

function stockageNavigateur() {
  const ouvrir = () =>
    new Promise((ok, ko) => {
      const req = indexedDB.open('table-de-decision', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('mains');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => ko(req.error ?? new Error('IndexedDB indisponible'));
    });
  const lireBase = async () => {
    const db = await ouvrir();
    return new Promise((ok, ko) => {
      const r = db.transaction('mains').objectStore('mains').get('base');
      r.onsuccess = () => ok(r.result ?? {});
      r.onerror = () => ko(r.error);
    });
  };
  const ecrireBase = async (base) => {
    const db = await ouvrir();
    return new Promise((ok, ko) => {
      const t = db.transaction('mains', 'readwrite');
      t.objectStore('mains').put(base, 'base');
      t.oncomplete = () => ok();
      t.onerror = () => ko(t.error);
    });
  };
  return {
    lieu: 'dans ce navigateur seulement (efface les données du site, et elles partent)',
    async lire() {
      return texteDeLaBase(await lireBase());
    },
    async ajouter(texte) {
      const r = fusionnerMains(await lireBase(), texte);
      await ecrireBase(r.base);
      return r;
    },
    async vider() {
      await ecrireBase({});
    },
  };
}

async function choisirStockage() {
  try {
    const r = await fetch('api/mains');
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return stockageServeur();
  } catch {
    // Pas de serveur local : on passe au navigateur, juste dessous.
  }
  return stockageNavigateur();
}

/* ---------------- L'onglet ---------------- */

export function brancherSuivi() {
  const zoneResume = $('suivi-resume');
  const zoneMains = $('suivi-mains');
  const zoneRejeu = $('suivi-rejeu');
  const message = $('suivi-message');
  let stockage = null;
  let mains = [];
  let lignes = [];
  let parId = new Map();

  const dire = (texte, classe = 'aide') => {
    message.className = classe;
    message.textContent = texte;
  };

  async function demarrer() {
    stockage = await choisirStockage();
    $('suivi-lieu').textContent = `Ta base est gardée ${stockage.lieu}.`;
    await recharger();
  }

  async function recharger() {
    try {
      const texte = await stockage.lire();
      const lu = lireHistorique(texte);
      mains = lu.mains.sort((a, b) => (a.horodatage ?? 0) - (b.horodatage ?? 0));
      parId = new Map(mains.map((m) => [m.id, m]));
      dessiner();
    } catch (e) {
      dire(`Lecture de la base impossible : ${e.message}`, 'erreur');
    }
  }

  async function ajouter(texte, origine) {
    if (!texte.trim()) return dire('Rien à importer : colle des mains ou choisis un fichier.', 'erreur');
    try {
      const r = await stockage.ajouter(texte);
      const { ignorees } = lireHistorique(texte);
      dire(
        `${origine} : ${r.ajoutees} main${r.ajoutees > 1 ? 's' : ''} ajoutée${r.ajoutees > 1 ? 's' : ''}, ${r.doublons} déjà dans la base. ${r.total} mains en tout.${ignorees.length ? ` ${ignorees.length} illisible(s) : ${ignorees[0].erreur}.` : ''}`,
      );
      await recharger();
    } catch (e) {
      dire(`Import impossible : ${e.message}`, 'erreur');
    }
  }

  $('suivi-importer').addEventListener('click', () => {
    ajouter($('suivi-texte').value, 'Import');
    $('suivi-texte').value = '';
  });
  $('suivi-fichiers').addEventListener('change', async (ev) => {
    for (const f of ev.target.files ?? []) ajouter(await f.text(), f.name);
    ev.target.value = '';
  });
  $('suivi-exemple').addEventListener('click', async () => {
    const r = await fetch('exemples/spin-rush-exemple.txt');
    if (r.ok) ajouter(await r.text(), 'Exemple Spin & Rush');
    else dire(`Exemple indisponible (HTTP ${r.status}).`, 'erreur');
  });
  const vider = $('suivi-vider');
  let confirmation = false;
  vider.addEventListener('click', async () => {
    if (!confirmation) {
      confirmation = true;
      vider.textContent = 'Confirmer : tout effacer';
      setTimeout(() => {
        confirmation = false;
        vider.textContent = 'Vider la base';
      }, 4000);
      return;
    }
    confirmation = false;
    vider.textContent = 'Vider la base';
    await stockage.vider();
    dire('Base vidée.');
    await recharger();
  });
  for (const id of ['suivi-f-position', 'suivi-f-range', 'suivi-f-resultat', 'suivi-f-tapis', 'suivi-f-abattage', 'suivi-f-rue', 'suivi-f-pot', 'suivi-f-adversaire']) {
    $(id).addEventListener('input', () => dessinerMains());
  }

  /* ---------------- Dessin ---------------- */

  function dessiner() {
    if (!mains.length) {
      zoneResume.replaceChildren(el('p', { class: 'aide' }, 'Ta base est vide. Importe l’historique de tes parties (téléchargé depuis l’app Betclic, ou les parties de l’onglet Entraînement), ou ajoute l’exemple pour voir à quoi ça ressemble.'));
      zoneMains.replaceChildren();
      zoneRejeu.replaceChildren();
      return;
    }
    const rapport = analyserSession(mains, { iterations: 1500 });
    const hero = rapport.hero;
    lignes = mains.filter((m) => m.hero === hero).map((m) => resumeMain(m, hero));
    const chances = new Map((rapport.tapis?.mains ?? []).map((t) => [t.id, t.chance]));
    const courbe = courbeGains(lignes, chances);
    const s = rapport.stats;
    const fin = courbe.at(-1);

    // Les adversaires du filtre.
    const choixAdv = $('suivi-f-adversaire');
    const valeur = choixAdv.value;
    choixAdv.replaceChildren(el('option', { value: '' }, 'Tous'), ...[...new Set(lignes.flatMap((l) => l.adversaires))].sort().map((n) => el('option', { value: n, selected: n === valeur ? true : null }, n)));

    zoneResume.replaceChildren(
      el('p', { class: 'etiquette' }, `${hero} · ${lignes.length} mains`),
      chiffres([
        ['Résultat', signe(fin.cumul), fin.cumul >= 0 ? 'bon' : 'mauvais'],
        ['All-in EV', signe(fin.ev), fin.ev >= 0 ? 'bon' : 'mauvais'],
        ['bb / 100', Number.isFinite(s.bb100) ? signe(s.bb100) : '—', s.bb100 >= 0 ? 'bon' : 'mauvais'],
        ['VPIP / PFR', `${pct(s.vpip, 0)} / ${pct(s.pfr, 0)}`],
        ['Agression', Number.isFinite(s.af) ? court(s.af) : '—'],
        ['Abattage / gagné', `${pct(s.wtsd, 0)} / ${pct(s.wsd, 0)}`],
      ]),
      graphique(courbe),
      el('p', { class: 'aide' }, `Trait plein : tes gains réels. Pointillés : l’all-in EV, ce que tu aurais gagné si chaque tapis montré s’était joué à ton équité. L’écart (${signe(fin.cumul - fin.ev)}) est ta chance sur la période.`),
      tableauGroupes('Par jour', regrouper(lignes, 'jour')),
      tableauGroupes('Par limite', regrouper(lignes, 'limite')),
      tableauGroupes('Par position', regrouper(lignes.filter((l) => l.position), 'position')),
      tableauAdversaires(rapport.adversaires?.adversaires ?? []),
    );
    dessinerMains();
  }

  function filtreCourant() {
    return {
      position: $('suivi-f-position').value || null,
      range: $('suivi-f-range').value,
      resultat: $('suivi-f-resultat').value || null,
      tapis: $('suivi-f-tapis').checked,
      abattage: $('suivi-f-abattage').checked,
      rueMin: $('suivi-f-rue').value || null,
      potMinBb: Number($('suivi-f-pot').value) || 0,
      adversaire: $('suivi-f-adversaire').value || null,
    };
  }

  function dessinerMains() {
    if (!lignes.length) return;
    let choisies;
    try {
      choisies = filtrerMains(lignes, filtreCourant());
      $('suivi-f-erreur').textContent = '';
    } catch (e) {
      $('suivi-f-erreur').textContent = e.message;
      return;
    }
    const total = choisies.reduce((t, l) => t + l.net, 0);
    const affichees = [...choisies].reverse().slice(0, 300);
    zoneMains.replaceChildren(
      el('p', { class: 'aide' }, `${choisies.length} main${choisies.length > 1 ? 's' : ''} · ${signe(total)}${choisies.length > 300 ? ' · les 300 plus récentes affichées' : ''}. Touche une main pour la rejouer.`),
      el(
        'div',
        { class: 'tableau-defile' },
        el(
          'table',
          {},
          el('thead', {}, el('tr', {}, ['Date', 'Limite', 'Pos.', 'Main', 'Tableau', 'Pot', 'Résultat'].map((h, i) => el('th', { class: i >= 5 ? 'n' : null }, h)))),
          el(
            'tbody',
            {},
            affichees.map((l) => {
              const tr = el(
                'tr',
                { class: 'cliquable', tabindex: '0' },
                el('td', {}, l.date || '—'),
                el('td', {}, l.limite),
                el('td', {}, l.position ?? '—'),
                el('td', {}, l.cartes ? enLigne(l.cartes) : '—'),
                el('td', {}, l.tableau.length ? enLigne(l.tableau) : '—'),
                el('td', { class: 'n' }, montant(l.pot)),
                el('td', { class: `n ${l.net > 0 ? 'positif' : l.net < 0 ? 'negatif' : ''}` }, signe(l.net)),
              );
              const ouvrir = () => rejouer(parId.get(l.id));
              tr.addEventListener('click', ouvrir);
              tr.addEventListener('keydown', (e) => e.key === 'Enter' && ouvrir());
              return tr;
            }),
          ),
        ),
      ),
    );
  }

  function rejouer(main) {
    if (!main) return;
    const etapes = etapesDeMain(main);
    let k = 0;
    const dessin = el('div', { class: 'groupe' });
    const precedent = el('button', { type: 'button', class: 'bouton-secondaire' }, '← Précédent');
    const suivant = el('button', { type: 'button', class: 'bouton' }, 'Suivant →');
    const montrer = () => {
      const e = etapes[k];
      const joueurs = main.joueurs.map((j) => {
        const cartes = j.nom === main.hero ? main.cartesHero : e.fin ? main.montrees?.[j.nom] : null;
        return el(
          'div',
          { class: `siege${e.joueur === j.nom ? ' parle' : ''}${e.couches.includes(j.nom) ? ' eteint' : ''}${j.nom === main.hero ? ' moi' : ''}` },
          el('div', { class: 'siege-tete' }, el('strong', {}, j.nom)),
          el('div', { class: 'siege-cartes' }, cartes ? cartes.map(visuelCarte) : []),
          el('div', { class: 'siege-pied' }, el('span', { class: 'jetons' }, montant(e.tapis[j.nom] ?? j.tapis)), e.mises[j.nom] ? el('span', { class: 'mise' }, `mise ${montant(e.mises[j.nom])}`) : null),
        );
      });
      dessin.replaceChildren(
        el('p', { class: 'etiquette' }, `Main #${main.id} · ${RUES[e.rue] ?? e.rue} · étape ${k + 1}/${etapes.length}`),
        el('div', { class: 'sieges' }, joueurs),
        el('div', { class: 'tableau-cartes' }, e.tableau.map(visuelCarte)),
        el('p', { class: 'pot' }, `Pot ${montant(e.pot)}`),
        el('p', { class: e.estHero ? 'a-toi' : 'resultat-main' }, e.texte),
      );
      precedent.disabled = k === 0;
      suivant.disabled = k === etapes.length - 1;
    };
    precedent.addEventListener('click', () => {
      k = Math.max(0, k - 1);
      montrer();
    });
    suivant.addEventListener('click', () => {
      k = Math.min(etapes.length - 1, k + 1);
      montrer();
    });
    zoneRejeu.replaceChildren(el('p', { class: 'etiquette' }, 'Rejeu'), dessin, el('div', { class: 'ligne' }, precedent, suivant));
    montrer();
    zoneRejeu.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  demarrer();
}

function enLigne(cartes) {
  return el('span', { class: 'carte-texte' }, cartes.map((c) => {
    const v = visuelCarte(c);
    return el('span', { class: v.className.replace('carte ', '') }, v.textContent);
  }));
}

function tableauGroupes(titre, groupes) {
  if (!groupes.length) return null;
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
        el('thead', {}, el('tr', {}, ['', 'Mains', 'Résultat', 'bb/100', 'VPIP', 'PFR', 'Gagnées'].map((h, i) => el('th', { class: i ? 'n' : null }, h)))),
        el(
          'tbody',
          {},
          groupes.map((g) =>
            el(
              'tr',
              {},
              el('td', {}, g.cle ?? '—'),
              el('td', { class: 'n' }, String(g.mains)),
              el('td', { class: `n ${g.net >= 0 ? 'positif' : 'negatif'}` }, signe(g.net)),
              el('td', { class: 'n' }, Number.isFinite(g.bb100) ? signe(g.bb100) : '—'),
              el('td', { class: 'n' }, pct(g.vpip, 0)),
              el('td', { class: 'n' }, pct(g.pfr, 0)),
              el('td', { class: 'n' }, pct(g.gagnees / g.mains, 0)),
            ),
          ),
        ),
      ),
    ),
  );
}

function tableauAdversaires(adversaires) {
  if (!adversaires.length) return null;
  return el(
    'div',
    { class: 'groupe' },
    el('p', { class: 'etiquette' }, 'Tes adversaires (stats calculées après coup, comme un HUD hors table)'),
    el(
      'div',
      { class: 'tableau-defile' },
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, ['Joueur', 'Mains', 'VPIP', 'PFR', 'AF', 'Abattage', 'Contre toi', 'Type'].map((h, i) => el('th', { class: i && i < 7 ? 'n' : null }, h)))),
        el(
          'tbody',
          {},
          adversaires.map((a) =>
            el(
              'tr',
              {},
              el('td', {}, a.nom),
              el('td', { class: 'n' }, String(a.mains)),
              el('td', { class: 'n' }, pct(a.vpip, 0)),
              el('td', { class: 'n' }, pct(a.pfr, 0)),
              el('td', { class: 'n' }, Number.isFinite(a.af) ? court(a.af) : '—'),
              el('td', { class: 'n' }, pct(a.wtsd, 0)),
              el('td', { class: `n ${(a.contreToi?.resultat ?? 0) >= 0 ? 'positif' : 'negatif'}` }, signe(a.contreToi?.resultat ?? 0)),
              el('td', { title: a.type?.conseil ?? '' }, a.type?.nom ?? 'Pas assez de mains'),
            ),
          ),
        ),
      ),
    ),
  );
}

/** La courbe en SVG : gains réels (plein) et all-in EV (pointillés). */
function graphique(courbe) {
  const L = 640;
  const H = 220;
  const marge = { g: 56, d: 12, h: 12, b: 28 };
  const valeurs = courbe.flatMap((p) => [p.cumul, p.ev]).concat(0);
  let min = Math.min(...valeurs);
  let max = Math.max(...valeurs);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (i) => marge.g + ((i - 1) / Math.max(1, courbe.length - 1)) * (L - marge.g - marge.d);
  const y = (v) => marge.h + ((max - v) / (max - min)) * (H - marge.h - marge.b);
  const chemin = (cle) => courbe.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p[cle]).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${L} ${H}`);
  svg.setAttribute('class', 'courbe');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Courbe de gains sur ${courbe.length} mains : ${signe(courbe.at(-1).cumul)}, all-in EV ${signe(courbe.at(-1).ev)}`);
  const ajouter = (nom, attrs, texte) => {
    const n = document.createElementNS(ns, nom);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (texte !== undefined) n.textContent = texte;
    svg.append(n);
  };
  for (const v of [min, 0, max]) {
    ajouter('line', { x1: marge.g, x2: L - marge.d, y1: y(v), y2: y(v), class: v === 0 ? 'axe-zero' : 'grille' });
    ajouter('text', { x: marge.g - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'graduation' }, signe(v));
  }
  ajouter('text', { x: marge.g, y: H - 8, class: 'graduation' }, 'main 1');
  ajouter('text', { x: L - marge.d, y: H - 8, 'text-anchor': 'end', class: 'graduation' }, `main ${courbe.length}`);
  ajouter('path', { d: chemin('ev'), class: 'ligne-ev', fill: 'none' });
  ajouter('path', { d: chemin('cumul'), class: 'ligne-gains', fill: 'none' });
  const dernier = courbe.at(-1);
  ajouter('circle', { cx: x(dernier.i), cy: y(dernier.cumul), r: 4, class: 'point-gains' });
  return el('div', { class: 'cadre-courbe' }, svg);
}
