// Reproduction de la course entre validation du chemin et accord de l'utilisateur.
// Le vrai outil est exécuté ; seule l'interface de confirmation est simulée.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { executerOutil } = require('../principal/agent');
const { cheminSur } = require('../principal/fichiers');

test('une destination remplacée pendant la confirmation ne doit pas permettre une écriture hors projet', async (t) => {
  const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catai-confirmation-')));
  const projet = path.join(racine, 'projet');
  const dehors = path.join(racine, 'hors-projet');
  const destination = path.join(projet, 'sortie');
  const original = path.join(projet, 'sortie-originale');
  let jonctionCreee = false;
  // Tous les chemins sont enfants de cette racine temporaire. On retire d'abord
  // la jonction elle-même, sans parcourir sa cible, avant le nettoyage récursif.
  t.after(() => {
    if (jonctionCreee) fs.unlinkSync(destination);
    fs.rmSync(racine, { recursive: true, force: true });
  });
  fs.mkdirSync(destination, { recursive: true });
  fs.mkdirSync(dehors);
  const fichierExterieur = path.join(dehors, 'note.txt');
  fs.writeFileSync(fichierExterieur, 'contenu extérieur à préserver');
  assert.equal(cheminSur(projet, 'sortie/note.txt'), path.join(destination, 'note.txt'));

  let confirmationRecue = false;
  const ctx = {
    projet: () => projet,
    ui: {
      confirmerEcriture: async (infos) => {
        confirmationRecue = true;
        assert.equal(infos.chemin, path.join(destination, 'note.txt'));
        // Simule un autre processus qui remplace le dossier pendant que
        // l'utilisateur regarde la confirmation, puis l'utilisateur accepte.
        fs.renameSync(destination, original);
        fs.symlinkSync(dehors, destination, 'junction');
        jonctionCreee = true;
        assert.throws(() => cheminSur(projet, 'sortie/note.txt'), /en dehors du projet/);
        return true;
      },
    },
  };
  const resultat = await executerOutil('ecrire_fichier', { chemin: 'sortie/note.txt', contenu: 'écriture du modèle' }, ctx);
  assert.match(resultat, /Écriture annulée/);
  assert.equal(confirmationRecue, true);
  assert.equal(fs.readFileSync(fichierExterieur, 'utf8'), 'contenu extérieur à préserver');
});

for (const outil of ['ecrire_fichier', 'remplacer_texte']) {
  for (const scenario of ['accord', 'refus', 'projet changé', 'annulation', 'lien interne changé']) {
    test(`${outil} : ${scenario} pendant la confirmation`, async (t) => {
      const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catai-accord-')));
      const projet = path.join(racine, 'projet');
      const autreProjet = path.join(racine, 'autre-projet');
      const premier = path.join(projet, 'premier');
      const second = path.join(projet, 'second');
      for (const dossier of [premier, second, autreProjet]) {
        fs.mkdirSync(dossier, { recursive: true });
        fs.writeFileSync(path.join(dossier, 'note.txt'), 'avant');
      }
      const lien = path.join(projet, 'lien');
      t.after(() => {
        if (fs.lstatSync(lien, { throwIfNoEntry: false })) fs.unlinkSync(lien);
        fs.rmSync(racine, { recursive: true, force: true });
      });
      fs.symlinkSync(premier, lien, 'junction');
      let projetActuel = projet;
      const arret = new AbortController();
      const ctx = {
        projet: () => projetActuel,
        signal: arret.signal,
        ui: { confirmerEcriture: async ({ ancien, nouveau }) => {
          assert.equal(ancien, 'avant');
          assert.equal(nouveau, 'après');
          // Rien n'est écrit tant que l'interface n'a pas rendu son accord.
          assert.equal(fs.readFileSync(path.join(premier, 'note.txt'), 'utf8'), 'avant');
          if (scenario === 'projet changé') projetActuel = autreProjet;
          if (scenario === 'annulation') arret.abort();
          if (scenario === 'lien interne changé') {
            fs.unlinkSync(lien);
            fs.symlinkSync(second, lien, 'junction');
          }
          return scenario !== 'refus';
        } },
      };
      const resultat = await executerOutil(outil, {
        chemin: 'lien/note.txt', contenu: 'après', ancien_texte: 'avant', nouveau_texte: 'après',
      }, ctx);
      assert.match(resultat, scenario === 'accord' ? /Fichier modifié/ : scenario === 'refus' ? /refusé/ : /Écriture annulée/);
      assert.equal(fs.readFileSync(path.join(premier, 'note.txt'), 'utf8'), scenario === 'accord' ? 'après' : 'avant');
      assert.equal(fs.readFileSync(path.join(second, 'note.txt'), 'utf8'), 'avant');
      assert.equal(fs.readFileSync(path.join(autreProjet, 'note.txt'), 'utf8'), 'avant');
    });
  }
}
