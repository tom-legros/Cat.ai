/* ==========================================================
   Cat Ai — les QCM cliquables
   ==========================================================
   Le modèle écrit un bloc ```qcm dans sa réponse ; l'app en fait une carte avec des boutons. Un bloc plutôt qu'un
   outil : ça marche avec tous les modèles (même un petit, sans outils) et dans le terminal (cli/catai.js).

   Le format, du texte simple (un petit modèle s'y trompe bien moins qu'en JSON) :

     Q: Où se fait la photosynthèse ?
     A) Dans les chloroplastes
     B) Dans les mitochondries
     C) Dans le noyau
     > Les chloroplastes contiennent la chlorophylle.

   La bonne réponse est TOUJOURS la première (A) : l'app mélange les choix à l'affichage. Pas d'étoile pour la
   marquer : les modèles la mettaient parfois sur une mauvaise réponse, et en SQL le « * » fait partie de la réponse
   (SELECT *). « > » donne l'explication. Un bloc ```choix (même format) sert à faire choisir l'utilisateur
   (« fiche courte ou détaillée ? ») : pas de bonne réponse, son clic part dans la discussion. Un JSON
   ({ questions: [{ question, choix, reponse, explication }] }) est aussi accepté.
   ========================================================== */

const MAX_QUESTIONS_QCM = 20;
const MAX_CHOIX_QCM = 8;
const LETTRES_QCM = "ABCDEFGH";

const nettoyerChoix = (t) => String(t ?? "").replace(/^\s*(?:[A-Ha-h]|\d{1,2})\s*[).:\]-]\s+/, "").trim();

// Une bonne réponse donnée par une lettre (« B »), un numéro (« 2 », compté à partir de 1) ou le texte du choix
function indexBonneReponse(reponse, choix) {
    if (reponse === undefined || reponse === null || reponse === "") return null;
    const texte = String(reponse).trim();
    if (/^[A-Ha-h]$/.test(texte)) { const i = LETTRES_QCM.indexOf(texte.toUpperCase()); return i < choix.length ? i : null; }
    if (/^\d{1,2}$/.test(texte)) { const i = Number(texte) - 1; return i >= 0 && i < choix.length ? i : null; }
    const i = choix.findIndex((c) => c.toLowerCase() === nettoyerChoix(texte).toLowerCase());
    return i >= 0 ? i : null;
}

function qcmDepuisJson(objet) {
    const liste = Array.isArray(objet) ? objet : Array.isArray(objet?.questions) ? objet.questions : objet ? [objet] : [];
    return liste.map((q) => {
        const choix = (q?.choix || q?.options || q?.reponses || []).map(nettoyerChoix).filter(Boolean).slice(0, MAX_CHOIX_QCM);
        return { question: String(q?.question || "").trim(), choix, bonne: indexBonneReponse(q?.reponse ?? q?.bonne ?? q?.correct, choix), explication: String(q?.explication || "").trim() };
    });
}

function qcmDepuisTexte(texte) {
    const questions = [];
    let q = null;
    const debut = (question) => { q = { question, choix: [], bonne: null, explication: "" }; questions.push(q); };
    for (const brute of String(texte).split(/\r?\n/)) {
        const ligne = brute.trim();
        if (!ligne) continue;
        let m;
        if ((m = /^(?:Q\s*\d*\s*[:.)-]|Question\s*\d*\s*[:.)-]|\d{1,2}\s*[.)]\s)\s*(.+)$/i.exec(ligne))) { debut(m[1].trim()); continue; }
        if ((m = /^([A-Ha-h])\s*[).:\]-]\s*(.+)$/.exec(ligne)) && q) {
            let choix = m[2].trim();
            // Une marque explicite (✓, « (bonne réponse) ») est respectée ; un « * » reste du texte (SELECT *)
            const marque = /\s*(✓|✔|\(bonne r[ée]ponse\))\s*$/i;
            if (marque.test(choix)) { choix = choix.replace(marque, "").trim(); if (q.bonne === null) q.bonne = q.choix.length; }
            if (q.choix.length < MAX_CHOIX_QCM) q.choix.push(choix);
            continue;
        }
        if ((m = /^(?:>|Explication\s*:)\s*(.+)$/i.exec(ligne)) && q) { q.explication = (q.explication ? `${q.explication} ` : "") + m[1].trim(); continue; }
        if ((m = /^(?:R[ée]ponse|Bonne r[ée]ponse)\s*:\s*(.+)$/i.exec(ligne)) && q) { const i = indexBonneReponse(m[1].replace(/[).].*$/, ""), q.choix); if (i !== null) q.bonne = i; continue; }
        // Une ligne de texte sans marque : la suite de la question (avant les choix)
        if (q && !q.choix.length) q.question += ` ${ligne}`;
        else if (!q) debut(ligne);
    }
    return questions;
}

// La bonne réponse est la première… sauf quand le modèle ne l'a pas mise en premier (un petit modèle garde l'ordre
// naturel : SELECT, UPDATE, INSERT INTO) : son explication la nomme presque toujours. Si l'explication ne cite pas
// le choix A mais cite exactement un autre choix, c'est lui.
function bonneSelonExplication(q) {
    const norme = (t) => ` ${String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9*]+/g, " ").trim()} `;
    const explication = norme(q.explication);
    if (explication.trim().length < 3) return 0;
    const cite = (choix) => norme(choix).trim().length >= 3 && explication.includes(norme(choix));
    if (cite(q.choix[0])) return 0;
    const autres = q.choix.map((c, i) => (i > 0 && cite(c) ? i : -1)).filter((i) => i > 0);
    return autres.length === 1 ? autres[0] : 0;
}

// Le contenu d'un bloc ```qcm (choix : true pour un bloc ```choix), ou null s'il n'a rien d'utilisable (on affiche
// alors le texte tel quel)
function lireQcm(texte, { choix = false } = {}) {
    const brut = String(texte ?? "").trim();
    if (!brut) return null;
    let questions;
    if (/^[[{]/.test(brut)) {
        try { questions = qcmDepuisJson(JSON.parse(brut.replace(/,\s*([}\]])/g, "$1"))); } catch { return null; }
    } else questions = qcmDepuisTexte(brut);
    questions = questions.filter((q) => q.question && q.choix.length >= 2).slice(0, MAX_QUESTIONS_QCM);
    // Les choix sont mélangés à l'affichage : une explication qui cite une lettre (« la réponse A ») tomberait faux
    for (const q of questions) q.explication = q.explication.replace(/\b(?:la )?(?:bonne )?r[ée]ponse\s+[A-H]\b\)?/gi, "La bonne réponse").replace(/^\s*[A-H]\)\s*/, "");
    if (!questions.length) return null;
    // Un choix à faire : une seule question, sans bonne réponse
    if (choix) return { quiz: false, questions: [{ ...questions[0], bonne: null, explication: "" }] };
    // Un quiz : sans autre indication, la bonne réponse est la première
    return { quiz: true, questions: questions.map((q) => ({ ...q, bonne: q.bonne ?? bonneSelonExplication(q) })) };
}

// Les modèles mettent souvent la bonne réponse en A (les petits : A, puis B, puis C) : dans un quiz, les choix sont
// mélangés. Le mélange dépend du texte de la question : la même carte garde le même ordre à chaque affichage.
function melangerQcm(qcm) {
    if (!qcm?.quiz) return qcm;
    return {
        ...qcm,
        questions: qcm.questions.map((q) => {
            let graine = 2166136261;
            for (const c of q.question + q.choix.join("|")) graine = Math.imul(graine ^ c.codePointAt(0), 16777619) >>> 0;
            const ordre = q.choix.map((_, i) => i);
            for (let i = ordre.length - 1; i > 0; i--) {
                graine = Math.imul(graine ^ (graine >>> 15), 2246822507) >>> 0;
                const j = graine % (i + 1);
                [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
            }
            return { ...q, choix: ordre.map((i) => q.choix[i]), bonne: ordre.indexOf(q.bonne) };
        }),
    };
}

// Le bilan envoyé au chat à la fin d'un quiz, pour qu'il explique les erreurs
function bilanQcm(qcm, reponses) {
    const bonnes = qcm.questions.filter((q, i) => reponses[i] === q.bonne).length;
    const erreurs = qcm.questions.map((q, i) => ({ q, i })).filter(({ q, i }) => reponses[i] !== q.bonne);
    const lignes = [`J'ai fait le QCM : ${bonnes}/${qcm.questions.length}.`];
    for (const { q, i } of erreurs) {
        lignes.push(`- « ${q.question} » : j'ai répondu « ${q.choix[reponses[i]] ?? "rien"} », la bonne réponse était « ${q.choix[q.bonne]} ».`);
    }
    lignes.push(erreurs.length ? "Explique-moi mes erreurs simplement." : "Tout juste ! Propose-moi la suite.");
    return { bonnes, total: qcm.questions.length, texte: lignes.join("\n") };
}

// ---------- Dans la fenêtre ----------
// La carte d'un bloc qcm : une question à la fois, la bonne réponse en vert, la mauvaise en rouge, l'explication,
// puis le score. Les réponses sont gardées pour la session (la carte est redessinée à chaque rendu du message).
const ETATS_QCM = new Map();

function carteQcm(el, qcm, { envoyer, cle }) {
    const etat = ETATS_QCM.get(cle) || { index: 0, reponses: [], envoye: false };
    ETATS_QCM.set(cle, etat);
    const creerEl = (tag, classe, texte) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texte !== undefined) e.textContent = texte; return e; };
    const dessiner = () => {
        el.replaceChildren();
        const total = qcm.questions.length;
        if (qcm.quiz && etat.index >= total) {
            const { bonnes, texte } = bilanQcm(qcm, etat.reponses);
            el.append(creerEl("p", "qcm__score", `${bonnes}/${total}`),
                creerEl("p", "qcm__message", bonnes === total ? "Tout juste, bravo !" : bonnes >= total / 2 ? "Pas mal ! Regarde tes erreurs." : "On revoit ça ensemble ?"));
            const bouton = creerEl("button", "bouton", bonnes === total ? "La suite" : "Revoir mes erreurs");
            bouton.type = "button";
            bouton.disabled = etat.envoye;
            bouton.addEventListener("click", () => { etat.envoye = true; bouton.disabled = true; envoyer(texte); });
            const recommencer = creerEl("button", "bouton-calme", "Recommencer");
            recommencer.type = "button";
            recommencer.addEventListener("click", () => { etat.index = 0; etat.reponses = []; etat.envoye = false; dessiner(); });
            const actions = creerEl("div", "qcm__actions");
            actions.append(bouton, recommencer);
            el.append(actions);
            return;
        }
        const q = qcm.questions[etat.index];
        const repondu = etat.reponses[etat.index] !== undefined;
        if (qcm.quiz) el.append(creerEl("p", "qcm__numero", `Question ${etat.index + 1}/${total}`));
        el.append(creerEl("p", "qcm__question", q.question));
        const liste = creerEl("div", "qcm__choix");
        q.choix.forEach((choix, i) => {
            const b = creerEl("button", "qcm__option");
            b.type = "button";
            b.append(creerEl("span", "qcm__lettre", LETTRES_QCM[i]), creerEl("span", "", choix));
            if (repondu) {
                b.disabled = true;
                if (qcm.quiz && i === q.bonne) b.classList.add("is-bonne");
                else if (i === etat.reponses[etat.index]) b.classList.add(qcm.quiz ? "is-fausse" : "is-choisie");
            }
            b.addEventListener("click", () => {
                if (etat.reponses[etat.index] !== undefined) return;
                etat.reponses[etat.index] = i;
                // Un choix à faire : il part dans la discussion, comme si on l'avait écrit
                if (!qcm.quiz) envoyer(choix);
                dessiner();
            });
            liste.append(b);
        });
        el.append(liste);
        if (repondu && qcm.quiz) {
            const juste = etat.reponses[etat.index] === q.bonne;
            el.append(creerEl("p", `qcm__verdict ${juste ? "is-bonne" : "is-fausse"}`, juste ? "Bonne réponse !" : `Raté : c'était ${LETTRES_QCM[q.bonne]}.`));
            if (q.explication) el.append(creerEl("p", "qcm__explication", q.explication));
            const suivant = creerEl("button", "bouton", etat.index + 1 < total ? "Question suivante" : "Voir mon score");
            suivant.type = "button";
            suivant.addEventListener("click", () => { etat.index++; dessiner(); });
            const actions = creerEl("div", "qcm__actions");
            actions.append(suivant);
            el.append(actions);
        }
    };
    dessiner();
}

// Après chaque rendu d'une réponse : les blocs qcm deviennent des cartes. Pendant l'écriture, un bloc pas encore
// fini reste « en préparation » ; un bloc illisible est montré tel quel.
function animerQcm(conteneur, { envoyer, cleDiscussion = "", termine = true } = {}) {
    for (const el of conteneur.querySelectorAll(".qcm[data-qcm]")) {
        const texte = el.getAttribute("data-qcm");
        const qcm = lireQcm(texte, { choix: el.hasAttribute("data-choix") });
        el.removeAttribute("data-qcm");
        if (!qcm || !termine) {
            el.classList.add("qcm--attente");
            el.textContent = termine ? texte : "Le QCM arrive…";
            continue;
        }
        carteQcm(el, melangerQcm(qcm), { envoyer, cle: `${cleDiscussion}\u0000${texte}` });
    }
}

if (typeof module !== "undefined") module.exports = { lireQcm, melangerQcm, bilanQcm, indexBonneReponse, LETTRES_QCM };
