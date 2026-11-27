#!/usr/bin/env node
// Banc d'essai des agents (docs/conception-agents.md) : lance le vrai chantier sur les petits projets de
// tests/agents/, puis note le résultat avec des tests cachés que l'équipe n'a jamais vus.
//
//   node outils/banc-agents.cjs                     le modèle local choisi dans l'app (sinon qwen3.5:9b)
//   node outils/banc-agents.cjs qwen3.5:4b          un autre modèle pour toute l'équipe
//   node outils/banc-agents.cjs qwen3.5:9b calcul   un seul projet
//   node outils/banc-agents.cjs qwen3.5:9b seul     l'agent seul (principal/mission.js) au lieu de l'équipe
//
// Chaque projet est copié dans un dépôt git temporaire ; le chantier travaille dans sa copie habituelle (une branche
// à part), avec l'équipe par défaut de la page Agents (chef, codeur, testeur, relecteur), toute sur Ollama. Seul ce
// que le chantier a validé (ses commits) est noté. Tout est effacé à la fin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const racine = path.join(__dirname, '..');
const DOSSIER_BANC = path.join(racine, 'tests', 'agents');
const DOSSIER_NOTE = 'banc-cache';
const git = (dossier, ...args) => execFileSync('git', args, { cwd: dossier, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const projetsDuBanc = (dossier = DOSSIER_BANC) => fs.readdirSync(dossier, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(dossier, e.name, 'plan.md'))).map((e) => e.name).sort();

// Le projet de départ dans un dépôt git neuf, avec un premier commit (le chantier en a besoin)
function preparerDepot(source, cible) {
  fs.cpSync(source, cible, { recursive: true });
  git(cible, 'init', '-q');
  git(cible, 'add', '-A');
  git(cible, '-c', 'user.name=Banc', '-c', 'user.email=banc@cat-ai.invalid', 'commit', '-qm', 'départ');
}

// Les tests cachés, lancés dans le dossier donné, puis retirés. Renvoie { reussis, total }.
function noter(dossier, dossierCache) {
  const cible = path.join(dossier, DOSSIER_NOTE);
  fs.rmSync(cible, { recursive: true, force: true });
  fs.cpSync(dossierCache, cible, { recursive: true });
  try {
    // Sans NODE_TEST_CONTEXT : lancé depuis un test, l'enfant croirait être un sous-test et n'écrirait pas son bilan
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `${DOSSIER_NOTE}/*.test.js`], { cwd: dossier, encoding: 'utf8', env, timeout: 60_000 });
    const nombre = (cle) => Number((r.stdout || '').match(new RegExp(`^# ${cle} (\\d+)`, 'm'))?.[1] || 0);
    return { reussis: nombre('pass'), total: nombre('pass') + nombre('fail') + nombre('cancelled') };
  } finally {
    fs.rmSync(cible, { recursive: true, force: true });
  }
}

async function unProjet(nom, modele, { dire = () => {}, mode = 'equipe' } = {}) {
  const { configurerStockage } = require(path.join(racine, 'principal/stockage'));
  const { infosFournisseur } = require(path.join(racine, 'principal/fournisseurs'));
  const { envoyerOllama } = require(path.join(racine, 'principal/envoi'));
  const { LIMITES_OLLAMA } = require(path.join(racine, 'principal/taille'));
  const { agentsDuChantier } = require(path.join(racine, 'principal/lancement'));
  const { lancerChantier, jeterChantier } = require(path.join(racine, 'principal/chantier'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `catai-banc-${nom}-`));
  const projet = path.join(tmp, 'projet');
  configurerStockage({ dossier: path.join(tmp, 'donnees') });
  preparerDepot(path.join(DOSSIER_BANC, nom, 'projet'), projet);
  const plan = fs.readFileSync(path.join(DOSSIER_BANC, nom, 'plan.md'), 'utf8');
  const debut = Date.now();
  const journal = [];
  let resultat = { nom, modele, etapesFaites: 0, etapes: 0, essais: 0, reussis: 0, total: 0, secondes: 0, erreur: '' };
  let nomChantier = null;
  let nomMission = null;
  try {
    if (mode === 'seul') {
      // L'agent seul : une mission, sans chef ni relecteur, avec le même modèle
      const { lancerMission } = require(path.join(racine, 'principal/mission'));
      const r = await lancerMission({
        projet, demande: plan, modele, limites: LIMITES_OLLAMA, dossierCopies: path.join(tmp, 'copies'), signal: AbortSignal.timeout(20 * 60_000),
        envoyer: (messages, m, morceau, signal, options) => envoyerOllama(messages, m, morceau, signal, { ...options, chantier: true }),
        ev: { info: (t) => { journal.push(t); dire(t); }, essai: (i, n) => dire(`essai ${i}/${n}`) },
      });
      nomMission = r.nom;
      const note = noter(r.copie, path.join(DOSSIER_BANC, nom, 'cache'));
      resultat = { ...resultat, etapesFaites: r.ok ? 1 : 0, etapes: 1, essais: r.essais, ...note };
    } else {
    // L'équipe par défaut de la page Agents, toute sur ce modèle local
    const { chef, codeurs } = agentsDuChantier({
      reglages: { actif: 'ollama', modeles: { ollama: modele }, fournisseurs: {} }, infos: infosFournisseur,
      envoyerLocal: envoyerOllama, limitesLocales: LIMITES_OLLAMA, dire: (t) => journal.push(t),
    });
    const r = await lancerChantier({
      projet, plan, chef, codeurs, dossierCopies: path.join(tmp, 'copies'), signal: AbortSignal.timeout(20 * 60_000),
      ev: { info: (t) => { journal.push(t); dire(t); }, etape: (i, n, titre) => dire(`étape ${i}/${n} : ${titre}`) },
    });
    nomChantier = r.branche.replace('catai/chantier-', '');
    const note = noter(r.copie, path.join(DOSSIER_BANC, nom, 'cache'));
    resultat = { ...resultat, etapesFaites: r.etapes.filter((e) => e.ok).length, etapes: r.plan.length, essais: r.etapes.reduce((t, e) => t + (e.essais || 0), 0), ...note };
    }
  } catch (err) {
    resultat.erreur = String(err.message || err).split('\n')[0].slice(0, 200);
    // Rien de validé : on note le projet de départ, pour savoir ce que les tests cachés en disent
    Object.assign(resultat, noter(projet, path.join(DOSSIER_BANC, nom, 'cache')), { reussis: 0 });
  } finally {
    resultat.secondes = Math.round((Date.now() - debut) / 1000);
    try { if (nomChantier) jeterChantier(projet, nomChantier); } catch { /* le dossier temporaire part de toute façon */ }
    try { if (nomMission) require(path.join(racine, 'principal/copie-agent')).jeterCopie(projet, nomMission); } catch { /* idem */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  resultat.journal = journal;
  resultat.mode = mode;
  return resultat;
}

function tableau(resultats) {
  const lignes = ['| Projet | Modèle | Étapes faites | Essais | Tests cachés | Temps |', '|---|---|---|---|---|---|'];
  for (const r of resultats) {
    lignes.push(`| ${r.nom} | ${r.modele} | ${r.etapesFaites}/${r.etapes}${r.erreur ? ` (${r.erreur.slice(0, 60)})` : ''} | ${r.essais} | ${r.reussis}/${r.total} | ${r.secondes} s |`);
  }
  const reussis = resultats.reduce((t, r) => t + r.reussis, 0);
  const total = resultats.reduce((t, r) => t + r.total, 0);
  const projetsReussis = resultats.filter((r) => r.total && r.reussis === r.total).length;
  lignes.push('', `**${projetsReussis}/${resultats.length} projets entièrement réussis, ${reussis}/${total} tests cachés.**`);
  return lignes.join('\n');
}

async function principal() {
  const args = process.argv.slice(2);
  const mode = args.includes('seul') ? 'seul' : 'equipe';
  const [modeleDemande, unSeul] = args.filter((a) => a !== 'seul' && a !== 'equipe');
  const modele = modeleDemande || 'qwen3.5:9b';
  const projets = projetsDuBanc().filter((p) => !unSeul || p === unSeul);
  process.stdout.write(`Mode : ${mode === 'seul' ? 'agent seul' : 'équipe'}\n`);
  const resultats = [];
  for (const nom of projets) {
    process.stdout.write(`\n== ${nom} (${modele})\n`);
    const r = await unProjet(nom, modele, { mode, dire: (t) => process.stdout.write(`  ${t}\n`) });
    process.stdout.write(`   → ${r.reussis}/${r.total} tests cachés, ${r.etapesFaites}/${r.etapes} étapes, ${r.secondes} s${r.erreur ? ` — ${r.erreur}` : ''}\n`);
    resultats.push(r);
  }
  process.stdout.write(`\n${tableau(resultats)}\n`);
  const sortie = path.join(os.tmpdir(), `catai-banc-${Date.now()}.json`);
  fs.writeFileSync(sortie, JSON.stringify(resultats, null, 2));
  process.stdout.write(`\nDétail (journal de chaque chantier) : ${sortie}\n`);
}

if (require.main === module) principal().catch((err) => { process.stderr.write(`${err.stack || err}\n`); process.exit(1); });

module.exports = { projetsDuBanc, preparerDepot, noter, tableau, DOSSIER_BANC };
