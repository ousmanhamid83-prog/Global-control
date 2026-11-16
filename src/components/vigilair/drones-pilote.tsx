/**
 * Nos drones sur la carte : ce que la liaison de chacun en dit, et — pour le chef de division — les
 * ordres permis. Chaque ordre demande une confirmation ; « aller à un point » se désigne sur la
 * carte. Le poste vérifie tout avant d'envoyer, et ce qu'il a fait ou refusé s'affiche ici.
 */
import { useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  dronesServerSnapshot,
  dronesSnapshot,
  subscribeDrones,
  type OwnDrone,
} from "@/lib/vigilair/drones";
import {
  liaisonVivante,
  nomMode,
  ORDRES_DRONE,
  pilotable,
  refus,
  type EtatDrone,
  type OrdreDrone,
  type ReglagesPilotage,
} from "@/lib/vigilair/drones-pilotage";
import {
  designerPoint,
  ordonnerDrone,
  subscribeSuivi,
  suiviServeur,
  suiviSnapshot,
} from "@/lib/vigilair/drones-suivi";
import { haversineKm } from "@/lib/vigilair/geo";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";

type Attente = { id: string; ordre: OrdreDrone; hauteur: string };

const metres = (km: number): string =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;

function Etat({ e, a }: { e: EtatDrone; a: number }) {
  if (!e.lie)
    return <span className="text-warn">liaison coupée{e.erreur ? ` — ${e.erreur}` : ""}</span>;
  if (!liaisonVivante(e, a))
    return <span className="text-warn">liaison muette : aucun battement du drone</span>;
  const p = e.position;
  return (
    <span className="text-muted-foreground">
      <span className="text-fg">{nomMode(e)}</span>
      {" · "}
      {e.arme ? "moteurs armés" : "posé, moteurs coupés"}
      {p
        ? ` · ${Math.round(p.hauteurM)} m · ${p.vitesseMs.toFixed(1)} m/s`
        : " · position pas encore reçue"}
      {p && e.depart
        ? ` · à ${metres(haversineKm(e.depart.lat, e.depart.lon, p.lat, p.lon))} du départ`
        : ""}
      {e.batteriePct !== null ? ` · batterie ${e.batteriePct} %` : ""}
      {e.gps
        ? ` · GPS ${e.gps.fix >= 3 ? "3D" : "sans position"}${e.gps.satellites !== null ? ` ${e.gps.satellites} sat.` : ""}`
        : ""}
    </span>
  );
}

function Fiche({
  drone,
  e,
  a,
  reglages,
  chef,
  designe,
}: {
  drone: OwnDrone;
  e: EtatDrone;
  a: number;
  reglages: ReglagesPilotage;
  chef: boolean;
  designe: { lat: number; lon: number } | null;
}) {
  const setCopTool = useVigilair((s) => s.setCopTool);
  const [attente, setAttente] = useState<Attente | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [resultat, setResultat] = useState<{ ok: boolean; suite: string[] } | null>(null);

  const fermer = () => {
    setAttente(null);
    designerPoint(null);
    setCopTool("lock");
  };
  const choisir = (ordre: OrdreDrone) => {
    setResultat(null);
    designerPoint(null);
    const defaut = ordre === "aller" && e.position ? e.position.hauteurM : 30;
    const hauteur = Math.min(
      reglages.hauteurMaxM,
      Math.max(reglages.hauteurMinM, Math.round(defaut)),
    );
    setAttente({ id: drone.id, ordre, hauteur: String(hauteur) });
    setCopTool(ordre === "aller" ? "drone" : "lock");
  };
  const envoyer = async () => {
    if (!attente) return;
    setOccupe(true);
    const hauteurM = Number(attente.hauteur.replace(",", "."));
    const r = await ordonnerDrone(drone.id, attente.ordre, { ...designe, hauteurM });
    setOccupe(false);
    setResultat(r);
    fermer();
  };
  // Ce que le poste répondrait maintenant, pour griser un ordre qui n'a pas de sens : il revérifie.
  const pourquoiPas = (ordre: OrdreDrone): string | null =>
    refus(ordre, { ...e.depart, hauteurM: reglages.hauteurMinM }, e, drone.patrouille, reglages, a);
  const def = attente ? ORDRES_DRONE.find((o) => o.id === attente.ordre)! : null;
  const dernier = e.textes[0];

  return (
    <li data-drone-pilote={drone.id} className="space-y-1.5 px-3 py-2 text-[11px]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-fg">{drone.name}</span>
        <Etat e={e} a={a} />
      </div>
      {dernier && a - dernier.a < 30_000 ? (
        <p className="text-muted-foreground">Le drone dit : « {dernier.texte} »</p>
      ) : null}
      {e.lie && liaisonVivante(e, a) && !pilotable(e) ? (
        <p className="text-muted-foreground">
          Suivi, pas piloté d'ici : les ordres ne partent que vers un multirotor ArduPilot, seul
          essayé.
        </p>
      ) : null}
      {e.voie === "secours" ? (
        <p data-drone-voie-secours className="text-warn">
          Liaison principale muette : le poste tient ce drone par sa liaison de secours.
        </p>
      ) : null}
      {e.signe ? (
        <p className="text-warn">
          Ce drone signe ses trames : il peut refuser les ordres du poste, qui ne signe pas.
        </p>
      ) : null}
      {chef && pilotable(e) ? (
        <div className="flex flex-wrap gap-1">
          {ORDRES_DRONE.filter((o) => reglages.ordres[o.id]).map((o) => {
            const non = pourquoiPas(o.id);
            return (
              <Button
                key={o.id}
                data-drone-ordre={o.id}
                size="sm"
                variant={attente?.ordre === o.id ? "default" : "outline"}
                disabled={occupe || non !== null}
                title={non ?? o.quoi}
                onClick={() => choisir(o.id)}
              >
                {o.nom}
              </Button>
            );
          })}
        </div>
      ) : null}
      {attente && def ? (
        <div
          data-drone-confirmation={attente.ordre}
          className="space-y-1.5 rounded-sm border border-border bg-bg/70 p-2"
        >
          <p className="text-fg">
            {def.nom} — {def.quoi}
          </p>
          {attente.ordre === "decoller" ? (
            <p className="text-warn">
              Les moteurs vont démarrer : personne près du drone, zone dégagée.
            </p>
          ) : null}
          {attente.ordre === "aller" ? (
            <p data-drone-point className="text-muted-foreground">
              {designe
                ? `Point : ${designe.lat.toFixed(5)}, ${designe.lon.toFixed(5)}${e.depart ? ` · à ${metres(haversineKm(e.depart.lat, e.depart.lon, designe.lat, designe.lon))} du départ` : ""}`
                : `Cliquer le point sur la carte (le cercle montre le rayon permis, ${reglages.rayonKm} km).`}
            </p>
          ) : null}
          {attente.ordre === "aller" || attente.ordre === "decoller" ? (
            <label className="flex items-center gap-2 text-muted-foreground">
              Hauteur au-dessus du départ (m, {reglages.hauteurMinM} à {reglages.hauteurMaxM})
              <Input
                data-drone-hauteur
                className="h-7 w-20"
                inputMode="decimal"
                value={attente.hauteur}
                onChange={(ev) => setAttente({ ...attente, hauteur: ev.target.value })}
              />
            </label>
          ) : null}
          <div className="flex gap-1">
            <Button
              data-drone-envoyer
              size="sm"
              disabled={occupe || (attente.ordre === "aller" && !designe)}
              onClick={() => void envoyer()}
            >
              {occupe ? "Envoi…" : "Confirmer l'ordre"}
            </Button>
            <Button size="sm" variant="ghost" disabled={occupe} onClick={fermer}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
      {resultat ? (
        <p
          data-drone-resultat={resultat.ok ? "envoye" : "pas-parti"}
          className={resultat.ok ? "text-ok" : "text-warn"}
        >
          {resultat.ok ? "Envoyé" : "Pas parti"} — {resultat.suite.join(" · ")}
        </p>
      ) : null}
    </li>
  );
}

export function DronesPilote() {
  const drones = useSyncExternalStore(subscribeDrones, dronesSnapshot, dronesServerSnapshot);
  const suivi = useSyncExternalStore(subscribeSuivi, suiviSnapshot, suiviServeur);
  const { isSuperadmin } = useStaff();
  const [ouvert, setOuvert] = useState(true);
  const lies = drones.filter((d) => d.liaison);
  if (lies.length === 0 || !suivi.reglages) return null;
  const reglages = suivi.reglages;
  return (
    <div data-drones-pilote className="shrink-0 border-b border-border font-mono">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground hover:text-fg"
        onClick={() => setOuvert(!ouvert)}
        aria-expanded={ouvert}
      >
        <span>Nos drones · liaison</span>
        <Badge tone="default">{lies.length}</Badge>
      </button>
      {ouvert ? (
        <>
          <ul className="divide-y divide-border/60 border-t border-border/60">
            {lies.map((d) => {
              const e = suivi.etats.find((x) => x.id === d.id);
              return e ? (
                <Fiche
                  key={d.id}
                  drone={d}
                  e={e}
                  a={suivi.a}
                  reglages={reglages}
                  chef={isSuperadmin}
                  designe={suivi.designe}
                />
              ) : null;
            })}
          </ul>
          <p className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
            {isSuperadmin
              ? "Ordres du chef, vérifiés par le poste puis envoyés sur la liaison du drone, tous au journal. Aucun ordre de charge utile n'existe."
              : "Les ordres sont réservés au chef de division."}
          </p>
        </>
      ) : null}
    </div>
  );
}
