// Banc d'essai des agents : chaque projet est juste avant même de lancer un modèle
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projetsDuBanc, preparerDepot, noter, tableau, DOSSIER_BANC } = require('../outils/banc-agents.cjs');

test('le banc a ses projets, chacun avec un plan, un projet, des tests cachés et une solution', () => {
  const projets = projetsDuBanc();
  assert.ok(projets.length >= 4, projets.join(', '));
  for (const p of projets) for (const partie of ['plan.md', 'projet', 'cache', 'solution']) assert.ok(fs.existsSync(path.join(DOSSIER_BANC, p, partie)), `${p}/${partie}`);
});

for (const projet of projetsDuBanc()) {
  test(`${projet} : les tests cachés échouent au départ et réussissent avec la solution`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-banc-test-'));
    try {
      const depot = path.join(tmp, 'projet');
      preparerDepot(path.join(DOSSIER_BANC, projet, 'projet'), depot);
      const depart = noter(depot, path.join(DOSSIER_BANC, projet, 'cache'));
      assert.ok(depart.total > 0, 'des tests cachés');
      assert.ok(depart.reussis < depart.total, `déjà réussi au départ : ${depart.reussis}/${depart.total}`);
      fs.cpSync(path.join(DOSSIER_BANC, projet, 'solution'), depot, { recursive: true });
      const fin = noter(depot, path.join(DOSSIER_BANC, projet, 'cache'));
      assert.equal(fin.reussis, fin.total, `solution : ${fin.reussis}/${fin.total}`);
      // Les tests cachés ne restent jamais dans le projet
      assert.equal(fs.existsSync(path.join(depot, 'banc-cache')), false);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
}

test('tableau : une ligne par projet et le total', () => {
  const t = tableau([
    { nom: 'calcul', modele: 'm', etapesFaites: 2, etapes: 2, essais: 3, reussis: 3, total: 3, secondes: 40, erreur: '' },
    { nom: 'texte', modele: 'm', etapesFaites: 0, etapes: 1, essais: 3, reussis: 1, total: 2, secondes: 90, erreur: '' },
  ]);
  assert.match(t, /\| calcul \| m \| 2\/2 \| 3 \| 3\/3 \| 40 s \|/);
  assert.match(t, /\*\*1\/2 projets entièrement réussis, 4\/5 tests cachés\.\*\*/);
});
