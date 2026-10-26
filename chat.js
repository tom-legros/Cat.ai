/* ==========================================================
   Le chat noir en pixel art
   Sprite et dessin repris de mon portfolio (public/js/script.js),
   transformés en classe pour avoir plusieurs chats dans l'app :
   le grand sur l'accueil et le petit à côté de chaque réponse.
   ========================================================== */

// Sprite 20 × 19 — k : pelage, i : oreille, e : œil, n : nez, r : poitrail
const SPRITE = [
    "...k.........k......",
    "...kk.......kk......",
    "...kik.....kik......",
    "..kkikkkkkkkikk.....",
    "..kkkkkkkkkkkkk.....",
    "..kkeeekkkeeekk.....",
    "..kkeeekkkeeekk.....",
    ".kkkkkkknkkkkkkk....",
    "..kkkkkkkkkkkkk.....",
    "...kkkkkkkkkkk......",
    "....kkkkkkkkk.......",
    "...kkkkkkkkkkk......",
    "...kkkkkkkkkkk......",
    "..kkkkkkkkkkkkk.....",
    ".kkkkkkkkkkkkkkk....",
    ".kkkkkkkrkkkkkkk....",
    ".kkkkkkkrkkkkkkk....",
    ".kkkkkkkrkkkkkkk....",
    ".....kkk.kkk........"
];

// Trois positions de queue [ligne, colonne], enchaînées pour le balancement
const QUEUES = {
    A: [[17, 16], [17, 17], [16, 17], [16, 18], [15, 18], [14, 18], [13, 18], [12, 18], [11, 17]],
    B: [[17, 16], [17, 17], [16, 17], [16, 18], [15, 18], [14, 18], [13, 19], [12, 19], [11, 19]],
    C: [[17, 16], [17, 17], [16, 17], [16, 18], [15, 18], [14, 18], [13, 18], [12, 17], [11, 16]]
};

// Couleurs lues dans les variables CSS (style.css), sur body pour suivre le mode prof
function lireCouleurs() {
    const styles = getComputedStyle(document.body);
    const v = (nom) => styles.getPropertyValue(nom).trim();
    return {
        k: v("--chat-pelage"), i: v("--chat-oreille"), n: v("--chat-nez"), r: v("--chat-poitrail"),
        contour: v("--chat-contour"), ombre: v("--chat-ombre"), paupiere: v("--chat-paupiere"),
        oeil: v("--oeil"), halo: v("--oeil-halo"),
        lunettes: v("--chat-lunettes"), reflet: v("--chat-reflet")
    };
}

// Lunettes du mode prof : monture fine et ronde autour des deux yeux [ligne, colonne].
// Les coins sont laissés vides, c'est ce qui donne l'effet rond en pixel art.
const LUNETTES = [
    // haut et bas des deux verres (sans les coins)
    ...[4, 5, 6, 10, 11, 12].flatMap((c) => [[4, c], [7, c]]),
    // côtés des verres
    ...[3, 7, 9, 13].flatMap((c) => [[5, c], [6, c]]),
    // pont sur le nez
    [5, 8]
];
const REFLETS = [[5, 4], [5, 10]]; // un petit éclat blanc sur chaque verre

class ChatNoir {
    constructor(toile, { suitSouris = true } = {}) {
        this.toile = toile;
        this.pinceau = toile.getContext("2d");
        this.suitSouris = suitSouris;
        this.regard = 0;          // -1 : gauche, 0 : face, 1 : droite
        this.endormi = false;
        this.reflechit = false;   // pendant que l'IA écrit, la queue bouge sans arrêt
        this.prochainClignement = performance.now() + 1600 + Math.random() * 2000;
        this.finClignement = 0;
        this.prochaineQueue = performance.now() + 2400;
        this.debutQueue = -Infinity;
        this.sauts = [];          // intervalles [début, fin] pendant lesquels le chat est en l'air
        this.humeur = "normal";   // normal, content (yeux ^ ^), fache (yeux plissés)
        this.finHumeur = Infinity;
        this.etatDessine = "";
        ChatNoir.tous.add(this);
    }

    sauter() { this.sautiller(1); }

    // Plusieurs petits sauts d'affilée (réponse finie)
    sautiller(nombre = 2) {
        const t = performance.now();
        this.sauts = Array.from({ length: nombre }, (_, i) => [t + i * 300, t + i * 300 + 190]);
    }

    // Change d'expression, pour toujours ou pendant `duree` ms
    expression(humeur, duree = Infinity) {
        this.humeur = humeur;
        this.finHumeur = performance.now() + duree;
    }

    // S'étire au réveil (animation CSS sur le canvas)
    etirer() {
        this.toile.classList.remove("s-etire");
        void this.toile.offsetWidth;
        this.toile.classList.add("s-etire");
    }

    retirer() { ChatNoir.tous.delete(this); }

    animer(t) {
        if (!this.toile.isConnected) { this.retirer(); return; }
        if (!this.endormi) {
            if (t > this.prochainClignement) {
                this.finClignement = t + 140;
                this.prochainClignement = t + 2200 + Math.random() * 3800;
            }
            if (t > this.prochaineQueue) {
                this.debutQueue = t;
                this.prochaineQueue = t + (this.reflechit ? 700 : 3200 + Math.random() * 4200);
            }
        }
        if (t > this.finHumeur) { this.humeur = "normal"; this.finHumeur = Infinity; }
        const etat = {
            yeuxFermes: this.endormi || t < this.finClignement,
            queue: this.endormi ? "A" : "BACA"[Math.floor((t - this.debutQueue) / 170)] || "A",
            regard: this.regard,
            saut: this.sauts.some(([debut, fin]) => t >= debut && t < fin),
            humeur: this.endormi ? "normal" : this.humeur,
            lunettes: ChatNoir.lunettes
        };
        // On ne redessine que si quelque chose a changé
        const cle = Object.values(etat).join("|") + this.toile.clientWidth;
        if (cle === this.etatDessine) return;
        this.dessiner(etat);
        this.etatDessine = cle;
    }

    dessiner(etat) {
        this.dessinerCorps(etat);
        if (!etat.lunettes) return;
        // Les lunettes par-dessus tout le reste, quelle que soit l'expression
        const d = this.toile.width / 20;
        const decalage = etat.saut ? 0 : 1;
        const pixel = ([l, c], couleur) => {
            this.pinceau.fillStyle = couleur;
            this.pinceau.fillRect(c * d, (l + decalage) * d, d, d);
        };
        LUNETTES.forEach((p) => pixel(p, ChatNoir.couleurs.lunettes));
        // Le reflet seulement sur des yeux grands ouverts (il brouillerait les ^ ^ et les yeux plissés)
        if (!etat.yeuxFermes && etat.humeur === "normal") REFLETS.forEach((p) => pixel(p, ChatNoir.couleurs.reflet));
    }

    dessinerCorps({ yeuxFermes, queue, regard, saut, humeur }) {
        const { toile, pinceau } = this;
        const C = ChatNoir.couleurs;
        // Taille d'une case en pixels réels (nombre entier = pixels nets)
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const d = Math.max(1, Math.round((toile.clientWidth || 80) / 20 * dpr));
        if (toile.width !== 20 * d) toile.width = toile.height = 20 * d;
        pinceau.clearRect(0, 0, toile.width, toile.height);

        const grille = SPRITE.map((ligne) => ligne.split(""));
        QUEUES[queue].forEach(([l, c]) => { grille[l][c] = "k"; });

        const plein = (l, c) => (grille[l]?.[c] ?? ".") !== ".";
        const decalage = saut ? 0 : 1; // au clic, le chat monte d'une case
        const pixel = (c, l, couleur) => {
            pinceau.fillStyle = couleur;
            pinceau.fillRect(c * d, (l + decalage) * d, d, d);
        };
        const yeux = [];

        grille.forEach((ligne, l) => ligne.forEach((ch, c) => {
            if (ch === ".") return;
            if (ch === "e") { yeux.push([l, c]); return; }
            let couleur = C[ch];
            if (ch === "k") {
                if (!plein(l - 1, c) || !plein(l, c - 1)) couleur = C.contour; // bords éclairés
                else if (!plein(l, c + 1)) couleur = C.ombre;                  // bord droit
            }
            pixel(c, l, couleur);
        }));

        if (yeuxFermes) {
            yeux.forEach(([l, c]) => pixel(c, l, l === 6 ? C.paupiere : C.k));
            return;
        }
        // Content : des yeux en ^ ^ (le pixel du milieu en haut, les côtés en bas)
        if (humeur === "content") {
            pinceau.save();
            pinceau.shadowColor = C.halo;
            pinceau.shadowBlur = 2.2 * d;
            yeux.forEach(([l, c]) => {
                const milieu = c === 5 || c === 11;
                if ((l === 5 && milieu) || (l === 6 && !milieu)) pixel(c, l, C.oeil);
                else pixel(c, l, C.k);
            });
            pinceau.restore();
            return;
        }
        // Les yeux, avec leur légère lueur ; fâché : seulement la moitié basse (yeux plissés)
        pinceau.save();
        pinceau.shadowColor = C.halo;
        pinceau.shadowBlur = 2.2 * d;
        yeux.forEach(([l, c]) => pixel(c, l, humeur === "fache" && l === 5 ? C.paupiere : C.oeil));
        pinceau.restore();
        if (humeur === "fache") {
            [5, 11].forEach((c) => pixel(c + regard, 6, C.k));
            return;
        }
        // Pupilles, décalées selon le regard
        [5, 11].forEach((c) => {
            pixel(c + regard, 5, C.k);
            pixel(c + regard, 6, C.k);
        });
    }
}

ChatNoir.tous = new Set();
ChatNoir.couleurs = lireCouleurs();
ChatNoir.lunettes = false;

// À appeler quand les couleurs CSS changent (mode prof) : tous les chats se redessinent
ChatNoir.rafraichirCouleurs = () => {
    ChatNoir.couleurs = lireCouleurs();
    ChatNoir.tous.forEach((chat) => (chat.etatDessine = ""));
};

// Les yeux de chaque chat suivent la souris
window.addEventListener("pointermove", (e) => {
    ChatNoir.tous.forEach((chat) => {
        if (!chat.suitSouris) return;
        const zone = chat.toile.getBoundingClientRect();
        const ecart = e.clientX - (zone.left + zone.width * 0.42);
        chat.regard = ecart < -36 ? -1 : ecart > 36 ? 1 : 0;
    });
}, { passive: true });

(function boucle(t) {
    ChatNoir.tous.forEach((chat) => chat.animer(t));
    requestAnimationFrame(boucle);
})(performance.now());
