// Documents glissés dans la discussion : PDF de cours, longs fichiers texte. Leur texte est extrait une fois,
// rangé dans le dossier de l'app (documents/), puis le modèle le lit par morceaux avec l'outil lire_document,
// comme un long fichier du projet. Seul le début part avec le message.
//
// Les fonctions qui découpent et cherchent sont pures ; lireTexteDocument touche au disque et à pdf.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MAX_FICHIER_OUTIL, extraitLignes, fichierSensible } = require('./fichiers');

const MAX_PDF = 30 * 1024 * 1024;
const MAX_PAGES = 400;
// Ce qui part avec le message : un court document en entier, sinon son début
const DEBUT_JOINT = 3000;
// Formats qu'on ne sait pas lire : documents bureautiques, archives, médias. Le reste est lu s'il contient du texte
// (un .tsx, un Dockerfile ou un LICENSE de 150 Ko passent ; un fichier avec des octets nuls est refusé).
const BINAIRES = /\.(docx?|odt|pptx?|xlsx?|ods|zip|rar|7z|exe|dll|mp3|mp4|mov|avi|mkv|wav)$/i;

// Texte d'un PDF, page par page, avec un repère « [page N] » pour que le modèle puisse citer ses sources
async function texteDuPdf(chemin, getDocument) {
  const chargement = getDocument({ data: new Uint8Array(fs.readFileSync(chemin)), isEvalSupported: false, useSystemFonts: true });
  try {
    const pdf = await chargement.promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES); i++) {
      const { items } = await (await pdf.getPage(i)).getTextContent();
      // hasEOL : fin de ligne dans le PDF ; sinon les morceaux d'une même ligne sont séparés par une espace
      const texte = items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
      pages.push(`[page ${i}]\n${texte}`);
    }
    return { texte: pages.join('\n\n'), pages: pdf.numPages, coupe: pdf.numPages > MAX_PAGES };
  } finally {
    await chargement.destroy();
  }
}

// Nom de rangement stable : le même fichier (même chemin, même date de modification) n'est extrait qu'une fois
const idDocument = (chemin, stat) => crypto.createHash('sha1').update(`${chemin}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 16);

// Extrait le texte d'un PDF ou d'un long fichier texte et le range dans `dossier`. Renvoie ce que l'interface affiche
// et joint au message : { nom, document, pages?, caracteres, debut, entier } ou { erreur }.
async function lireTexteDocument(chemin, dossier) {
  const stat = fs.statSync(chemin);
  const nom = path.basename(chemin);
  const estPdf = /\.pdf$/i.test(chemin);
  if (!estPdf && BINAIRES.test(chemin)) return { erreur: `${nom} n'est pas un PDF ni un fichier texte : je ne sais pas encore le lire. Copie son texte ici, ou enregistre-le en .txt ou en PDF.` };
  if (stat.size > (estPdf ? MAX_PDF : MAX_FICHIER_OUTIL)) return { erreur: `${nom} est trop gros (${Math.round(stat.size / 1024 / 1024)} Mo).` };
  let texte, pages, coupe;
  if (estPdf) {
    let getDocument;
    try {
      ({ getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs'));
    } catch (err) {
      console.error('Lecteur de PDF indisponible :', err);
      return { erreur: `Le lecteur de PDF de l'app n'a pas pu démarrer (${err.message}). Copie le texte du PDF ici en attendant.` };
    }
    try {
      ({ texte, pages, coupe } = await texteDuPdf(chemin, getDocument));
    } catch {
      return { erreur: `${nom} n'a pas pu être lu : le PDF est peut-être protégé par un mot de passe ou abîmé.` };
    }
    if (texte.replace(/\[page \d+\]/g, '').trim().length < 20) return { erreur: `${nom} ne contient pas de texte lisible : c'est sûrement un scan (des photos de pages). Glisse plutôt les pages en images, avec un modèle qui voit les images.` };
  } else {
    texte = fs.readFileSync(chemin, 'utf8');
    if (texte.includes('\u0000')) return { erreur: `${nom} n'est pas un fichier texte.` };
  }
  if (fichierSensible(chemin, texte)) return { erreur: 'Ce document semble contenir un secret sensible : il ne sera pas joint automatiquement.' };
  const document = idDocument(chemin, stat);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, `${document}.txt`), texte, 'utf8');
  return { nom, document, pages, coupe, caracteres: texte.length, debut: texte.slice(0, DEBUT_JOINT), entier: texte.length <= DEBUT_JOINT };
}

// Ce qui est ajouté au message pour un document joint : tout s'il est court, sinon le début et comment lire la suite
function texteJointDocument({ nom, document, pages, coupe, caracteres, debut, entier }) {
  const taille = pages ? `${pages} pages${coupe ? `, seules les ${MAX_PAGES} premières sont lues` : ''}` : `${caracteres} caractères`;
  if (entier) return `Document joint « ${nom} » (${taille}), son texte complet est ici :\n\`\`\`\n${debut}\n\`\`\``;
  return `Document joint « ${nom} » (${taille}). Voici son début ; pour lire la suite, ou y chercher un passage, utilise lire_document avec document = « ${document} » :\n\`\`\`\n${debut}\n\`\`\``;
}

// Un identifiant de document ne contient que des lettres et chiffres : rien qui puisse sortir du dossier
const idValide = (id) => /^[a-f0-9]{16}$/.test(String(id || '').trim());

// L'outil lire_document : un morceau à partir d'une ligne, ou les lignes qui contiennent un texte
function lireDocument(dossier, { document, ligne, texte }, max) {
  if (!idValide(document)) return "Identifiant de document inconnu : reprends celui écrit dans le message (16 lettres et chiffres).";
  const fichier = path.join(dossier, `${String(document).trim()}.txt`);
  if (!fs.existsSync(fichier)) return "Ce document n'est plus disponible : demande à l'utilisateur de le glisser à nouveau.";
  const contenu = fs.readFileSync(fichier, 'utf8');
  const id = String(document).trim();
  if (texte) return chercherDansTexte(contenu, String(texte)).replace('utilise lire_document avec ligne.', `utilise lire_document avec document = « ${id} » et ligne.`);
  return extraitLignes(contenu, `document ${id}`, ligne, max, (n) => `lire_document avec document = « ${id} » et ligne = ${n}`);
}

// Lignes qui contiennent un texte (sans tenir compte des majuscules ni des accents), avec leur numéro et leur page
function chercherDansTexte(contenu, texte, max = 30) {
  const simple = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cherche = simple(texte.trim());
  if (!cherche) return 'Donne le texte à chercher.';
  const resultats = [];
  let page = null;
  contenu.split('\n').forEach((l, i) => {
    const repere = l.match(/^\[page (\d+)\]$/);
    if (repere) page = repere[1];
    else if (simple(l).includes(cherche) && resultats.length < max + 1) resultats.push(`ligne ${i + 1}${page ? ` (page ${page})` : ''} : ${l.trim().slice(0, 200)}`);
  });
  if (!resultats.length) return `Aucun passage ne contient « ${texte} ». Essaie un autre mot.`;
  const trop = resultats.length > max;
  return resultats.slice(0, max).join('\n') + (trop ? '\n… et d\'autres : précise ta recherche.' : '') + '\nPour lire autour, utilise lire_document avec ligne.';
}

module.exports = { DEBUT_JOINT, BINAIRES, lireTexteDocument, texteJointDocument, lireDocument, chercherDansTexte, idValide };
