// Sert la page en local : node scripts/serveur.mjs [port]  →  http://localhost:8080
//
// index.html est écrit sans <!doctype>, <head> ni <body> (c'est le format des
// pages publiées en Artifact, que l'hébergeur enveloppe) : ce serveur ajoute
// la même enveloppe. Les modules ES ne se chargent pas depuis file://, d'où
// ce serveur.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fusionnerMains, texteDeLaBase } from '../src/analyse/base.js';

const racine = fileURLToPath(new URL('..', import.meta.url));
// La base de mains vit sur ton disque, dans data/ (jamais versionnée).
const FICHIER_BASE = join(racine, 'data', 'base-mains.json');

async function lireBase() {
  try {
    return JSON.parse(await readFile(FICHIER_BASE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Base de mains illisible (${FICHIER_BASE}) : ${e.message}`);
  }
}

async function ecrireBase(base) {
  await mkdir(join(racine, 'data'), { recursive: true });
  await writeFile(FICHIER_BASE, JSON.stringify(base));
}

function lireCorps(req) {
  return new Promise((ok, ko) => {
    let corps = '';
    req.setEncoding('utf8');
    req.on('data', (morceau) => {
      corps += morceau;
      if (corps.length > 200 * 1024 * 1024) ko(new Error('Fichier trop gros (200 Mo au plus).'));
    });
    req.on('end', () => ok(corps));
    req.on('error', ko);
  });
}

/** /api/mains : GET la base, POST un historique à ajouter, DELETE pour tout vider. */
async function api(req, res) {
  const json = (code, objet) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(objet));
  };
  if (req.method === 'GET') {
    const base = await lireBase();
    return json(200, { texte: texteDeLaBase(base), total: Object.keys(base).length });
  }
  if (req.method === 'POST') {
    const r = fusionnerMains(await lireBase(), await lireCorps(req));
    await ecrireBase(r.base);
    return json(200, { ajoutees: r.ajoutees, doublons: r.doublons, total: r.total });
  }
  if (req.method === 'DELETE') {
    await ecrireBase({});
    return json(200, { total: 0 });
  }
  return json(405, { erreur: 'Méthode non prise en charge' });
}
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const ENVELOPPE_DEBUT = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>[hidden]{display:none!important} body{margin:0} img{max-width:100%}</style>
</head>
<body>
`;
const ENVELOPPE_FIN = '\n</body>\n</html>\n';

createServer(async (req, res) => {
  try {
    const chemin = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (chemin === '/api/mains') return await api(req, res);
    const relatif = chemin === '/' ? 'index.html' : chemin.replace(/^\/+/, '');
    if (relatif.startsWith('data/')) {
      res.writeHead(403).end('Interdit');
      return;
    }
    const complet = normalize(join(racine, relatif));
    if (!complet.startsWith(normalize(racine + sep)) && complet !== normalize(racine)) {
      res.writeHead(403).end('Interdit');
      return;
    }
    let contenu = await readFile(complet);
    if (relatif === 'index.html') contenu = ENVELOPPE_DEBUT + contenu.toString('utf8') + ENVELOPPE_FIN;
    res.writeHead(200, { 'Content-Type': TYPES[extname(complet)] ?? 'application/octet-stream' });
    res.end(contenu);
  } catch (e) {
    const introuvable = e.code === 'ENOENT' || e.code === 'EISDIR';
    res.writeHead(introuvable ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(introuvable ? 'Introuvable' : `Erreur : ${e.message}`);
    if (!introuvable) console.error(e);
  }
}).listen(port, '127.0.0.1', () => console.log(`Table de décision : http://localhost:${port}`));
