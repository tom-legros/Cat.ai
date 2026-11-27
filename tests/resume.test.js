
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const extraire = (debut, fin) => source.slice(source.indexOf(debut), source.indexOf(fin, source.indexOf(debut)));
function cadre() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', focus() {}, showModal() {} });
    return elements.get(id);
  };
  const appels = []; let sauvegardes = 0;
  const contexte = vm.createContext({
    $: element, streaming: null, envoiEnCours: false,
    messagesEl: { scrollTop: 0, querySelectorAll: () => [] }, input: { focus() {} }, renderConv() {},
    save: () => sauvegardes++, modelSel: { value: 'simule' }, reglages: { actif: 'ollama' },
    window: { api: { summarize: async p => { appels.push(p); return 'Résumé conservant les faits.'; } } },
  });
  vm.runInContext(extraire('function ouvrirActionMessage(', '// Le texte suit la réponse') + '\n' + extraire('const LIMITE_HISTORIQUE', '// Les étiquettes de l’app'), contexte);
  return { contexte, appels, element, sauvegardes: () => sauvegardes };
}
function conversation() {
  return { resume: 'Faits des trois premiers messages.', resumeJusqua: 3,
    messages: Array.from({ length: 7 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: ('Message ' + i + '. ').repeat(i < 3 ? 500 : 2) })) };
}
for (const operation of ['modifier', 'supprimer']) {
  for (const position of [0, 2, 3, 6]) test(operation + ' à la position ' + position, async () => {
    const c = cadre(); const conv = conversation();
    c.contexte.ouvrirActionMessage(conv, conv.messages[position], operation);
    if (operation === 'modifier' && conv.messages[position].role !== 'user') {
      // L'édition est réservée aux messages de l'utilisateur : la réponse du chat n'ouvre aucun dialogue
      assert.equal(c.element('#message-dialog').onsubmit, undefined);
      assert.equal(conv.messages.length, 7); assert.equal(c.sauvegardes(), 0);
      return;
    }
    c.element('#message-dialog-texte').value = 'Texte corrigé';
    c.element('#message-dialog').onsubmit({ submitter: { value: 'valider' } });
    if (position < 3) {
      assert.equal(conv.resume, undefined); assert.equal(conv.resumeJusqua, undefined);
    } else {
      assert.equal(conv.resume, 'Faits des trois premiers messages.'); assert.equal(conv.resumeJusqua, 3);
      await c.contexte.resumerSiBesoin(conv, {});
      assert.equal(c.appels.length, 0, 'Le début inchangé ne doit pas être résumé à nouveau');
    }
    assert.equal(c.sauvegardes(), 1);
  });
}

test('édition/suppression : la validation passe par la soumission du formulaire, une seule fois (close ne part plus sous Electron 45)', () => {
  const c = cadre(); const conv = conversation();
  c.contexte.ouvrirActionMessage(conv, conv.messages[0], 'supprimer');
  // Une soumission sans le bouton valider (annulation) n'applique rien
  c.element('#message-dialog').onsubmit({ submitter: { value: '' } });
  assert.equal(conv.messages.length, 7); assert.equal(c.sauvegardes(), 0);
  // La validation par le bouton applique une seule fois, jamais deux
  c.element('#message-dialog').onsubmit({ submitter: { value: 'valider' } });
  assert.equal(conv.messages.length, 6);
  c.element('#message-dialog').onsubmit({ submitter: { value: 'valider' } });
  assert.equal(conv.messages.length, 6, 'le message déjà retiré ne doit pas l\'être une seconde fois');
  assert.equal(c.sauvegardes(), 1);
});

test('résumé : seuil, conservation, réutilisation après rechargement et extension incrémentale', async () => {
  const c = cadre(); const conv = { messages: Array.from({ length: 6 }, () => ({ role: 'user', content: 'a'.repeat(1999) })) };
  await c.contexte.resumerSiBesoin(conv, {}); assert.equal(c.appels.length, 0);
  conv.messages[0].content += '123456'; // exactement 12 000 caractères
  await c.contexte.resumerSiBesoin(conv, {});
  assert.equal(c.appels.length, 1); assert.equal(conv.resumeJusqua, 2);
  const recharge = JSON.parse(JSON.stringify(conv));
  await c.contexte.resumerSiBesoin(recharge, {}); assert.equal(c.appels.length, 1);
  recharge.messages.push({ role: 'assistant', content: 'b'.repeat(4500) });
  await c.contexte.resumerSiBesoin(recharge, {});
  assert.equal(c.appels.length, 2); assert.equal(c.appels[1].ancienResume, conv.resume);
  assert.equal(c.appels[1].messages.length, 1); assert.equal(recharge.resumeJusqua, 3);
});

test('résumé : un échec conserve le résumé précédent et les messages non résumés', async () => {
  const c = cadre(); c.contexte.window.api.summarize = async () => null;
  const conv = conversation(); for (const m of conv.messages.slice(3)) m.content = 'a'.repeat(4000);
  conv.messages.push({ role: 'user', content: 'suite' });
  const avant = JSON.stringify(conv);
  await c.contexte.resumerSiBesoin(conv, {});
  assert.equal(JSON.stringify(conv), avant); assert.equal(c.sauvegardes(), 0);
});
