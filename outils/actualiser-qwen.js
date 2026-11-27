// Génère l'instantané des tags officiels à partir des pages Ollama /library/<famille>/tags.
// Usage : node outils/actualiser-qwen.js <dossier des pages HTML>
const fs = require('node:fs');
const path = require('node:path');

const familles = {
  'qwen3.8': ['Code, recherche et tâches longues', 'general', 'code', 'images', 'reflexion'],
  'qwen3.8-flash-next': ['Aperçu expérimental multimodal pour le code et le raisonnement', 'code', 'images', 'reflexion'],
  'qwen3.6': ['Code avec outils et analyse d’images', 'code', 'images', 'reflexion'],
  'qwen3.5': ['Assistant polyvalent avec vision, en plusieurs tailles', 'general', 'code', 'images', 'reflexion'],
  qwen3: ['Discussion multilingue et raisonnement', 'general', 'reflexion'],
  'qwen3-next': ['Raisonnement et documents longs sur une grosse machine', 'general', 'reflexion'],
  'qwen3-coder': ['Écriture de code et travail sur de grands dépôts', 'code'],
  'qwen3-coder-next': ['Agents de développement et utilisation d’outils', 'code'],
  'qwen3-vl': ['Captures d’écran, documents et analyse visuelle', 'images', 'reflexion'],
  'qwen3-embedding': ['Recherche sémantique et indexation de documents', 'embeddings'],
  'qwen2.5': ['Discussion et rédaction multilingues', 'general'],
  'qwen2.5-coder': ['Génération, explication et correction de code', 'code'],
  'qwen2.5vl': ['Lecture de documents, graphiques et images', 'images'],
  qwen2: ['Discussion et texte multilingues, génération précédente', 'general'],
  'qwen2-math': ['Résolution de problèmes mathématiques', 'reflexion'],
  qwen: ['Qwen 1.5, ancienne génération généraliste', 'general'],
  qwq: ['Raisonnement approfondi et problèmes complexes', 'reflexion'],
  codeqwen: ['Ancienne génération spécialisée en code', 'code']
};

function lireTags(html, famille) {
  const variantes = [];
  for (const [, modele, ligne] of html.matchAll(/<a href="\/library\/([\w.-]+:[\w.-]+)" class="md:hidden[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (!modele.startsWith(famille + ':') || /(?:^|[-:])cloud(?:$|-)/i.test(modele)) continue;
    const poids = ligne.match(/•\s*([\d.]+)\s*(MB|GB|TB)\b/i);
    if (!poids) continue;
    const [, nombre, unite] = poids;
    const taille = Number(nombre) * { MB: 0.001, GB: 1, TB: 1000 }[unite.toUpperCase()];
    variantes.push({ modele, taille: Number(taille.toFixed(3)), ...(ligne.includes('>MLX<') && { mlx: true }) });
  }
  return variantes;
}

if (require.main === module) {
  const dossier = process.argv[2];
  const resultat = Object.entries(familles).map(([nom, [specialite, ...usages]]) => {
    const variantes = lireTags(fs.readFileSync(path.join(dossier, nom + '.html'), 'utf8'), nom);
    if (!variantes.length) throw Error(`Aucun tag local trouvé pour ${nom}`);
    return { nom, specialite, usages, variantes };
  });
  fs.writeFileSync(path.join(__dirname, '../principal/catalogue-qwen.json'), JSON.stringify(resultat, null, 2) + '\n');
}
module.exports = { lireTags };
