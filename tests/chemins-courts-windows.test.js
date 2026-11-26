const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { preparerCopie } = require('../principal/copie-agent');
const { lancerChantier } = require('../principal/chantier');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Les runners Windows utilisent parfois TEMP sous sa forme courte (RUNNER~1).
// On reproduit cette situation sans changer la configuration de Windows.
function cadre(t) {
  const long = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'catai-chemin-long-'));
  t.after(() => fs.rmSync(long, { recursive: true, force: true }));
  const court = execFileSync('cmd.exe', ['/d', '/c', 'for %I in ("%CATAI_TEST_PATH%") do @echo %~fsI'], {
    env: { ...process.env, CATAI_TEST_PATH: long }, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true,
  }).trim();
  if (court.toLowerCase() === long.toLowerCase()) {
    t.skip('Les noms courts Windows 8.3 ne sont pas disponibles sur ce volume.');
    return null;
  }
  assert.equal(fs.realpathSync.native(court), fs.realpathSync.native(long));
  const projet = path.join(court, 'projet');
  fs.mkdirSync(path.join(projet, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projet, 'src', 'base.js'), '// base\n');
  git(projet, 'init', '-q');
  git(projet, 'add', '.');
  git(projet, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  return { projet, dossierCopies: path.join(court, 'copies') };
}

test('copie : un chemin Windows court conserve le bon sous-dossier isolé', { skip: process.platform !== 'win32' }, (t) => {
  const c = cadre(t); if (!c) return;
  const r = preparerCopie(path.join(c.projet, 'src'), c.dossierCopies, 'court');
  assert.equal(r.dossier, path.join(r.copie, 'src'));
  assert.equal(fs.readFileSync(path.join(r.dossier, 'base.js'), 'utf8').trim(), '// base');
});

test('chantier : un chemin Windows court permet de vérifier la copie sans toucher au projet', { skip: process.platform !== 'win32' }, async (t) => {
  const c = cadre(t); if (!c) return;
  const chef = { modele: 'faux', envoyer: async () => ({ content: '{"ok":true}', toolCalls: [] }) };
  const ouvrier = { modele: 'faux', envoyer: async (messages) => ({ content: '', toolCalls: messages.at(-1).role === 'tool' ? [] : [
    { function: { name: 'ecrire_fichier', arguments: { chemin: 'nouveau.js', contenu: '// fait\n' } } },
  ] }) };
  const r = await lancerChantier({ ...c, nom: 'court', chef, ouvrier, plan: 'Créer un fichier', etapes: [{ titre: 'Créer', consigne: 'Créer nouveau.js' }] });
  assert.equal(r.etapes[0].ok, true);
  assert.equal(fs.existsSync(path.join(r.copie, 'nouveau.js')), true);
  assert.equal(fs.existsSync(path.join(c.projet, 'nouveau.js')), false);
});
