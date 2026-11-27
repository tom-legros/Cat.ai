// Exécute les tests Node d'un projet après confirmation dans le processus principal.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Les variables d'environnement passées aux commandes (le reste, dont les clés, n'est pas transmis)
const VARIABLES_UTILES = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATH', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME'];

const MAX_SORTIE = 12_000;
const DELAI = 90_000;
// Une erreur de Godot, repérée au fil de la sortie (la fin seule ne suffit pas : un import long la repousse)
const ERREUR_GODOT = /^\s*(?:SCRIPT ERROR|ERROR|Parse Error):/i;
const MAX_ERREURS = 20;

// Chaque fichier de test dans son propre processus (le mode par défaut de Node) : avec --test-isolation=none, un
// fichier qui plante au chargement (describe non importé, par exemple) était ignoré en silence, et « Tests réussis »
// laissait passer le travail d'un agent qui cassait ses propres tests.
function lancerTestsNode(dossier, signal) {
  return executer(executableNode(), ['--test', ...argumentsDuScript(dossier)], dossier, signal, true);
}

// Le Node installé sur le PC, celui avec lequel le projet est développé ; sinon celui d'Electron (en mode Node).
// Vu sur le dépôt de Cat Ai : lancés par Electron, des tests qui suppriment des dossiers temporaires échouaient
// (EPERM) alors qu'ils passent avec Node, et le travail juste du codeur était refusé.
let nodeTrouve;
function executableNode() {
  if (nodeTrouve === undefined) {
    try {
      execFileSync('node', ['--version'], { windowsHide: true, stdio: 'ignore', timeout: 5000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
      nodeTrouve = 'node';
    } catch { nodeTrouve = null; }
  }
  return nodeTrouve || process.execPath;
}

// Le script « test » du package.json, s'il est de la forme node --test <motifs> : ses motifs seulement (rien d'autre
// n'est exécuté). Sans eux, node --test lançait tout le dossier, y compris des exemples qui échouent exprès (vu sur
// le dépôt de Cat Ai : 5 877 tests au lieu de 583, et plus de 90 secondes).
function argumentsDuScript(dossier) {
  let script = '';
  try { script = String(JSON.parse(fs.readFileSync(path.join(dossier, 'package.json'), 'utf8'))?.scripts?.test || ''); } catch { return []; }
  const m = script.trim().match(/^node\s+--test((?:\s+(?:"[^"]*"|'[^']*'|[^\s"'&|;<>`$]+))*)\s*$/);
  if (!m) return [];
  const args = [...m[1].matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((a) => a[1] ?? a[2] ?? a[3]);
  // Seulement des motifs de fichiers dans le projet : pas d'option, pas de chemin qui en sort
  return args.every((a) => a && !a.startsWith('-') && !a.includes('..') && !path.isAbsolute(a)) ? args : [];
}

function verifierProjetGodot(executable, dossier, signal) {
  return executer(executable, ['--headless', '--path', dossier, '--import'], dossier, signal, false);
}

// ---------- Les tests Python, et une vérification de syntaxe quand le projet n'a pas de tests ----------
// Les noms de fichiers de test reconnus : ceux de node --test, et ceux de Python (test_x.py, x_test.py)
const TEST_NODE = /[.-]test\.[cm]?js$|(^|\/)tests?\/.*\.[cm]?js$/;
const TEST_PYTHON = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;
const IGNORES = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env', '.tox', '.pytest_cache', 'dist', 'build']);
const aDesTests = (fichiers) => fichiers.some((f) => TEST_NODE.test(f) || TEST_PYTHON.test(f));
const commandePython = () => (process.platform === 'win32' ? 'py' : 'python3');

// Les fichiers du dossier (chemins relatifs avec /), sans les dossiers de dépendances ; 5000 au plus
function fichiersDe(dossier) {
  const liste = [];
  const parcourir = (rel) => {
    if (liste.length >= 5000) return;
    let entrees = [];
    try { entrees = fs.readdirSync(path.join(dossier, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      const chemin = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!IGNORES.has(e.name)) parcourir(chemin); } else if (e.isFile()) liste.push(chemin);
    }
  };
  parcourir('');
  return liste;
}

// Un petit lanceur Python : pytest s'il est installé, sinon unittest, qui lance aussi les fonctions test_ libres
// (le style pytest, que les petits modèles écrivent souvent). Il n'écrit pas de __pycache__ dans la copie.
const LANCEUR_PYTHON = `
import sys, os, inspect, unittest, importlib.util
sys.dont_write_bytecode = True
fichiers = sys.argv[1:]
sys.path.insert(0, os.getcwd())
try:
    import pytest
except ImportError:
    pytest = None
if pytest:
    sys.exit(pytest.main(['-q', '-p', 'no:cacheprovider', *fichiers]))
suite = unittest.TestSuite()
chargeur = unittest.TestLoader()
erreurs = 0
for f in fichiers:
    dossier = os.path.dirname(os.path.abspath(f))
    if dossier not in sys.path:
        sys.path.insert(0, dossier)
    nom = os.path.splitext(os.path.basename(f))[0]
    try:
        spec = importlib.util.spec_from_file_location(nom, f)
        module = importlib.util.module_from_spec(spec)
        sys.modules[nom] = module
        spec.loader.exec_module(module)
    except Exception as e:
        erreurs += 1
        print('ERREUR au chargement de ' + f + ' : ' + type(e).__name__ + ': ' + str(e))
        continue
    suite.addTests(chargeur.loadTestsFromModule(module))
    for n, objet in list(vars(module).items()):
        if n.startswith('test') and inspect.isfunction(objet) and objet.__module__ == nom and not inspect.signature(objet).parameters:
            suite.addTest(unittest.FunctionTestCase(objet, description=f + '::' + n))
r = unittest.TextTestRunner(verbosity=2, stream=sys.stdout).run(suite)
if erreurs or not r.wasSuccessful():
    sys.exit(1)
sys.exit(0 if r.testsRun else 5)
`;

const ENV_PYTHON = { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

function lancerTestsPython(dossier, signal, fichiers) {
  return executer(commandePython(), ['-c', LANCEUR_PYTHON, ...fichiers], dossier, signal, 'python');
}

// Les tests du projet, Node et Python : un seul bilan qui commence comme celui de lancerTestsNode
// (« Tests réussis. », « Aucun test… », sinon un échec)
async function lancerTestsProjet(dossier, signal, fichiers = fichiersDe(dossier)) {
  const node = fichiers.some((f) => TEST_NODE.test(f));
  const python = fichiers.filter((f) => TEST_PYTHON.test(f));
  if (!node && !python.length) return 'Aucun test dans le projet.';
  const bilans = [];
  if (node) bilans.push(await lancerTestsNode(dossier, signal));
  if (python.length) bilans.push(await lancerTestsPython(dossier, signal, python));
  const echec = bilans.find((b) => !/^(Tests réussis|Aucun test)/.test(b));
  return echec || bilans.find((b) => b.startsWith('Tests réussis')) || bilans[0];
}

// La syntaxe des fichiers changés (Python et JavaScript) : rien n'est exécuté, seulement compilé.
// Renvoie '' si tout va bien, sinon les erreurs, fichier par fichier.
const VERIF_PYTHON = `
import sys
for f in sys.argv[1:]:
    try:
        compile(open(f, encoding='utf-8-sig').read(), f, 'exec')
    except SyntaxError as e:
        print(f + ', ligne ' + str(e.lineno) + ' : ' + str(e.msg))
    except Exception as e:
        print(f + ' : ' + str(e))
`;
async function verifierSyntaxe(dossier, fichiers, signal) {
  const presents = fichiers.filter((f) => fs.existsSync(path.join(dossier, f)));
  const erreurs = [];
  const py = presents.filter((f) => /\.py$/i.test(f));
  if (py.length) {
    const sortie = await executerBrut(commandePython(), ['-c', VERIF_PYTHON, ...py], dossier, signal, ENV_PYTHON);
    if (!sortie.erreurLancement && sortie.texte.trim()) erreurs.push(sortie.texte.trim());
  }
  for (const f of presents.filter((x) => /\.[cm]?js$/i.test(x))) {
    const sortie = await executerBrut(executableNode(), ['--check', f], dossier, signal, { ELECTRON_RUN_AS_NODE: '1' });
    if (sortie.code !== 0 && !sortie.erreurLancement) erreurs.push(`${f} :\n${sortie.texte.trim().split('\n').filter((l) => !/^\s*at |^Node\.js v/.test(l)).slice(0, 6).join('\n')}`);
  }
  return erreurs.join('\n').slice(0, 3000);
}

// Une commande courte : sa sortie et son code
function executerBrut(executable, args, dossier, signal, envSup = {}) {
  return new Promise((resolve) => {
    const env = { FORCE_COLOR: '0', ...envSup };
    for (const nom of VARIABLES_UTILES) if (process.env[nom]) env[nom] = process.env[nom];
    let texte = '';
    let fini = false;
    const enfant = spawn(executable, args, { cwd: dossier, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finir = (r) => { if (!fini) { fini = true; clearTimeout(minuteur); resolve({ texte: texte.slice(-MAX_SORTIE), ...r }); } };
    for (const flux of [enfant.stdout, enfant.stderr]) flux.setEncoding('utf8').on('data', (t) => { texte += t; });
    const minuteur = setTimeout(() => { enfant.kill('SIGKILL'); finir({ code: null }); }, 30_000);
    signal?.addEventListener('abort', () => enfant.kill('SIGKILL'), { once: true });
    enfant.once('error', () => finir({ code: null, erreurLancement: true }));
    enfant.once('close', (code) => finir({ code }));
  });
}

// genre : true (tests Node), false (Godot) ou 'python' (tests Python)
function executer(executable, argumentsCommande, dossier, signal, genre) {
  const python = genre === 'python';
  const node = genre === true || python;
  const nom = node ? 'Tests' : 'Vérification Godot';
  if (signal?.aborted) return Promise.resolve(nom + ' : annulation avant le lancement.');
  return new Promise((resolve) => {
    const environnement = { FORCE_COLOR: '0' };
    if (genre === true) environnement.ELECTRON_RUN_AS_NODE = '1';
    if (python) Object.assign(environnement, ENV_PYTHON);
    for (const nom of genre === true ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATH'] : VARIABLES_UTILES) {
      if (process.env[nom]) environnement[nom] = process.env[nom];
    }
    // Hors Windows, le processus a son propre groupe : on peut l'arrêter avec tout ce qu'il a lancé
    const enfant = spawn(executable, argumentsCommande, {
      cwd: dossier, env: environnement, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    let sortie = '';
    let arret = '';
    let ligneEnCours = '';
    const erreurs = [];
    const ajouter = (texte) => {
      sortie = (sortie + texte).slice(-MAX_SORTIE);
      if (node) return;
      const lignes = (ligneEnCours + texte).split('\n');
      ligneEnCours = lignes.pop();
      for (const l of lignes) if (ERREUR_GODOT.test(l) && erreurs.length < MAX_ERREURS) erreurs.push(l.trim().slice(0, 300));
    };
    for (const flux of [enfant.stdout, enfant.stderr]) flux.setEncoding('utf8').on('data', ajouter);
    let fini = false;
    const finir = (code) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      signal?.removeEventListener('abort', annuler);
      if (!node && ERREUR_GODOT.test(ligneEnCours) && erreurs.length < MAX_ERREURS) erreurs.push(ligneEnCours.trim().slice(0, 300));
      const aucunTest = /^(?:ℹ|#) tests 0\s*$/m.test(sortie);
      let bilan = arret;
      if (!bilan && python) bilan = code === 5 || /^Ran 0 tests/m.test(sortie) ? 'Aucun test Python trouvé.' : code !== 0 ? 'Les tests ont échoué (code ' + code + ').' : 'Tests réussis.';
      if (!bilan && node) bilan = code !== 0 ? 'Les tests ont échoué (code ' + code + ').' : aucunTest ? 'Aucun test Node trouvé.' : 'Tests réussis.';
      if (!bilan) bilan = code !== 0 || erreurs.length ? 'Godot a signalé des erreurs (code ' + code + ').' : 'Import Godot terminé.';
      const listeErreurs = erreurs.length ? '\nErreurs repérées :\n' + erreurs.join('\n') : '';
      resolve(bilan + listeErreurs + (sortie.trim() ? '\nDernières lignes de la commande :\n' + sortie.trim() : ''));
    };
    // Tuer seulement le processus lancé ne suffit pas : le lanceur console de Godot, ou un test qui lance un
    // sous-processus, laisse un petit-enfant qui garde la sortie ouverte, et 'close' n'arrivait jamais.
    const tuer = () => {
      if (process.platform === 'win32' && enfant.pid) {
        spawn('taskkill', ['/pid', String(enfant.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => enfant.kill('SIGKILL'));
      } else {
        try { process.kill(-enfant.pid, 'SIGKILL'); } catch { enfant.kill('SIGKILL'); }
      }
      setTimeout(() => finir(null), 3000).unref();
    };
    const annuler = () => { arret ||= node ? 'Tests annulés.' : 'Vérification Godot annulée.'; tuer(); };
    const minuteur = setTimeout(() => { arret ||= nom + ' : arrêt après 90 secondes.'; tuer(); }, DELAI);
    signal?.addEventListener('abort', annuler, { once: true });
    if (signal?.aborted) annuler();
    // Python absent : les tests n'ont pas pu être lancés, ce n'est pas un échec du travail
    enfant.once('error', (erreur) => { arret ||= python ? 'Aucun test lancé : Python est introuvable sur ce PC (' + erreur.message + ').' : nom + ' : lancement impossible (' + erreur.message + ').'; setTimeout(() => finir(null), 1000).unref(); });
    enfant.once('close', finir);
  });
}

module.exports = { executableNode, lancerTestsNode, lancerTestsProjet, verifierSyntaxe, aDesTests, fichiersDe, commandePython, verifierProjetGodot };
