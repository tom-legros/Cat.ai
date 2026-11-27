// Réveiller l'autre PC (Wake-on-LAN) : directement à la maison, ou par une machine de la maison (SSH) loin de chez soi
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../principal/reveil');

test('MAC et machine : seulement des valeurs sûres (pas d option, pas de commande cachée)', () => {
  assert.equal(R.normaliserMac('AA-BB-CC-DD-EE-01'), 'aa:bb:cc:dd:ee:01');
  for (const faux of ['', 'aa:bb:cc', '00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff', 'aa:bb:cc:dd:ee:01; rm -rf ~', null]) assert.equal(R.normaliserMac(faux), null, String(faux));
  assert.equal(R.machineValide('moi@serveur'), 'moi@serveur');
  assert.equal(R.machineValide('serveur.exemple.ts.net'), 'serveur.exemple.ts.net');
  for (const faux of ['-oProxyCommand=calc', 'moi@-oProxyCommand=x', 'moi@serveur; reboot', 'moi@serveur $(id)', 'a b', '', null]) assert.equal(R.machineValide(faux), null, String(faux));
});

test('le paquet magique : 6 fois FF puis 16 fois la MAC (102 octets)', () => {
  const p = R.paquetMagique('aa:bb:cc:dd:ee:01');
  assert.equal(p.length, 102);
  assert.deepEqual([...p.subarray(0, 6)], [255, 255, 255, 255, 255, 255]);
  for (let i = 0; i < 16; i++) assert.deepEqual([...p.subarray(6 + i * 6, 12 + i * 6)], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x01]);
  assert.throws(() => R.paquetMagique('pas une mac'));
});

test('diffusion, même réseau, et ce que le PC qui partage donne pour être réveillé', () => {
  assert.equal(R.diffusion('192.168.1.50', '255.255.255.0'), '192.168.1.255');
  assert.equal(R.diffusion('10.133.4.7', '255.255.224.0'), '10.133.31.255');
  const maison = { Ethernet: [{ address: '192.168.1.50', netmask: '255.255.255.0', family: 'IPv4', internal: false, mac: 'AA:BB:CC:DD:EE:01' }], Tailscale: [{ address: '100.101.102.103', netmask: '255.255.255.255', family: 'IPv4', internal: false, mac: '00:00:00:00:00:00' }] };
  assert.deepEqual(R.infosReveil(maison, '192.168.1.50'), { mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255' });
  assert.equal(R.infosReveil(maison, '100.101.102.103'), null, 'pas de réveil par Tailscale');
  assert.equal(R.memeReseau({ wlan0: [{ address: '192.168.1.77', netmask: '255.255.255.0', family: 'IPv4', internal: false }] }, '192.168.1.255'), true);
  assert.equal(R.memeReseau({ wlan0: [{ address: '10.133.4.7', netmask: '255.255.224.0', family: 'IPv4', internal: false }] }, '192.168.1.255'), false);
});

test('SSH : arguments sans shell, exactement la commande du raccourci de Tom', async () => {
  assert.deepEqual(R.argumentsSsh({ machine: 'moi@serveur', mac: 'AA:BB:CC:DD:EE:01', diffusion: '192.168.1.255' }),
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'moi@serveur', 'wakeonlan', '-i', '192.168.1.255', 'aa:bb:cc:dd:ee:01']);
  assert.equal(R.argumentsSsh({ machine: '-oProxyCommand=calc', mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255' }), null);
  assert.equal(R.argumentsSsh({ machine: 'moi@serveur', mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255; id' }), null);
  // Lancement : ssh, sans shell ; un échec remonte avec le message de ssh
  const { EventEmitter } = require('node:events');
  const lances = [];
  const faux = (code, message = '') => (cmd, args, opts) => {
    lances.push({ cmd, args, opts });
    const p = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {};
    setImmediate(() => { if (message) p.stderr.emit('data', message); p.emit('close', code); });
    return p;
  };
  await R.reveillerParSsh({ machine: 'moi@serveur', mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255', lancer: faux(0) });
  assert.equal(lances[0].cmd, 'ssh');
  assert.equal(lances[0].opts.shell, undefined);
  await assert.rejects(R.reveillerParSsh({ machine: 'moi@serveur', mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255', lancer: faux(255, 'moi@serveur: Permission denied (publickey).\n') }), /Permission denied/);
});

test('réveiller : direct à la maison, par la machine de la maison ailleurs, sinon un message clair', async () => {
  const reveil = { mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255' };
  const appels = [];
  const envoyer = async (r) => appels.push(['direct', r.diffusion]);
  const parSsh = async (r) => appels.push(['ssh', r.machine]);
  const chezSoi = { wlan0: [{ address: '192.168.1.77', netmask: '255.255.255.0', family: 'IPv4', internal: false }] };
  const ailleurs = { wlan0: [{ address: '10.133.4.7', netmask: '255.255.224.0', family: 'IPv4', internal: false }] };
  assert.equal(await R.reveiller({ reveil, machine: 'moi@serveur', interfaces: chezSoi, envoyer, parSsh }), 'direct');
  assert.equal(await R.reveiller({ reveil, machine: 'moi@serveur', interfaces: ailleurs, envoyer, parSsh }), 'ssh');
  assert.deepEqual(appels, [['direct', '192.168.1.255'], ['ssh', 'moi@serveur']]);
  await assert.rejects(R.reveiller({ reveil, machine: '', interfaces: ailleurs, envoyer, parSsh }), /appareil à la maison/);
  await assert.rejects(R.reveiller({ reveil: null, machine: 'moi@serveur', interfaces: ailleurs, envoyer, parSsh }), /de quoi le réveiller/);
});

test('envoi direct : le paquet magique part en diffusion sur le port 9', async () => {
  const dgram = require('node:dgram');
  const recu = dgram.createSocket('udp4');
  await new Promise((ok) => recu.bind(0, '127.0.0.1', ok));
  const arrive = new Promise((ok) => recu.once('message', ok));
  await R.envoyerPaquet({ mac: 'aa:bb:cc:dd:ee:01', diffusion: '127.0.0.1', port: recu.address().port });
  const message = await arrive;
  recu.close();
  assert.equal(message.length, 102);
});

test('app : le PC qui partage donne sa MAC aux appareils ajoutés ; le portable ne réveille que pour un message, au plus toutes les 2 min', () => {
  const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const main = lire('main.js');
  assert.ok(main.includes('reveil: infosReveil(os.networkInterfaces(), a.maison[0])'));
  assert.ok(main.includes('if (!adresse && aReveiller) adresse = await reveillerEtAttendre();'));
  assert.ok(main.includes('Date.now() - dernierReveil < 120_000'));
  assert.ok(lire('principal/tunnel-distant.js').includes('retrouver({ reveiller: /chat/.test(chemin) })'));
  assert.match(lire('index.html'), /id="distant-reveil-par"/);
});

// La clé de Tom a une phrase de passe : Cat Ai (sans terminal) ne peut pas s'en servir. Une clé à lui, sans phrase,
// que le serveur bride à UNE commande : wakeonlan pour ce PC. Volée, elle ne sert qu'à allumer le PC.
test('clé de réveil : ssh l utilise seule ; la ligne pour le serveur ne permet que wakeonlan', async () => {
  assert.deepEqual(R.argumentsSsh({ machine: 'moi@serveur', mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255', cle: '/home/a/.config/assistant-ia/cle-reveil' }),
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-i', '/home/a/.config/assistant-ia/cle-reveil', '-o', 'IdentitiesOnly=yes', 'moi@serveur', 'wakeonlan', '-i', '192.168.1.255', 'aa:bb:cc:dd:ee:01']);
  const pub = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAbcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH cat-ai-reveil';
  assert.equal(R.ligneServeur({ clePublique: `${pub}\n`, mac: 'AA:BB:CC:DD:EE:01', diffusion: '192.168.1.255' }),
    `command="wakeonlan -i 192.168.1.255 aa:bb:cc:dd:ee:01",restrict ${pub}`);
  assert.equal(R.ligneServeur({ clePublique: 'pas une clé', mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255' }), null);
  assert.equal(R.ligneServeur({ clePublique: pub, mac: 'aa:bb:cc:dd:ee:01', diffusion: '192.168.1.255" ,x' }), null);
  // Préparer la clé : ssh-keygen sans phrase, une seule fois
  const os = require('node:os');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'catai-cle-'));
  const fichier = path.join(dossier, 'cle-reveil');
  const appels = [];
  const executer = (cmd, args, _o, cb) => { appels.push([cmd, ...args]); fs.writeFileSync(`${fichier}.pub`, `${pub}\n`); fs.writeFileSync(fichier, 'privée'); cb(null); };
  assert.equal(await R.preparerCle({ fichier, executer }), pub);
  assert.deepEqual(appels[0], ['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'cat-ai-reveil', '-f', fichier]);
  assert.equal(await R.preparerCle({ fichier, executer }), pub);
  assert.equal(appels.length, 1, 'pas de nouvelle clé si elle existe');
  fs.rmSync(dossier, { recursive: true, force: true });
});
