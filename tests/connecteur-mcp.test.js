const test = require('node:test');
const assert = require('node:assert/strict');
const { adresseMcp } = require('../principal/connecteur-mcp');
const chargerModule = require('./helpers/charger-module.cjs');

test('MCP : seuls les serveurs de boucle locale avec un port explicite sont autorisés', () => {
  for (const adresse of ['http://127.0.0.1:3000/mcp', 'http://[::1]:3000/mcp']) assert.ok(adresseMcp(adresse));
  for (const adresse of ['https://example.com:3000', 'http://192.168.1.1:3000', 'http://127.0.0.1',
    'http://nom:secret@127.0.0.1:3000', 'http://127.0.0.1:3000/?cle=secret', 'http://127.0.0.1:3000/#fragment',
    'file:///tmp/mcp', null, 'a'.repeat(501)]) assert.equal(adresseMcp(adresse), null, String(adresse));
});

test('MCP : catalogue filtré, redirections interdites, session fermée même en cas d’erreur', async () => {
  let transport, fermetures = 0, terminaisons = 0, requetes = 0;
  const api = chargerModule('principal/connecteur-mcp.js', {
    '@modelcontextprotocol/sdk/client/index.js': { Client: class {
      async connect(t) { transport = t; }
      async listTools() { return { tools: [
        { name: 'lecture', annotations: { readOnlyHint: true } },
        { name: 'destruction', annotations: { readOnlyHint: true, destructiveHint: true } },
        { name: 'inconnu' },
      ] }; }
      async close() { fermetures++; }
    } },
    '@modelcontextprotocol/sdk/client/streamableHttp.js': { StreamableHTTPClientTransport: class {
      constructor(url, options) { this.url = url; this.options = options; }
      async terminateSession() { terminaisons++; }
    } },
  }, { fetch: async (_url, options) => { requetes++; assert.equal(options.redirect, 'error'); return {}; } });
  await assert.rejects(api.avecConnecteur('http://127.0.0.1:3000/mcp', null, async (outils) => {
    assert.equal(outils.map(o => o.name).join(','), 'lecture');
    assert.throws(() => transport.options.fetch('http://127.0.0.1:3001/mcp', {}), /refusée/);
    await transport.options.fetch(transport.url, {});
    throw new Error('interruption du test');
  }), /interruption du test/);
  assert.equal(requetes, 1);
  assert.equal(fermetures, 1);
  assert.equal(terminaisons, 1);
});
