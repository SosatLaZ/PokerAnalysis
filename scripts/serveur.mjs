// Sert la page en local : node scripts/serveur.mjs [port]  →  http://localhost:8080
//
// index.html est écrit sans <!doctype>, <head> ni <body> (c'est le format des
// pages publiées en Artifact, que l'hébergeur enveloppe) : ce serveur ajoute
// la même enveloppe. Les modules ES ne se chargent pas depuis file://, d'où
// ce serveur.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
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
    const relatif = chemin === '/' ? 'index.html' : chemin.replace(/^\/+/, '');
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
}).listen(port, () => console.log(`Table de décision : http://localhost:${port}`));
