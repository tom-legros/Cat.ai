// node outils/actualiser-catalogue.js : instantané des familles locales officielles.
// Ollama ne publie pas d'API de recherche stable : la source reste la bibliothèque HTML.
const fs = require('node:fs');
const path = require('node:path');

function lireBibliotheque(html) {
  const modeles = new Map();
  for (const [, nom, bloc] of html.matchAll(/<a\s+href="\/library\/([\w.-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const labels = [...bloc.matchAll(/<span\b[^>]*>\s*([\w.]+)\s*<\/span>/g)].map(m => m[1]);
    // Une famille exclusivement cloud n'est pas un téléchargement gratuit local.
    if (labels.includes('embedding') || /embed|guard|shield|audio|rerank/i.test(nom) || (labels.includes('cloud') && !labels.some(l => /^e?\d+(\.\d+)?[bm]$/.test(l)))) continue;
    modeles.set(nom, { modele: nom + ':latest', nom, fournisseur: 'ollama',
      usages: ['general', ...(/cod(e|er)|codestral|starcoder/i.test(nom) ? ['code'] : []),
        ...(labels.includes('vision') ? ['images'] : []), ...(labels.includes('thinking') ? ['reflexion'] : [])],
      outils: labels.includes('tools'), raison: labels.includes('tools') ? 'Discussion et outils' : 'Discussion · outils non annoncés',
      variantes: labels.filter(l => /^e?\d+(\.\d+)?[bm]$/.test(l)) });
  }
  return [...modeles.values()];
}

async function main() {
  const html = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8')
    : await (await fetch('https://ollama.com/library', { signal: AbortSignal.timeout(15000) })).text();
  const modeles = lireBibliotheque(html);
  if (modeles.length < 50) throw new Error('Format du catalogue inattendu : instantané conservé.');
  fs.writeFileSync(path.join(__dirname, '../principal/catalogue-ollama.json'), JSON.stringify(modeles, null, 2) + '\n');
  console.log(`${modeles.length} familles locales enregistrées.`);
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { lireBibliotheque };
