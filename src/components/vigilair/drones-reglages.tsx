/**
 * Réglages du pilotage de NOS drones, par le chef de division : la liaison de chaque drone, son
 * circuit de patrouille, les ordres permis, le rayon et les hauteurs. Les agents lisent, sans régler.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  dronesServerSnapshot,
  dronesSnapshot,
  subscribeDrones,
  type OwnDrone,
} from "@/lib/vigilair/drones";
import { ORDRES_DRONE, type ReglagesPilotage } from "@/lib/vigilair/drones-pilotage";
import {
  confirmerPiste1090,
  reglerLiaison,
  reglerPatrouille,
  reglerPilotage,
  subscribeSuivi,
  suiviServeur,
  suiviSnapshot,
} from "@/lib/vigilair/drones-suivi";
import { useStaff } from "@/lib/vigilair/staff-context";

const nombre = (s: string): number => Number(s.trim().replace(",", "."));

/** « 12.1345, 15.0345 » par ligne → points ; null si une ligne ne se lit pas. */
function lirePoints(texte: string): { lat: number; lon: number }[] | null {
  const points = [];
  for (const ligne of texte
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const m = ligne.match(/^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/);
    if (!m) return null;
    points.push({ lat: nombre(m[1]!), lon: nombre(m[2]!) });
  }
  return points;
}

function FicheDrone({
  drone,
  chef,
  maintenant,
}: {
  drone: OwnDrone;
  chef: boolean;
  maintenant: number;
}) {
  const [liaison, setLiaison] = useState(drone.liaison ?? "");
  const [secours, setSecours] = useState(drone.liaisonSecours ?? "");
  const [points, setPoints] = useState(
    (drone.patrouille?.points ?? []).map((p) => `${p.lat}, ${p.lon}`).join("\n"),
  );
  const [hauteur, setHauteur] = useState(String(drone.patrouille?.hauteurM ?? 40));
  const [tours, setTours] = useState(String(drone.patrouille?.tours ?? 1));
  const [dit, setDit] = useState<{ ok: boolean; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  // L'heure du poste, comme pour les battements ; avant le premier relevé, celle de la console.
  const confirmee = (drone.ami1090Jusqua ?? 0) > (maintenant || Date.now());

  const faire = async (quoi: string, appel: () => Promise<string | null>) => {
    setOccupe(true);
    const erreur = await appel();
    setOccupe(false);
    setDit(erreur ? { ok: false, texte: erreur } : { ok: true, texte: quoi });
  };
  const circuit = () => {
    const lus = lirePoints(points);
    if (!lus)
      return setDit({
        ok: false,
        texte: "un point par ligne : latitude, longitude (degrés décimaux)",
      });
    if (lus.length === 0)
      return void faire("circuit retiré", () => reglerPatrouille(drone.id, null));
    void faire("circuit réglé", () =>
      reglerPatrouille(drone.id, { points: lus, hauteurM: nombre(hauteur), tours: nombre(tours) }),
    );
  };

  return (
    <li data-drone-reglage={drone.id} className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-fg">{drone.name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{drone.ident}</span>
        <Badge tone={drone.liaison ? "ok" : "default"}>
          {drone.liaison ? "liaison réglée" : "sans liaison"}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-drone-liaison
          className="max-w-xs font-mono text-xs"
          placeholder="tcp://192.168.1.20:5760 ou udp://192.168.1.20:14550"
          value={liaison}
          disabled={!chef}
          onChange={(e) => setLiaison(e.target.value)}
        />
        <Button
          data-drone-liaison-regler
          size="sm"
          variant="outline"
          disabled={!chef || occupe || liaison.trim() === (drone.liaison ?? "")}
          onClick={() =>
            void faire(liaison.trim() ? "liaison réglée" : "liaison retirée", () =>
              reglerLiaison(drone.id, liaison),
            )
          }
        >
          {liaison.trim() ? "Régler la liaison" : "Retirer la liaison"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-drone-liaison-secours
          className="max-w-xs font-mono text-xs"
          placeholder="secours : serie:///dev/ttyUSB0?debit=57600 (radio de télémétrie)"
          value={secours}
          disabled={!chef}
          onChange={(e) => setSecours(e.target.value)}
        />
        <Button
          data-drone-liaison-secours-regler
          size="sm"
          variant="outline"
          disabled={!chef || occupe || secours.trim() === (drone.liaisonSecours ?? "")}
          onClick={() =>
            void faire(
              secours.trim() ? "liaison de secours réglée" : "liaison de secours retirée",
              () => reglerLiaison(drone.id, secours, true),
            )
          }
        >
          {secours.trim() ? "Régler le secours" : "Retirer le secours"}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <textarea
          data-drone-circuit
          className="min-h-[4.5rem] rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg"
          placeholder={
            "Circuit de patrouille, un point par ligne :\n12.1345, 15.0345\n12.1345, 15.0360"
          }
          value={points}
          disabled={!chef}
          onChange={(e) => setPoints(e.target.value)}
        />
        <div className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
          <label className="flex items-center justify-between gap-2">
            Hauteur (m)
            <Input
              data-drone-circuit-hauteur
              className="h-7 w-16"
              inputMode="decimal"
              value={hauteur}
              disabled={!chef}
              onChange={(e) => setHauteur(e.target.value)}
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Tours
            <Input
              data-drone-circuit-tours
              className="h-7 w-16"
              inputMode="numeric"
              value={tours}
              disabled={!chef}
              onChange={(e) => setTours(e.target.value)}
            />
          </label>
          <Button
            data-drone-circuit-regler
            size="sm"
            variant="outline"
            disabled={!chef || occupe}
            onClick={circuit}
          >
            Régler le circuit
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span data-drone-1090>
          Piste 1090ES à son adresse ({drone.ident}) :{" "}
          {confirmee ? (
            <span className="text-ok">
              confirmée par le chef jusqu'à{" "}
              {new Date(drone.ami1090Jusqua!).toISOString().slice(11, 16)} Z — amie
            </span>
          ) : (
            <span className="text-warn">
              non confirmée — elle compte comme une intrusion, et le chef est averti
            </span>
          )}
        </span>
        <Button
          data-drone-1090-confirmer
          size="sm"
          variant="outline"
          disabled={!chef || occupe}
          onClick={() =>
            void faire(confirmee ? "confirmation retirée" : "piste confirmée pour 2 h", () =>
              confirmerPiste1090(drone.id, !confirmee),
            )
          }
        >
          {confirmee ? "Retirer la confirmation" : "Confirmer (2 h)"}
        </Button>
      </div>
      {dit ? (
        <p
          data-drone-reglage-dit
          className={dit.ok ? "text-[11px] text-ok" : "text-[11px] text-warn"}
        >
          {dit.texte}
        </p>
      ) : null}
    </li>
  );
}

function Pilotage({ reglages, chef }: { reglages: ReglagesPilotage; chef: boolean }) {
  const [r, setR] = useState(reglages);
  const [rayon, setRayon] = useState(String(reglages.rayonKm));
  const [min, setMin] = useState(String(reglages.hauteurMinM));
  const [max, setMax] = useState(String(reglages.hauteurMaxM));
  const [dit, setDit] = useState<{ ok: boolean; texte: string } | null>(null);
  // Les réglages du poste font foi : relus après un enregistrement (bornés par lui) ou un autre chef.
  useEffect(() => {
    setR(reglages);
    setRayon(String(reglages.rayonKm));
    setMin(String(reglages.hauteurMinM));
    setMax(String(reglages.hauteurMaxM));
  }, [reglages]);

  const enregistrer = async () => {
    const erreur = await reglerPilotage({
      ordres: r.ordres,
      rayonKm: nombre(rayon),
      hauteurMinM: nombre(min),
      hauteurMaxM: nombre(max),
    });
    setDit(
      erreur
        ? { ok: false, texte: erreur }
        : { ok: true, texte: "pilotage réglé, noté au journal" },
    );
  };

  return (
    <div data-drones-pilotage className="space-y-2 border-t border-border px-3 py-2">
      <p className="text-[11px] text-muted-foreground">
        Ordres permis au chef (un ordre décoché n'est plus envoyé par personne) :
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {ORDRES_DRONE.map((o) => (
          <label key={o.id} className="flex items-center gap-1.5 text-fg" title={o.quoi}>
            <input
              type="checkbox"
              data-drone-permis={o.id}
              checked={r.ordres[o.id]}
              disabled={!chef}
              onChange={(e) => setR({ ...r, ordres: { ...r.ordres, [o.id]: e.target.checked } })}
            />
            {o.nom}
            {o.sceau ? <span className="text-muted-foreground">(sceau)</span> : null}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <label className="flex items-center gap-1.5">
          Rayon permis autour du départ (km)
          <Input
            data-drone-rayon
            className="h-7 w-16"
            inputMode="decimal"
            value={rayon}
            disabled={!chef}
            onChange={(e) => setRayon(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5">
          Hauteurs (m) de
          <Input
            data-drone-hmin
            className="h-7 w-16"
            inputMode="decimal"
            value={min}
            disabled={!chef}
            onChange={(e) => setMin(e.target.value)}
          />
          à
          <Input
            data-drone-hmax
            className="h-7 w-16"
            inputMode="decimal"
            value={max}
            disabled={!chef}
            onChange={(e) => setMax(e.target.value)}
          />
        </label>
        <Button
          data-drone-pilotage-regler
          size="sm"
          variant="outline"
          disabled={!chef}
          onClick={() => void enregistrer()}
        >
          Enregistrer
        </Button>
      </div>
      {dit ? (
        <p
          data-drone-pilotage-dit
          className={dit.ok ? "text-[11px] text-ok" : "text-[11px] text-warn"}
        >
          {dit.texte}
        </p>
      ) : null}
    </div>
  );
}

export function DronesReglages() {
  const drones = useSyncExternalStore(subscribeDrones, dronesSnapshot, dronesServerSnapshot);
  const suivi = useSyncExternalStore(subscribeSuivi, suiviSnapshot, suiviServeur);
  const { isSuperadmin } = useStaff();
  const nos = drones.filter((d) => d.kind !== "camera");
  if (nos.length === 0) return null;
  return (
    <div data-drones-reglages className="space-y-2 rounded-sm border border-border bg-bg/40">
      <div className="space-y-1 px-3 pt-3">
        <h3 className="text-sm font-medium text-fg">Pilotage de nos drones (chef de division)</h3>
        <p className="text-[11px] text-muted-foreground">
          Par sa <strong>liaison MAVLink</strong> (sur le réseau du poste seulement), AfriControl
          suit un drone et le chef peut lui envoyer six ordres :{" "}
          <strong>retour à la base, stationnaire, atterrir</strong> ; et, avec son sceau,{" "}
          <strong>décoller, aller à un point, patrouille</strong>. Le poste vérifie avant d'envoyer
          (drone en vol, point dans le rayon, hauteur dans les bornes) et note tout au journal. Les
          moteurs ne sont armés que par « décoller » ;{" "}
          <strong>aucun ordre de charge utile n'existe</strong>. Essayé sur multirotor ArduPilot ;
          un drone PX4 ou un avion est suivi, pas piloté ; DJI et les drones à station propre ne
          parlent pas MAVLink.
          {isSuperadmin ? "" : " Réglages réservés au chef de division."}
        </p>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {nos.map((d) => (
          <FicheDrone key={d.id} drone={d} chef={isSuperadmin} maintenant={suivi.a} />
        ))}
      </ul>
      {suivi.reglages ? <Pilotage reglages={suivi.reglages} chef={isSuperadmin} /> : null}
    </div>
  );
}
