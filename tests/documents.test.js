// Documents glissés (PDF, longs textes) : rangement, texte joint au message, lecture et recherche par l'outil
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEBUT_JOINT, lireTexteDocument, texteJointDocument, lireDocument, chercherDansTexte, idValide } = require('../principal/documents');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'catai-docs-'));

test('lireTexteDocument : un long fichier texte est rangé, et seul son début part avec le message', async () => {
  const d = temp();
  const source = path.join(d, 'cours.md');
  fs.writeFileSync(source, Array.from({ length: 2000 }, (_, i) => `Ligne ${i + 1} du cours`).join('\n'));
  const doc = await lireTexteDocument(source, path.join(d, 'documents'));
  assert.ok(idValide(doc.document));
  assert.equal(doc.entier, false);
  assert.equal(doc.debut.length, DEBUT_JOINT);
  assert.ok(fs.existsSync(path.join(d, 'documents', `${doc.document}.txt`)));
  const joint = texteJointDocument(doc);
  assert.match(joint, /utilise lire_document avec document = « [a-f0-9]{16} »/);
});

test('lireTexteDocument : refuse ce qui n est ni un PDF ni du texte', async () => {
  const d = temp();
  const source = path.join(d, 'diapo.pptx');
  fs.writeFileSync(source, 'x');
  assert.match((await lireTexteDocument(source, d)).erreur, /pas un PDF ni un fichier texte/);
});

test('lireTexteDocument : un faux PDF donne une erreur claire, sans planter', async () => {
  const d = temp();
  const source = path.join(d, 'abime.pdf');
  fs.writeFileSync(source, 'ceci n est pas un pdf');
  assert.match((await lireTexteDocument(source, d)).erreur, /n'a pas pu être lu/);
});

test('texteJointDocument : un court document part en entier', () => {
  assert.match(texteJointDocument({ nom: 'a.pdf', document: '0123456789abcdef', pages: 2, caracteres: 50, debut: 'bonjour', entier: true }), /\(2 pages\), son texte complet est ici/);
});

test('lireDocument : lit par morceaux, cherche, et refuse un identifiant qui pourrait sortir du dossier', () => {
  const d = temp();
  fs.writeFileSync(path.join(d, '0123456789abcdef.txt'), '[page 1]\nLes volcans\n\n[page 2]\nLe chiffre secret est 4729.');
  assert.match(lireDocument(d, { document: '0123456789abcdef', texte: 'CHIFFRE secret' }), /ligne 5 \(page 2\) : Le chiffre secret est 4729\./);
  assert.match(lireDocument(d, { document: '0123456789abcdef', ligne: 4 }), /\[page 2\]/);
  assert.match(lireDocument(d, { document: '../../secret' }), /Identifiant de document inconnu/);
  assert.match(lireDocument(d, { document: 'ffffffffffffffff' }), /plus disponible/);
});

test('chercherDansTexte : sans tenir compte des accents ni des majuscules', () => {
  assert.match(chercherDansTexte('La photosynthèse\nautre', 'PHOTOSYNTHESE'), /ligne 1 : La photosynthèse/);
  assert.match(chercherDansTexte('rien', 'volcan'), /Aucun passage/);
});

test('lireDocument : la suite d un long document se lit avec lire_document et son identifiant', () => {
  const d = temp();
  fs.writeFileSync(path.join(d, '0123456789abcdef.txt'), Array.from({ length: 500 }, (_, i) => `Ligne ${i + 1} du cours de SVT`).join('\n'));
  const morceau = lireDocument(d, { document: '0123456789abcdef', ligne: 1 }, 2000);
  assert.match(morceau, /^\(document 0123456789abcdef : lignes 1 à \d+ sur 500\. Pour la suite : lire_document avec document = « 0123456789abcdef » et ligne = \d+\.\)/);
  assert.doesNotMatch(morceau, /lire_fichier/);
  assert.match(lireDocument(d, { document: '0123456789abcdef', texte: 'ligne 42 ' }), /lire_document avec document = « 0123456789abcdef » et ligne\./);
});

test('lireTexteDocument : un long fichier texte sans extension connue est lu, un binaire est refusé', async () => {
  const d = temp();
  const source = path.join(d, 'Composant.tsx');
  fs.writeFileSync(source, 'export const A = () => null;\n'.repeat(5000));
  assert.ok(idValide((await lireTexteDocument(source, path.join(d, 'documents'))).document));
  const binaire = path.join(d, 'donnees.bin');
  fs.writeFileSync(binaire, Buffer.from([1, 0, 2, 0, 3]));
  assert.match((await lireTexteDocument(binaire, d)).erreur, /pas un fichier texte/);
});

// Un vrai petit PDF, écrit à la main : une page avec une ligne de texte
function petitPdf(texte) {
  const flux = `BT /F1 12 Tf 72 720 Td (${texte}) Tj ET`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const positions = objets.map((o, i) => { const p = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

test('lireTexteDocument : un vrai PDF est lu, avec le repère de page', async () => {
  const d = temp();
  const source = path.join(d, 'cours.pdf');
  fs.writeFileSync(source, petitPdf('La photosynthese produit du dioxygene grace a la lumiere.'));
  const doc = await lireTexteDocument(source, path.join(d, 'documents'));
  assert.equal(doc.erreur, undefined, doc.erreur);
  assert.equal(doc.pages, 1);
  assert.match(doc.debut, /^\[page 1\]\nLa photosynthese produit du dioxygene/);
});
