/**
 * ONVIF / WS-Discovery — cœur PUR, testable. Sert à la « découverte réseau » : trouver les caméras
 * ONVIF présentes sur le LAN SANS taper d'IP. Le poste envoie une sonde multicast (Probe) ; chaque
 * caméra répond (ProbeMatch) avec l'URL de son service (XAddrs) et ses « scopes » (nom, modèle,
 * emplacement du matériel). Ce module ne fait AUCUN réseau : il construit la requête et parse la
 * réponse. L'envoi UDP est côté serveur (drones.server). Tout est métadonnée d'ÉQUIPEMENT (nom de la
 * caméra, modèle), JAMAIS de l'identité de personnes.
 */

/** Adresse multicast WS-Discovery (SOAP-over-UDP), port standard 3702. */
export const WS_DISCOVERY_ADDR = "239.255.255.250";
export const WS_DISCOVERY_PORT = 3702;

/** Une caméra ONVIF découverte (métadonnée d'équipement, pas d'identité). */
export type OnvifDevice = {
  /** EndpointReference Address (urn:uuid:…) — identifiant stable de l'appareil. */
  urn?: string;
  /** Première URL de service ONVIF annoncée (XAddrs). */
  xaddr: string;
  /** host:port extrait de xaddr, prêt pour le champ « hôte » de la fiche. */
  address: string;
  host: string;
  port?: number;
  /** Scope .../name/<…> : nom donné à la caméra. */
  name?: string;
  /** Scope .../hardware/<…> : modèle/matériel. */
  hardware?: string;
  /** Scope .../location/<…> : emplacement déclaré. */
  location?: string;
  scopes: string[];
};

/**
 * Enveloppe SOAP 1.2 d'une sonde WS-Discovery Probe pour les émetteurs vidéo réseau (caméras ONVIF).
 * `uuid` = identifiant du message (le serveur en génère un neuf à chaque sonde).
 */
export function buildProbe(uuid: string): string {
  const id = /^urn:uuid:/.test(uuid) ? uuid : `urn:uuid:${uuid}`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"' +
    ' xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"' +
    ' xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"' +
    ' xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
    "<e:Header>" +
    `<w:MessageID>${id}</w:MessageID>` +
    "<w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>" +
    "<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>" +
    "</e:Header>" +
    "<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>" +
    "</e:Envelope>"
  );
}

/** Contenu texte d'une balise, quel que soit le préfixe de namespace (d:XAddrs, wsd:XAddrs, …). */
function tagText(xml: string, local: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`, "i"));
  return m ? m[1]!.trim() : undefined;
}

/** host + port depuis une URL de service (prend la 1re URL http(s) d'une liste séparée par espaces). */
export function parseXAddrHost(xaddrs: string): { xaddr: string; host: string; port?: number } | null {
  const first = (xaddrs ?? "").split(/\s+/).find((u) => /^https?:\/\//i.test(u));
  if (!first) return null;
  try {
    const u = new URL(first);
    const port = u.port ? Number(u.port) : undefined;
    return { xaddr: first, host: u.hostname, port };
  } catch {
    return null;
  }
}

/** Valeur d'un scope ONVIF (onvif://www.onvif.org/<key>/<valeur>), URL-décodée. */
export function scopeValue(scopes: string[], key: string): string | undefined {
  const needle = `/${key}/`;
  for (const s of scopes) {
    const i = s.indexOf(needle);
    if (i >= 0) {
      const raw = s.slice(i + needle.length).split(/\s+/)[0] ?? "";
      try {
        return decodeURIComponent(raw) || undefined;
      } catch {
        return raw || undefined;
      }
    }
  }
  return undefined;
}

/**
 * Parse une réponse ProbeMatches (une ou plusieurs caméras). Robuste aux préfixes de namespace.
 * Dédoublonne par URL de service. Renvoie les appareils exploitables (ceux avec une XAddrs http).
 */
export function parseProbeMatches(xml: string): OnvifDevice[] {
  const out: OnvifDevice[] = [];
  const seen = new Set<string>();
  const blocks = xml.match(/<(?:[\w.-]+:)?ProbeMatch\b[\s\S]*?<\/(?:[\w.-]+:)?ProbeMatch>/gi) ?? [];
  for (const block of blocks) {
    const xaddrs = tagText(block, "XAddrs");
    if (!xaddrs) continue;
    const parsed = parseXAddrHost(xaddrs);
    if (!parsed || seen.has(parsed.xaddr)) continue;
    seen.add(parsed.xaddr);
    const scopesRaw = tagText(block, "Scopes") ?? "";
    const scopes = scopesRaw.split(/\s+/).filter(Boolean);
    // EndpointReference > Address
    const epr = block.match(/<(?:[\w.-]+:)?EndpointReference\b[\s\S]*?<\/(?:[\w.-]+:)?EndpointReference>/i)?.[0];
    const urn = epr ? tagText(epr, "Address") : undefined;
    const port = parsed.port;
    const address = port && port !== 80 && port !== 443 ? `${parsed.host}:${port}` : parsed.host;
    out.push({
      urn,
      xaddr: parsed.xaddr,
      address,
      host: parsed.host,
      port,
      name: scopeValue(scopes, "name"),
      hardware: scopeValue(scopes, "hardware"),
      location: scopeValue(scopes, "location"),
      scopes,
    });
  }
  return out;
}
