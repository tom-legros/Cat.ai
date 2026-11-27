// La file des tâches de fond (docs/conception-agents.md, « Dans l'app : la page Tâches ») : on ajoute des tâches, elles
// passent une par une, chacune dans sa copie git : par l'agent seul (mode « seul », le défaut) ou par l'équipe
// du chantier (mode « equipe » : chef, codeurs, relecteur, pour les gros travaux). La file est enregistrée : au redémarrage, une
// tâche qui était en cours devient « interrompue » (on peut la relancer).
//
// Rien ici ne connaît Electron : main.js donne de quoi lire et écrire la file, exécuter une tâche et prévenir.
//   executer(tache, { signal, activite, etapes }) -> { statut, rapport, bilan, copie: { nom, base }, fichiers, ajouts, retraits, tests }

const STATUTS_FINIS = new Set(['réussie', 'réussie, à vérifier', 'en partie', 'ratée', 'arrêtée', 'interrompue', 'gardée', 'jetée']);
const MAX_TACHES = 100;
// Une tâche ne tourne jamais sans fin : au-delà, elle est arrêtée (une nuit entière n'y passe pas sur une seule tâche,
// la suivante peut partir). L'équipe a plus de temps : elle fait plusieurs étapes.
const DUREE_MAX = { seul: 45 * 60 * 1000, equipe: 120 * 60 * 1000 };
const enMinutes = (ms) => Math.round(ms / 60000);
const propre = (texte, max) => String(texte || '').trim().slice(0, max);
const TAILLE_JOURNAL = 8;
const ETATS_ETAPE = new Set(['à faire', 'en cours', 'faite', 'à vérifier', 'ratée']);
const etapesPropres = (liste) => (Array.isArray(liste) ? liste : []).slice(0, 20)
  .map((e) => ({ titre: propre(e?.titre, 160), etat: ETATS_ETAPE.has(e?.etat) ? e.etat : 'à faire' }));

function creerFileTaches({ lire = () => [], ecrire = () => {}, executer, prevenir = () => {}, maintenant = Date.now, idSuivant, dureeMax = (t) => DUREE_MAX[t.mode] || DUREE_MAX.seul }) {
  let compteur = 0;
  const nouvelId = idSuivant || (() => `t${maintenant().toString(36)}${(compteur++).toString(36)}`);
  // Au démarrage : ce qui tournait au moment de la fermeture ne tourne plus
  let taches = (Array.isArray(lire()) ? lire() : []).map((t) => (t.statut === 'en cours' ? { ...t, statut: 'interrompue', activite: '' } : t));
  let enCours = null; // { id, arret }
  let boucleActive = false;

  const enregistrer = () => { ecrire(taches); prevenir(lister()); };
  const lister = () => taches.map((t) => ({ ...t }));
  const trouver = (id) => taches.find((t) => t.id === id);
  const changer = (id, changement) => {
    taches = taches.map((t) => (t.id === id ? { ...t, ...changement } : t));
    enregistrer();
  };

  async function boucle() {
    if (boucleActive) return;
    boucleActive = true;
    try {
      for (;;) {
        const tache = taches.find((t) => t.statut === 'en attente');
        if (!tache) break;
        const arret = new AbortController();
        enCours = { id: tache.id, arret };
        changer(tache.id, { statut: 'en cours', debut: maintenant(), activite: 'prépare la copie du projet' });
        let depassee = false;
        const limite = dureeMax(tache);
        const minuterie = setTimeout(() => { depassee = true; arret.abort(); }, limite);
        const tropLongue = () => `Arrêtée au bout de ${enMinutes(limite)} min : la tâche était trop longue. Découpe-la en tâches plus petites.`;
        try {
          // L'activité en direct, et un journal des dernières actions dans l'ordre (sans doublon d'affilée)
          const activite = (texte) => {
            const t = propre(texte, 160);
            const journal = trouver(tache.id)?.journal || [];
            changer(tache.id, { activite: t, journal: t && journal.at(-1) !== t ? [...journal, t].slice(-TAILLE_JOURNAL) : journal });
          };
          // Les étapes du plan, cochées au fur et à mesure : [{ titre, etat: 'à faire' | 'en cours' | 'faite' | 'ratée' }]
          const etapes = (liste) => changer(tache.id, { etapes: etapesPropres(liste) });
          const r = await executer(trouver(tache.id), { signal: arret.signal, activite, etapes });
          changer(tache.id, {
            // Arrêtée avec du travail dans sa copie : « en partie », pour pouvoir le voir, le garder ou le jeter
            statut: arret.signal.aborted ? (r.copie && r.fichiers ? 'en partie' : 'arrêtée') : r.statut, fin: maintenant(), activite: '', ...(depassee ? { erreur: tropLongue() } : {}),
            rapport: propre(r.rapport, 6000), bilan: propre(r.bilan, 1500), aVerifier: propre(r.aVerifier, 600),
            ...(r.etapes ? { etapes: etapesPropres(r.etapes) } : {}),
            copie: r.copie || null, fichiers: r.fichiers ?? 0, ajouts: r.ajouts ?? 0, retraits: r.retraits ?? 0, tests: r.tests || '',
          });
        } catch (err) {
          changer(tache.id, { statut: arret.signal.aborted ? 'arrêtée' : 'ratée', fin: maintenant(), activite: '', erreur: depassee ? tropLongue() : propre(err.message || err, 300) });
        } finally {
          clearTimeout(minuterie);
          enCours = null;
        }
      }
    } finally {
      boucleActive = false;
    }
  }

  return {
    lister,
    get occupee() { return !!enCours; },
    ajouter({ demande, projet, fournisseurId = 'ollama', modele, mode = 'seul' }) {
      if (!propre(demande, 4000)) throw new Error('Écris ce que la tâche doit faire.');
      if (!projet) throw new Error("Ouvre d'abord le dossier du projet.");
      if (!modele) throw new Error('Choisis un modèle dans la discussion.');
      const tache = { id: nouvelId(), demande: propre(demande, 4000), projet, fournisseurId, modele, mode: mode === 'equipe' ? 'equipe' : 'seul', statut: 'en attente', ajoutee: maintenant(), activite: '' };
      // Les plus vieilles tâches finies partent quand la file est pleine
      const finies = taches.filter((t) => STATUTS_FINIS.has(t.statut));
      if (taches.length >= MAX_TACHES && finies.length) taches = taches.filter((t) => t !== finies[0]);
      taches = [...taches, tache];
      enregistrer();
      boucle();
      return { ...tache };
    },
    arreter(id) {
      const t = trouver(id);
      if (!t) return false;
      if (t.statut === 'en attente') { changer(id, { statut: 'arrêtée', fin: maintenant() }); return true; }
      if (enCours?.id === id) { enCours.arret.abort(); return true; }
      return false;
    },
    relancer(id) {
      const t = trouver(id);
      if (!t || !['ratée', 'arrêtée', 'interrompue', 'en partie'].includes(t.statut)) return false;
      changer(id, { statut: 'en attente', activite: '', journal: [], etapes: [], erreur: '', rapport: '', bilan: '', aVerifier: '', copie: null, fin: null, fichiers: 0, ajouts: 0, retraits: 0, tests: '' });
      boucle();
      return true;
    },
    // Garder ou jeter, une fois que l'utilisateur l'a fait sur la copie
    marquer(id, statut) {
      if (!trouver(id) || !['gardée', 'jetée'].includes(statut)) return false;
      changer(id, { statut });
      return true;
    },
    retirer(id) {
      const t = trouver(id);
      if (!t || t.statut === 'en cours') return false;
      taches = taches.filter((x) => x.id !== id);
      enregistrer();
      return true;
    },
    // Ce qui attendait au démarrage repart
    reprendre: () => boucle(),
    attendre: async () => { while (boucleActive) await new Promise((r) => setTimeout(r, 10)); },
  };
}

module.exports = { creerFileTaches, STATUTS_FINIS, DUREE_MAX };
