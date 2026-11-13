// L'équipe du mode chantier : un arbre d'agents que l'utilisateur compose dans la page Agents.
// Que des fonctions pures, sur le contenu de fournisseurs.json : elles sont faciles à tester.
//
//   chef        en haut, un seul : il découpe le plan en étapes et les donne aux codeurs
//   codeur      il écrit le code d'une étape. Toujours un modèle du PC (Ollama) : il travaille des heures,
//               le quota gratuit d'un modèle en ligne y passerait
//   testeur     il lance les tests du projet après chaque étape (pas de modèle : c'est un programme)
//   logs        sous un testeur : quand les tests cassent, il lit leur sortie et dit au codeur quoi corriger
//   relecteur   il compare le changement à la consigne, et accepte ou refuse l'étape
//
// La place dans l'arbre compte : un testeur ou un relecteur sous le chef contrôle toutes les étapes ;
// sous un codeur, seulement les étapes de ce codeur.
const { modeleGratuit } = require('./gratuit');

const TYPES = {
  chef: { nom: 'Chef', modele: true, enfants: ['codeur', 'testeur', 'relecteur'] },
  codeur: { nom: 'Codeur', modele: true, local: true, enfants: ['testeur', 'relecteur'] },
  testeur: { nom: 'Testeur', modele: false, enfants: ['logs'], unParParent: true },
  logs: { nom: 'Lecteur de logs', modele: true, enfants: [], unParParent: true },
  relecteur: { nom: 'Relecteur', modele: true, enfants: [] },
};
const MAX_AGENTS = 12;
const propre = (texte, max) => String(texte || '').replace(/\s+/g, ' ').trim().slice(0, max);

// L'équipe de départ : un chef (en ligne s'il y a une clé Gemini), un codeur, un testeur, un relecteur
function equipeParDefaut(reglages = {}) {
  const modeles = reglages.modeles || {};
  const local = { fournisseur: 'ollama', modele: modeles.ollama || '' };
  const malin = reglages.fournisseurs?.gemini?.cleChiffree ? { fournisseur: 'gemini', modele: modeles.gemini || '' } : local;
  return { agents: [
    { id: 'chef', type: 'chef', nom: 'Chef', parent: null, ...malin },
    { id: 'codeur-1', type: 'codeur', nom: 'Codeur', parent: 'chef', specialite: '', ...local },
    { id: 'testeur-1', type: 'testeur', nom: 'Testeur', parent: 'chef' },
    { id: 'relecteur-1', type: 'relecteur', nom: 'Relecteur', parent: 'chef', ...malin },
  ] };
}

// Une équipe enregistrée n'est gardée que si elle tient debout : le fichier a pu être abîmé ou modifié à la main.
// Un chef, au moins un codeur, des parents permis, un nom partout. Avec infos(id) (le fournisseur, ou null), les
// modèles sont vérifiés aussi : un codeur sur le PC, et jamais de modèle payant, même déjà enregistré.
function equipeValide(equipe, infos) {
  const agents = Array.isArray(equipe?.agents) ? equipe.agents : [];
  if (!agents.length || agents.length > MAX_AGENTS) return false;
  if (!agents.every((a) => a && typeof a === 'object' && typeof a.id === 'string' && TYPES[a.type] && typeof a.nom === 'string' && a.nom.trim())) return false;
  const parId = new Map(agents.map((a) => [a.id, a]));
  if (parId.size !== agents.length) return false;
  if (agents.filter((a) => a.type === 'chef').length !== 1 || !agents.some((a) => a.type === 'codeur')) return false;
  return agents.every((a) => {
    const type = TYPES[a.type];
    if (type.modele) {
      if (typeof a.fournisseur !== 'string' || typeof a.modele !== 'string') return false;
      const config = infos ? infos(a.fournisseur) : undefined;
      if (infos && (!config || (type.local && config.type !== 'ollama') || (a.modele && !modeleGratuit(config, a.modele)))) return false;
    }
    if (a.type === 'chef') return a.parent === null;
    const parent = parId.get(a.parent);
    if (!parent || !TYPES[parent.type].enfants.includes(a.type)) return false;
    return !(type.unParParent && agents.some((b) => b !== a && b.parent === a.parent && b.type === a.type));
  });
}

function equipeDepuis(reglages = {}, infos) {
  return equipeValide(reglages.equipe, infos) ? reglages.equipe : equipeParDefaut(reglages);
}

const enfantsDe = (equipe, id) => equipe.agents.filter((a) => a.parent === id);

// Les types qu'on peut encore ajouter sous cet agent
function ajoutsPossibles(equipe, parentId) {
  const parent = equipe.agents.find((a) => a.id === parentId);
  if (!parent || equipe.agents.length >= MAX_AGENTS) return [];
  const dessous = enfantsDe(equipe, parentId);
  return TYPES[parent.type].enfants.filter((type) => !(TYPES[type].unParParent && dessous.some((a) => a.type === type)));
}

function ajouterAgent(equipe, parentId, type) {
  if (equipe.agents.length >= MAX_AGENTS) return { erreur: `Pas plus de ${MAX_AGENTS} agents.` };
  if (!ajoutsPossibles(equipe, parentId).includes(type)) return { erreur: 'Cet agent ne peut pas aller ici.' };
  let n = 1;
  while (equipe.agents.some((a) => a.id === `${type}-${n}`)) n++;
  const memes = equipe.agents.filter((a) => a.type === type).length;
  const agent = { id: `${type}-${n}`, type, nom: memes ? `${TYPES[type].nom} ${memes + 1}` : TYPES[type].nom, parent: parentId };
  if (TYPES[type].modele) {
    // Même réglage qu'un agent du même genre déjà là : le premier codeur pour un codeur, le chef pour les autres
    const modele = equipe.agents.find((a) => a.type === (type === 'codeur' ? 'codeur' : 'chef'));
    Object.assign(agent, { fournisseur: modele.fournisseur, modele: modele.modele });
  }
  if (type === 'codeur') agent.specialite = '';
  return { equipe: { agents: [...equipe.agents, agent] }, id: agent.id };
}

// Retire un agent et tout ce qui est sous lui
function retirerAgent(equipe, id) {
  const agent = equipe.agents.find((a) => a.id === id);
  if (!agent) return { erreur: 'Agent inconnu.' };
  if (agent.type === 'chef') return { erreur: 'Il faut un chef.' };
  const partis = new Set([id]);
  for (let avant = 0; avant !== partis.size;) {
    avant = partis.size;
    for (const a of equipe.agents) if (partis.has(a.parent)) partis.add(a.id);
  }
  const reste = equipe.agents.filter((a) => !partis.has(a.id));
  if (!reste.some((a) => a.type === 'codeur')) return { erreur: 'Il faut au moins un codeur.' };
  return { equipe: { agents: reste } };
}

// Change le nom, la spécialité ou le modèle d'un agent. infos(id) donne { type, baseUrl } du fournisseur, ou null.
function modifierAgent(equipe, id, changement, infos) {
  const agent = equipe.agents.find((a) => a.id === id);
  if (!agent) return { erreur: 'Agent inconnu.' };
  const neuf = { ...agent };
  if (changement.nom !== undefined) neuf.nom = propre(changement.nom, 30) || TYPES[agent.type].nom;
  if (changement.specialite !== undefined && agent.type === 'codeur') neuf.specialite = propre(changement.specialite, 120);
  if (changement.fournisseur !== undefined || changement.modele !== undefined) {
    if (!TYPES[agent.type].modele) return { erreur: "Cet agent n'a pas de modèle : c'est un programme." };
    const fournisseur = String(changement.fournisseur ?? agent.fournisseur ?? '');
    const modele = String(changement.modele ?? '');
    const config = infos(fournisseur);
    if (!config) return { erreur: 'Fournisseur inconnu.' };
    if (TYPES[agent.type].local && config.type !== 'ollama') return { erreur: 'Un codeur tourne sur ton PC, avec Ollama.' };
    if (!modele) return { erreur: 'Il faut choisir un modèle.' };
    // Un modèle payant n'est jamais retenu
    if (!modeleGratuit(config, modele)) return { erreur: "Ce modèle n'est pas gratuit." };
    Object.assign(neuf, { fournisseur, modele });
  }
  return { equipe: { agents: equipe.agents.map((a) => (a.id === id ? neuf : a)) } };
}

// Ce que le chantier doit faire de cet arbre : le chef, et pour chaque codeur ses contrôles dans l'ordre
// (les tests d'abord, ils ne coûtent rien ; puis les relecteurs). Ceux sous le chef valent pour tous les codeurs.
function planDeTravail(equipe) {
  const controlesSous = (id) => {
    const dessous = enfantsDe(equipe, id);
    return [
      ...dessous.filter((a) => a.type === 'testeur').map((t) => ({ type: 'tests', nom: t.nom, logs: enfantsDe(equipe, t.id).find((a) => a.type === 'logs') || null })),
      ...dessous.filter((a) => a.type === 'relecteur').map((r) => ({ type: 'relecture', nom: r.nom, agent: r })),
    ];
  };
  const chef = equipe.agents.find((a) => a.type === 'chef');
  const communs = controlesSous(chef.id);
  const ordre = (controles) => [...controles.filter((c) => c.type === 'tests'), ...controles.filter((c) => c.type === 'relecture')];
  return {
    chef,
    codeurs: equipe.agents.filter((a) => a.type === 'codeur').map((c) => ({ ...c, controles: ordre([...communs, ...controlesSous(c.id)]) })),
  };
}

module.exports = { TYPES, MAX_AGENTS, equipeParDefaut, equipeValide, equipeDepuis, ajoutsPossibles, ajouterAgent, retirerAgent, modifierAgent, planDeTravail };
