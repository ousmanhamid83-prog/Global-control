/**
 * La notice du poste (LIREMOI) à disposition de l'assistant — CÔTÉ SERVEUR. Elle est embarquée au
 * build : c'est la notice de CETTE version du code, lue sans disque, sans réseau, quel que soit le
 * dossier d'où le serveur est lancé. Découpée une fois, au premier appel.
 */
import { IA_NOTICE_BUDGET } from "./ia-limites.ts";
import { decouperLiremoi, extraitsPertinents, type Passage } from "./savoir-poste.ts";

let passages: Passage[] | null = null;

/** Les passages de la notice qui répondent à la question, dans le budget de l'assistant. */
export async function noticePour(question: string): Promise<Passage[]> {
  passages ??= decouperLiremoi((await import("../../../LIREMOI.txt?raw")).default);
  return extraitsPertinents(question, passages, IA_NOTICE_BUDGET);
}
