// Le connecteur ne parle qu'à un serveur Streamable HTTP choisi sur le PC.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

function adresseMcp(valeur) {
  if (typeof valeur !== 'string' || valeur.length > 500) return null;
  try {
    const url = new URL(valeur.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || !url.port || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

async function avecConnecteur(adresse, signal, action) {
  const url = adresseMcp(adresse);
  if (!url) throw new Error('Configure une adresse MCP locale dans Réglages.');
  const delai = AbortSignal.timeout(20_000);
  const annulation = signal ? AbortSignal.any([signal, delai]) : delai;
  const client = new Client({ name: 'Cat Ai', version: '1' });
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: (cible, options) => {
      if (new URL(cible).href !== url.href) throw new Error('Adresse du connecteur refusée.');
      // La fermeture de session (DELETE) part après une annulation ou un délai dépassé : avec le signal déjà
      // avorté elle échouait, et le serveur gardait la session ouverte. Elle a son propre délai court.
      const signaux = options?.method === 'DELETE' ? [AbortSignal.timeout(3000)] : [annulation, ...(options?.signal ? [options.signal] : [])];
      return fetch(cible, { ...options, redirect: 'error', signal: AbortSignal.any(signaux) });
    },
  });
  const options = { signal: annulation, timeout: 20_000 };
  try {
    await client.connect(transport, options);
    const { tools } = await client.listTools(undefined, options);
    const disponibles = tools.filter(t => t.annotations?.readOnlyHint === true && t.annotations.destructiveHint !== true).slice(0, 30);
    return await action(disponibles, (name, args) => client.callTool({ name, arguments: args }, undefined, options));
  } finally {
    try { await transport.terminateSession(); } catch { /* Certains serveurs ne gèrent pas la fermeture de session. */ }
    await client.close();
  }
}

module.exports = { adresseMcp, avecConnecteur };
