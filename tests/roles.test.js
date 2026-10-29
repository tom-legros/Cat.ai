// Rôles perso : nettoyage et partage dans un fichier .catai reçu d'un ami
const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_ROLES, nettoyerRoles, roleVersFichier, roleDepuisFichier, nomFichierRole, ajouterRole } = require('../principal/roles');

const coach = { nom: 'Coach de révisions', consigne: 'Pose-moi des questions sur mon cours, une par une.' };

test('nettoyerRoles : retire les rôles incomplets, les caractères de contrôle et coupe les textes trop longs', () => {
  const roles = nettoyerRoles([coach, { nom: '', consigne: 'x' }, { nom: 'A\u0007B\nC', consigne: 'y'.repeat(2000) }, null]);
  assert.equal(roles.length, 2);
  assert.equal(roles[1].nom, 'A B C');
  assert.equal(roles[1].consigne.length, 1000);
  assert.deepEqual(nettoyerRoles('pas une liste'), []);
});

test('fichier de rôle : ce qui est exporté se réimporte à l identique', () => {
  assert.deepEqual(roleDepuisFichier(roleVersFichier(coach)), { role: coach });
});

test('fichier de rôle : un fichier enregistré avec un BOM par un éditeur Windows reste lisible', () => {
  assert.deepEqual(roleDepuisFichier('﻿' + roleVersFichier(coach)), { role: coach });
});

test('fichier de rôle : refuse ce qui n est pas un rôle Cat Ai', () => {
  assert.ok(roleDepuisFichier('pas du json').erreur);
  assert.ok(roleDepuisFichier(JSON.stringify({ nom: 'x', consigne: 'y' })).erreur); // pas de type
  assert.ok(roleDepuisFichier(JSON.stringify({ type: 'cat-ai-role', nom: '', consigne: 'y' })).erreur);
  assert.ok(roleDepuisFichier(JSON.stringify({ type: 'cat-ai-role', nom: 'x', consigne: 'y'.repeat(20000) })).erreur); // trop gros
});

test('fichier de rôle : seuls le nom et la consigne sont gardés, nettoyés', () => {
  const texte = JSON.stringify({ type: 'cat-ai-role', nom: 'Pirate', consigne: 'Parle comme un pirate.', outils: ['ecrire_fichier'], prof: false });
  assert.deepEqual(roleDepuisFichier(texte), { role: { nom: 'Pirate', consigne: 'Parle comme un pirate.' } });
});

test('nomFichierRole : nom lisible, sans caractère interdit par Windows', () => {
  assert.equal(nomFichierRole('Coach de révisions'), 'Coach de révisions.catai');
  assert.equal(nomFichierRole('Prof: maths/physique?'), 'Prof mathsphysique.catai');
  assert.equal(nomFichierRole('***'), 'Rôle.catai');
});

test('ajouterRole : ajoute un rôle nouveau', () => {
  assert.deepEqual(ajouterRole([], coach), { roles: [coach] });
});

test('ajouterRole : un rôle déjà là à l identique n est pas ajouté deux fois', () => {
  assert.deepEqual(ajouterRole([coach], { ...coach }), { deja: true });
});

test('ajouterRole : même nom, autre consigne, les deux sont gardés et le reçu est marqué', () => {
  const { roles } = ajouterRole([coach], { nom: coach.nom, consigne: 'Autre façon de réviser.' });
  assert.equal(roles.length, 2);
  assert.equal(roles[1].nom, 'Coach de révisions (reçu)');
});

test('ajouterRole : refuse au-delà du nombre maximal de rôles', () => {
  const pleins = Array.from({ length: MAX_ROLES }, (_, i) => ({ nom: `Rôle ${i}`, consigne: 'x' }));
  assert.ok(ajouterRole(pleins, coach).erreur);
});
