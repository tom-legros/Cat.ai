// Prompt brut (petites machines, Qwen 3 classique) : l'historique ne fait que s'allonger, le cache d'Ollama reste valable
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { promptBrutPossible, promptQwen, sansNotesDeSuivi, qwen3Classique } = require('../principal/prompt-brut');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('qwen3Classique : les Qwen 3 classiques seulement', () => {
  for (const m of ['qwen3:1.7b', 'qwen3:0.6b', 'qwen3:8b']) assert.equal(qwen3Classique(m), true, m);
  for (const m of ['qwen3.5:0.8b', 'qwen3.5:9b', 'qwen3.6:27b', 'qwen3-coder:30b', 'gemma4:e4b', 'llama3.2:3b', '']) assert.equal(qwen3Classique(m), false, m);
});

test('promptBrutPossible : pas avec des outils, la réflexion, une image ou un appel d outil', () => {
  const messages = [{ role: 'system', content: 'c' }, { role: 'user', content: 'q' }];
  assert.equal(promptBrutPossible({ modele: 'qwen3:1.7b', messages }), true);
  assert.equal(promptBrutPossible({ modele: 'qwen3:1.7b', messages, outils: [{}] }), false);
  assert.equal(promptBrutPossible({ modele: 'qwen3:1.7b', messages, reflexion: true }), false);
  assert.equal(promptBrutPossible({ modele: 'qwen3.5:2b', messages }), false);
  assert.equal(promptBrutPossible({ modele: 'qwen3:1.7b', messages: [...messages, { role: 'user', content: 'x', images: ['a'] }] }), false);
  assert.equal(promptBrutPossible({ modele: 'qwen3:1.7b', messages: [...messages, { role: 'tool', content: 'r' }] }), false);
});

test('promptQwen : format ChatML de Qwen 3, réflexion vide comme Ollama, consignes du début réunies', () => {
  const p = promptQwen([
    { role: 'system', content: 'Consignes' }, { role: 'system', name: 'contexte_projet', content: '' },
    { role: 'user', content: 'Combien font 2 + 2 ?' }, { role: 'assistant', content: '4.' }, { role: 'user', content: 'Et 3 + 3 ?' },
  ]);
  assert.equal(p, '<|im_start|>system\nConsignes<|im_end|>\n'
    + '<|im_start|>user\nCombien font 2 + 2 ?<|im_end|>\n'
    + '<|im_start|>assistant\n<think>\n\n</think>\n\n4.<|im_end|>\n'
    + '<|im_start|>user\nEt 3 + 3 ?<|im_end|>\n'
    + '<|im_start|>assistant\n<think>\n\n</think>\n\n');
  // Préchauffage : les consignes seules, et c'est bien le début du prompt d'un envoi
  const consignes = promptQwen([{ role: 'system', content: 'Consignes' }], { generation: false });
  assert.ok(p.startsWith(consignes));
});

test('chaque message prolonge exactement le prompt du message précédent et sa réponse (le cache reste entier)', () => {
  const debut = [{ role: 'system', content: 'Consignes' }, { role: 'user', content: 'Q1' }];
  const premier = promptQwen(debut);
  const second = promptQwen([...debut, { role: 'assistant', content: 'R1' }, { role: 'user', content: 'Q2' }]);
  assert.ok(second.startsWith(premier + 'R1'));
});

test('sansNotesDeSuivi : retire les notes qui changent à chaque message, garde le rappel du mode prof et les consignes', () => {
  const messages = [
    { role: 'system', content: 'Consignes' }, { role: 'user', content: 'Q' },
    { role: 'system', content: "Tu n'as encore utilisé aucun outil dans cette discussion. Tu n'as modifié AUCUN fichier" },
    { role: 'system', content: 'La conversation continue. Commence directement par l’explication demandée' },
    { role: 'system', content: 'Rappel : MODE PROF. Aucun bloc de code' },
  ];
  assert.deepEqual(sansNotesDeSuivi(messages).map((m) => m.content), ['Consignes', 'Q', 'Rappel : MODE PROF. Aucun bloc de code']);
  // Les notes que l'interface écrit sont bien celles-là
  const r = lire('renderer.js');
  assert.match(r, /content: `Tu n'as encore utilisé aucun outil dans cette discussion\. /);
  assert.match(r, /content: "La conversation continue\. Commence directement/);
});

test('envoi et préchauffage : même prompt brut, sur petite machine seulement', () => {
  const envoi = lire('principal/envoi.js');
  assert.match(envoi, /const brut = legere && promptBrutPossible\(\{ modele, outils: corps\.tools, reflexion, messages: corps\.messages \}\);/);
  assert.match(envoi, /prompt: promptQwen\(rappelsPourOllama\(sansNotesDeSuivi\(allegerMessages\(messages, options\)\)\)\), raw: true/);
  assert.match(envoi, /if \(typeof data\.response === 'string'\) data\.message = \{ content: data\.response \};/);
  const main = lire('main.js');
  assert.match(main, /const brut = LEGERE && promptBrutPossible\(\{ modele, outils, messages \}\);/);
  assert.match(main, /prompt: promptQwen\(messages, \{ generation: false \}\), raw: true/);
});
