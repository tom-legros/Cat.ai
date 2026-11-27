// Une seule opération du chat normal sur Ollama à la fois, préchauffage et résumé compris.
// Un calcul annulé conserve sa place jusqu'à la fermeture effective de son transport.
function creerFileOllama() {
  let active = false;
  const attente = [];
  function suivante() {
    if (active || !attente.length) return;
    const demande = attente.shift();
    demande.signal?.removeEventListener('abort', demande.annuler);
    active = true;
    let liberee = false;
    demande.resolve(() => {
      if (liberee) return;
      liberee = true;
      active = false;
      suivante();
    });
  }
  return {
    get occupee() { return active || attente.length > 0; },
    prendre({ signal, onAttente } = {}) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise((resolve, reject) => {
        const demande = { resolve, signal, annuler: () => {
          const index = attente.indexOf(demande);
          if (index < 0) return;
          attente.splice(index, 1);
          signal.removeEventListener('abort', demande.annuler);
          reject(signal.reason);
        } };
        attente.push(demande);
        signal?.addEventListener('abort', demande.annuler, { once: true });
        if (active) {
          try { onAttente?.(); } catch (err) {
            const index = attente.indexOf(demande);
            if (index >= 0) attente.splice(index, 1);
            signal?.removeEventListener('abort', demande.annuler);
            reject(err);
            return;
          }
        }
        suivante();
      });
    },
  };
}
module.exports = { creerFileOllama };
