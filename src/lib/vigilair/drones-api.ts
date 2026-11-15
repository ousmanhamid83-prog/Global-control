/**
 * Server fns du registre « nos drones » — liste / ajout / retrait + proxy image (une trame).
 * Module léger isolé (comme routes-api / ground-sensors-api). Réception / lecture seule.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { OwnDrone } from "./drones.server";
import { ORDRES_DRONE, type EtatDrone, type ReglagesPilotage } from "./drones-pilotage";

export const dronesList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<OwnDrone[]> => {
    const m = await import("./drones.server");
    return m.listDronesServer();
  });

export const droneAdd = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { kind?: string; name?: string; ident?: string; site?: string; snapshotUrl?: string; host?: string; port?: number | string; path?: string }) => ({
    kind: String(raw?.kind ?? "drone"),
    name: String(raw?.name ?? ""),
    ident: String(raw?.ident ?? ""),
    site: String(raw?.site ?? ""),
    snapshotUrl: String(raw?.snapshotUrl ?? ""),
    host: String(raw?.host ?? ""),
    port: raw?.port == null || raw.port === "" ? 0 : Number(raw.port),
    path: String(raw?.path ?? ""),
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string; drones?: OwnDrone[] }> => {
    const m = await import("./drones.server");
    return m.addDroneServer(data);
  });

export const droneRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string }) => ({ id: String(raw?.id ?? "") }))
  .handler(async ({ data }): Promise<{ drones: OwnDrone[] }> => {
    const m = await import("./drones.server");
    return { drones: await m.removeDroneServer(data.id) };
  });

export const droneSetRoi = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; roi?: { x: number; y: number }[] }) => ({
    id: String(raw?.id ?? ""),
    roi: Array.isArray(raw?.roi) ? raw.roi : [],
  }))
  .handler(async ({ data }): Promise<{ drones: OwnDrone[] }> => {
    const m = await import("./drones.server");
    return { drones: await m.setDroneRoiServer(data.id, data.roi) };
  });

export const droneSetZones = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; zones?: { x: number; y: number }[][] }) => ({
    id: String(raw?.id ?? ""),
    zones: Array.isArray(raw?.zones) ? raw.zones : [],
  }))
  .handler(async ({ data }): Promise<{ drones: OwnDrone[] }> => {
    const m = await import("./drones.server");
    return { drones: await m.setDroneZonesServer(data.id, data.zones) };
  });

export const droneSetRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; rule?: { nightOnly?: boolean; armFrom?: number; armTo?: number } | null }) => ({
    id: String(raw?.id ?? ""),
    rule: raw?.rule == null ? null : { nightOnly: !!raw.rule.nightOnly, armFrom: Number(raw.rule.armFrom), armTo: Number(raw.rule.armTo) },
  }))
  .handler(async ({ data }): Promise<{ drones: OwnDrone[] }> => {
    const m = await import("./drones.server");
    return { drones: await m.setDroneRuleServer(data.id, data.rule) };
  });

/** Scan auto : découvre le port/chemin du flux d'une de NOS sources à partir de son hôte. */
export const scanSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { host?: string }) => ({ host: String(raw?.host ?? "") }))
  .handler(async ({ data }) => {
    const m = await import("./drones.server");
    return m.scanSourceServer(data.host);
  });

/** Découverte ONVIF : trouve les caméras du réseau (multicast WS-Discovery), sans taper d'IP. */
export const onvifDiscover = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { timeoutMs?: number }) => ({ timeoutMs: Number(raw?.timeoutMs) || 3000 }))
  .handler(async ({ data }) => {
    const m = await import("./drones.server");
    return m.discoverOnvifServer(data.timeoutMs);
  });

/** Scan de plage : balaie un sous-réseau (site distant au bout de l'antenne) et trouve les caméras. */
export const scanRange = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { spec?: string }) => ({ spec: String(raw?.spec ?? "") }))
  .handler(async ({ data }) => {
    const m = await import("./drones.server");
    return m.scanRangeServer(data.spec);
  });

/** Enregistrement en lot : inscrit plusieurs caméras d'un coup (scan optionnel du chemin). */
export const registerCameras = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { list?: { host?: string; port?: number | string; path?: string; name?: string; site?: string; url?: string }[]; scan?: boolean }) => ({
    list: Array.isArray(raw?.list) ? raw.list : [],
    scan: !!raw?.scan,
  }))
  .handler(async ({ data }) => {
    const m = await import("./drones.server");
    return m.registerCamerasServer(data.list, data.scan);
  });

/** Proxy image : récupère une trame fixe d'un drone inscrit et la renvoie en data URL (voir serveur). */
export const fetchDroneFrame = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { url?: string }) => ({ url: String(raw?.url ?? "") }))
  .handler(async ({ data }): Promise<{ ok: boolean; dataUrl?: string; at?: number; error?: string }> => {
    const m = await import("./drones.server");
    return m.fetchDroneFrameServer(data.url);
  });

/** Ce que le poste sait de chaque drone par sa liaison, et les réglages du pilotage. Lecture seule. */
export const dronesEtats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ etats: EtatDrone[]; reglages: ReglagesPilotage; a: number }> => {
    const m = await import("./drones.server");
    await m.listDronesServer(); // le registre lu, les liaisons sont ouvertes
    const l = await import("./drones-liaison.server");
    // `a` : l'heure du poste — la console juge l'âge d'un battement sur elle, pas sur la sienne.
    return { etats: l.etatsDrones(), reglages: await m.lireReglagesPilotage(), a: Date.now() };
  });

const nombre = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * Un ordre du chef à un de nos drones. Réservé au chef de division ; un ordre qui met ou garde le
 * drone en vol vers un but demande en plus son sceau (mot de passe retapé) — sans comptes, donc
 * sans sceau possible, ces ordres-là ne partent jamais. Le poste vérifie avant d'envoyer, et tout
 * va au journal : ce qui est parti, ce qui a été refusé, et pourquoi.
 */
export const droneOrdre = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; ordre?: string; lat?: number; lon?: number; hauteurM?: number }) => {
    const ordre = ORDRES_DRONE.find((o) => o.id === raw?.ordre);
    if (!ordre) throw new Error("Ordre inconnu");
    return {
      id: String(raw?.id ?? ""),
      ordre: ordre.id,
      lat: nombre(raw.lat),
      lon: nombre(raw.lon),
      hauteurM: nombre(raw.hauteurM),
    };
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean; suite: string[] }> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const def = ORDRES_DRONE.find((o) => o.id === data.ordre)!;
    if (def.sceau) {
      const { requireChefSeal } = await import("./seal");
      await requireChefSeal(context.userId);
    }
    const m = await import("./drones.server");
    const drone = (await m.listDronesServer()).find((d) => d.id === data.id);
    if (!drone) throw new Error("Drone inconnu");
    const l = await import("./drones-liaison.server");
    const r = await l.commander(drone.id, data.ordre, data, drone.patrouille, await m.lireReglagesPilotage());
    const vers =
      data.ordre === "aller"
        ? ` vers ${data.lat?.toFixed(5)}, ${data.lon?.toFixed(5)} à ${data.hauteurM} m`
        : data.ordre === "decoller"
          ? ` à ${data.hauteurM} m`
          : "";
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "drone",
      title: `Drone ${drone.name} — ${def.nom}${vers} : ${r.ok ? "envoyé" : "pas parti"}`,
      detail: r.suite.join(" · "),
      severity: r.ok ? "info" : "warn",
    });
    return r;
  });

/** Le chef règle (ou retire) la liaison d'un drone ; au journal. */
export const droneLiaison = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; adresse?: string }) => ({
    id: String(raw?.id ?? ""),
    adresse: String(raw?.adresse ?? "").slice(0, 200),
  }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; drones?: OwnDrone[] }> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const m = await import("./drones.server");
    const r = await m.setDroneLiaisonServer(data.id, data.adresse);
    if (r.ok) {
      const drone = r.drones!.find((d) => d.id === data.id)!;
      await insertOpsLog({
        userId: chef.userId,
        actor: chef.label,
        role: chef.role,
        team: chef.team,
        kind: "drone",
        title: `Drone ${drone.name} — liaison ${drone.liaison ? "réglée" : "retirée"} par le chef`,
        detail: drone.liaison
          ? "Le poste suit le drone par sa télémétrie et peut lui envoyer les ordres permis."
          : "Le drone reste inscrit ; il n'est plus suivi ni piloté par sa liaison.",
        severity: "warn",
      });
    }
    return r;
  });

/** Le chef règle (ou retire, null) le circuit de patrouille d'un drone. */
export const dronePatrouille = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: { id?: string; patrouille?: { points?: unknown; hauteurM?: unknown; tours?: unknown } | null }) => ({
    id: String(raw?.id ?? ""),
    patrouille: raw?.patrouille ?? null,
  }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; drones?: OwnDrone[] }> => {
    const { requireSuperadmin } = await import("./staff");
    await requireSuperadmin(context.userId);
    const m = await import("./drones.server");
    return m.setDronePatrouilleServer(data.id, data.patrouille);
  });

/** Le chef règle le pilotage : ordres permis, rayon, hauteurs ; chaque changement va au journal. */
export const dronesReglages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => raw)
  .handler(async ({ data, context }): Promise<ReglagesPilotage> => {
    const { insertOpsLog, requireSuperadmin } = await import("./staff");
    const chef = await requireSuperadmin(context.userId);
    const m = await import("./drones.server");
    const r = await m.ecrireReglagesPilotage(data);
    const coupes = ORDRES_DRONE.filter((o) => !r.ordres[o.id]).map((o) => o.nom);
    await insertOpsLog({
      userId: chef.userId,
      actor: chef.label,
      role: chef.role,
      team: chef.team,
      kind: "drone",
      title: "Pilotage des drones réglé par le chef",
      detail: `Ordres coupés : ${coupes.length ? coupes.join(", ") : "aucun"}. Rayon ${r.rayonKm} km, hauteurs ${r.hauteurMinM} à ${r.hauteurMaxM} m.`,
      severity: "warn",
    });
    return r;
  });
