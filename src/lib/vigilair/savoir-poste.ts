/**
 * Savoir local de l'assistant : le LIREMOI du poste, découpé en passages, dans lequel on retrouve
 * ceux qui répondent à une question d'usage (« comment relier le téléphone Signal ? », « où mettre
 * les tuiles de relief ? »). Tout reste sur le poste : aucune recherche en ligne, aucun index
 * externe — une simple correspondance de mots, sans accents, sur le fichier présent.
 *
 * Le budget est serré exprès : un serveur Ollama tronque sans prévenir ce qui dépasse sa fenêtre de
 * contexte (souvent 2 048 à 4 096 jetons), et l'image live doit garder sa place dans la question.
 *
 * Réglages choisis à la mesure, sur 46 questions d'usage écrites comme un opérateur et 10 sur
 * l'image live : la bonne réponse est dans ce qui part au modèle pour 42 des 46. Essayés puis
 * retirés faute de gain : pondération des mots rares (en note ou en départage), bonus aux mots du
 * titre, préférence aux passages courts, coupe nette des longs passages.
 */
export type Passage = { titre: string; texte: string };

// Mots trop courants pour départager deux passages.
const MOTS_VIDES = new Set(
  (
    "les des une dans pour par sur avec sans que qui quoi quel quelle quels quelles est sont ete etre " +
    "faire fait peut peux veux dois comment pourquoi quand aux ces cet cette son ses leur leurs mon " +
    "moi mes ton tes nous vous ils elles pas plus moins tout tous toute toutes comme mais donc alors " +
    "aussi tres bien deja encore ici avoir ont elle lui car entre vers chez dont apres sous puis " +
    "depuis selon chaque meme poste console"
  ).split(" "),
);

// Mots de deux lettres qui portent le sens de la question (« le modèle de l'IA »).
const COURTS = new Set(["ia"]);

/** Au-delà, un passage est resserré sur les lignes qui parlent de la question. */
const PASSAGE_ENTIER = 900;

function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Termes significatifs d'un texte, dans l'ordre : minuscules, sans accents, sans « s » ni « x »
 * final (« feux » rejoint « feu »), racine sur cinq lettres. Cinq : « régler » et « réglée » se
 * rejoignent. « relief » et « relier » aussi, mais un seul terme commun ne suffit pas à tirer un
 * passage (voir extraitsPertinents).
 */
function suiteTermes(s: string): string[] {
  const t: string[] = [];
  for (const mot of sansAccents(s.toLowerCase()).split(/[^a-z0-9]+/)) {
    if ((mot.length < 3 && !COURTS.has(mot)) || MOTS_VIDES.has(mot)) continue;
    const singulier = mot.length > 3 && /[sx]$/.test(mot) ? mot.slice(0, -1) : mot;
    t.push(singulier.slice(0, 5));
  }
  return t;
}

export function termes(s: string): Set<string> {
  return new Set(suiteTermes(s));
}

/**
 * Paires de termes qui se suivent : « comparateur avant/après », « drones et caméras »,
 * « Sentinel-2 récente ». Une notion en deux mots, souvent le titre de sa section, départage les
 * passages qui n'ont chacun que deux termes en commun avec la question.
 */
function paires(s: string): Set<string> {
  const t = suiteTermes(s);
  const p = new Set<string>();
  for (let i = 1; i < t.length; i++) p.add(`${t[i - 1]} ${t[i]}`);
  return p;
}

/**
 * Passages du LIREMOI, chacun rattaché au titre de sa section. Un titre est une ligne non indentée
 * qui suit une ligne vide ; un passage est une puce (« - … ») ou un paragraphe, avec ses lignes de
 * suite, jusqu'à la puce suivante ou la ligne vide. Les sections écrites sans puces (« Antenne
 * 1090 du poste ») sont donc lues aussi : avant, leurs lignes passaient pour des titres et leur
 * contenu n'était jamais cherché.
 */
export function decouperLiremoi(texte: string): Passage[] {
  const passages: Passage[] = [];
  let section = "";
  let courant: string[] | null = null;
  let apresBlanc = true;
  const fermer = () => {
    if (!courant) return;
    const tete = courant[0]!.trim().replace(/^- /, "");
    const lead = (tete.split(/ : |\. /)[0] ?? tete).slice(0, 70);
    passages.push({ titre: section ? `${section} — ${lead}` : lead, texte: courant.join("\n") });
    courant = null;
  };
  for (const ligne of texte.split(/\r?\n/)) {
    const vide = !ligne.trim();
    if (vide) fermer();
    else if (ligne.startsWith("- ")) {
      fermer();
      courant = [ligne];
    } else if (apresBlanc && /^\S/.test(ligne)) section = ligne.trim();
    else if (courant) courant.push(ligne);
    else courant = [ligne];
    apresBlanc = vide;
  }
  fermer();
  return passages;
}

/**
 * Un long passage (les entrées d'historique font jusqu'à 3 600 caractères) est ramené à sa
 * première ligne et aux lignes qui portent un terme de la question ; « […] » marque chaque coupe.
 * Mesuré : couper net à 600 ou 900 caractères perdait la réponse, souvent plus loin dans le texte.
 */
function resserrer(texte: string, q: Set<string>): string {
  if (texte.length <= PASSAGE_ENTIER) return texte;
  const lignes = texte.split("\n");
  const sortie: string[] = [];
  let precedente = -1;
  lignes.forEach((ligne, i) => {
    if (i > 0 && ![...termes(ligne)].some((t) => q.has(t))) return;
    if (i > precedente + 1) sortie.push("  […]");
    sortie.push(ligne);
    precedente = i;
  });
  if (precedente < lignes.length - 1) sortie.push("  […]");
  return sortie.join("\n");
}

/**
 * Passages qui répondent à la question, du plus pertinent au moins pertinent (termes en commun plus
 * paires en commun, puis l'ordre du LIREMOI), dans le budget de caractères. Un passage doit
 * partager au moins deux termes avec la question : une question sur l'image live ne tire pas de
 * documentation au hasard.
 */
export function extraitsPertinents(
  question: string,
  passages: Passage[],
  budget = 1800,
): Passage[] {
  const q = termes(question);
  const qp = paires(question);
  const notes = passages
    .map((p, i) => {
      const complet = `${p.titre}\n${p.texte}`;
      const t = termes(complet);
      const tp = paires(complet);
      let communs = 0;
      for (const x of q) if (t.has(x)) communs += 1;
      let liees = 0;
      for (const x of qp) if (tp.has(x)) liees += 1;
      return { p, i, communs, note: communs + liees };
    })
    .filter((n) => n.communs >= 2)
    .sort((a, b) => b.note - a.note || a.i - b.i);
  const choisis: Passage[] = [];
  let reste = budget;
  for (const { p } of notes) {
    if (reste < 200) break;
    const r = resserrer(p.texte, q);
    const texte = r.length > reste ? `${r.slice(0, reste - 1)}…` : r;
    choisis.push({ titre: p.titre, texte });
    reste -= texte.length;
  }
  return choisis;
}
