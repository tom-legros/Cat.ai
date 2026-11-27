const test = require('node:test');
const assert = require('node:assert/strict');
const { creerFileOllama } = require('../principal/file-ollama');

test('Ollama : une seule opération active, départ FIFO et libération idempotente', async () => {
  const file = creerFileOllama(); const ordre = [];
  const liberer = await file.prendre();
  const b = file.prendre({ onAttente: () => ordre.push('attente B') }).then(fin => { ordre.push('B'); return fin; });
  const c = file.prendre().then(fin => { ordre.push('C'); return fin; });
  await Promise.resolve(); assert.deepEqual(ordre, ['attente B']);
  liberer(); liberer(); const finB = await b;
  assert.deepEqual(ordre, ['attente B', 'B']);
  finB(); const finC = await c; finC();
  assert.equal(file.occupee, false);
});
test('Ollama : annuler une attente ne lance pas son calcul ni le suivant avant libération', async () => {
  const file = creerFileOllama(); const finA = await file.prendre(); const arret = new AbortController();
  const b = file.prendre({ signal: arret.signal });
  const refuse = assert.rejects(b, { name: 'AbortError' }); arret.abort(); await refuse;
  let demarre = false; const c = file.prendre().then(fin => { demarre = true; return fin; });
  await Promise.resolve(); assert.equal(demarre, false); finA(); (await c)();
  assert.equal(file.occupee, false);
});
test('Ollama : un signal déjà annulé ne prend pas la place disponible', async () => {
  const file = creerFileOllama(); const arret = new AbortController(); arret.abort();
  await assert.rejects(file.prendre({ signal: arret.signal }), { name: 'AbortError' });
  assert.equal(file.occupee, false);
});

test('Ollama : une notification défaillante ou annulante ne laisse pas de place fantôme', async () => {
  const file = creerFileOllama(); const fin = await file.prendre();
  const suivant = file.prendre();
  await assert.rejects(file.prendre({ onAttente() { throw Error('Fenêtre fermée'); } }), /Fenêtre fermée/);
  const arret = new AbortController();
  await assert.rejects(file.prendre({ signal: arret.signal, onAttente() { arret.abort(); throw Error('Fermeture'); } }), { name: 'AbortError' });
  fin(); (await suivant)(); assert.equal(file.occupee, false);
});
