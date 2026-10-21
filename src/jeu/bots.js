// Fait jouer les bots à la table : situation vue de leur siège → décision de
// leur profil → action du moteur.

import { deciderBot } from '../strategie/bot.js';

/** Traduit une décision du bot en action légale du moteur. */
export function versActionMoteur(decision, possibles) {
  switch (decision.action) {
    case 'couche':
      return possibles.couche ? { type: 'couche' } : { type: 'parole' };
    case 'parole':
      return possibles.parole ? { type: 'parole' } : { type: 'couche' };
    case 'suit':
      return possibles.suit ? { type: 'suit' } : { type: 'parole' };
    case 'tapis':
      return { type: 'tapis' };
    case 'mise':
    case 'relance': {
      const bornes = possibles.mise ?? possibles.relance;
      if (!bornes) return possibles.suit ? { type: 'suit' } : { type: 'parole' };
      const montant = Math.min(bornes.max, Math.max(bornes.min, Math.round(decision.montant)));
      if (montant >= bornes.max) return { type: 'tapis' };
      return { type: possibles.mise ? 'mise' : 'relance', montant };
    }
    default:
      throw new Error(`Décision inconnue : « ${decision.action} »`);
  }
}

/**
 * Joue le prochain tour d'un bot, s'il y en a un à parler.
 * Retourne { index, nom, decision, action } ou null si c'est à un humain (ou si la main est finie).
 */
export function jouerUnBot(partie, { iterations = 2500, aleatoire } = {}) {
  const i = partie.aQui();
  if (i < 0) return null;
  const joueur = partie.joueur(i);
  if (joueur.type !== 'bot') return null;
  const situation = partie.situationPour(i);
  const decision = deciderBot(situation, joueur.profil ?? 'solide', { iterations, aleatoire });
  const action = versActionMoteur(decision, partie.actionsPossibles(i));
  partie.jouer(i, action);
  return { index: i, nom: joueur.nom, decision, action };
}

/** Fait jouer tous les bots jusqu'au prochain humain ou à la fin de la main. */
export function jouerLesBots(partie, options = {}) {
  const coups = [];
  for (let garde = 0; garde < 500; garde++) {
    const coup = jouerUnBot(partie, options);
    if (!coup) return coups;
    coups.push(coup);
  }
  throw new Error('Les bots tournent en rond : plus de 500 actions dans une main.');
}
