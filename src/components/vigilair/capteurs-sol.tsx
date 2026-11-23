import { useState, useSyncExternalStore } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addSensor,
  newSensorKey,
  removeSensor,
  sensorsHeureServeur,
  sensorsServerSnapshot,
  sensorsSnapshot,
  subscribeSensors,
  type GroundSensorVue,
  type SensorType,
} from "@/lib/vigilair/ground-sensors";
import {
  libelleType,
  SILENCE_DEFAUT_S,
  silenceValide,
  type CodeEtat,
} from "@/lib/vigilair/ground-sensors-core";
import { useStaff } from "@/lib/vigilair/staff-context";

const ETAT: Record<CodeEtat, { tone: "default" | "ok" | "warn" | "crit"; texte: string }> = {
  jamais: { tone: "default", texte: "jamais entendu" },
  muet: { tone: "crit", texte: "muet" },
  ok: { tone: "ok", texte: "ok" },
  alarme: { tone: "crit", texte: "alarme" },
  hs: { tone: "warn", texte: "hors service" },
};

function ilYa(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}

type CleMontree = { id: string; nom: string; cle: string; silenceS: number };

/** Ce que le chef remet au capteur : sa clé, et les deux façons de dire son état. */
function CleDuCapteur({ c, fermer }: { c: CleMontree; fermer: () => void }) {
  const base = `${window.location.origin}/api/capteur-sol`;
  return (
    <div
      data-sensor-cle
      className="space-y-1.5 rounded-sm border border-warn/40 bg-warn/10 p-2 text-[11px]"
    >
      <p className="text-fg">
        Clé du capteur « {c.nom} » : notez-la maintenant. Le poste n'en garde que l'empreinte et ne
        la remontrera pas.
      </p>
      <code className="block break-all rounded-sm bg-bg px-2 py-1 font-mono text-fg">{c.cle}</code>
      <p className="text-muted-foreground">
        Le capteur ou sa passerelle dit son état depuis le réseau du poste (etat : ok, alarme ou hs
        ; « ok » à redire au moins toutes les {Math.max(5, Math.floor(c.silenceS / 2))} s) :
      </p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-bg px-2 py-1 font-mono text-fg">
        {`curl -sS -X POST ${base} -H "Authorization: Bearer ${c.cle}" -H "Content-Type: application/json" -d '{"id":"${c.id}","etat":"alarme","detail":"zone 2"}'`}
      </pre>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-bg px-2 py-1 font-mono text-fg">
        {`${base}?id=${encodeURIComponent(c.id)}&etat=ok&cle=${c.cle}`}
      </pre>
      <Button size="sm" variant="ghost" onClick={fermer}>
        Masquer la clé
      </Button>
    </div>
  );
}

/**
 * Capteurs SOL (périmètre) : l'état affiché est celui que le capteur a dit lui-même au poste.
 * Inscrire, changer une clé, retirer : le chef de division.
 */
export function CapteursSol() {
  const sensors = useSyncExternalStore(subscribeSensors, sensorsSnapshot, sensorsServerSnapshot);
  const { isSuperadmin } = useStaff();
  const [site, setSite] = useState("");
  const [type, setType] = useState<SensorType>("camera");
  const [nom, setNom] = useState("");
  const [silence, setSilence] = useState(String(SILENCE_DEFAUT_S));
  const [erreur, setErreur] = useState<string | null>(null);
  const [cle, setCle] = useState<CleMontree | null>(null);
  const heure = sensorsHeureServeur();

  const inscrire = async () => {
    setErreur(null);
    const r = await addSensor(site, type, nom, Number(silence));
    if (!r.ok || !r.cle || !r.id) {
      setErreur(r.error ?? "inscription refusée");
      return;
    }
    setCle({ id: r.id, nom: nom.trim(), cle: r.cle, silenceS: silenceValide(silence) });
    setNom("");
  };
  const changerCle = async (s: GroundSensorVue) => {
    setErreur(null);
    const r = await newSensorKey(s.id);
    if (!r.ok || !r.cle) setErreur(r.error ?? "clé non changée");
    else setCle({ id: s.id, nom: s.name, cle: r.cle, silenceS: s.silenceS });
  };
  const retirer = async (s: GroundSensorVue) => {
    setErreur(null);
    const r = await removeSensor(s.id);
    if (!r.ok) setErreur(r.error ?? "capteur non retiré");
    if (cle?.id === s.id) setCle(null);
  };

  return (
    <div className="space-y-2 rounded-sm border border-border bg-bg/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-fg">Capteurs sol (périmètre)</h3>
        <Badge tone="default">{sensors.length}</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Caméra, barrière, radar sol : chacun dit lui-même son état au poste, avec sa clé. « OK » ne
        s'affiche que s'il l'a dit dans son délai de silence ; au-delà, il est MUET (câble, courant,
        panne) et le chef est prévenu, console fermée aussi. Une alarme ou une panne dite par le
        capteur sonne au bandeau et part au relais du chef.
      </p>
      {isSuperadmin ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_6rem_auto]">
          <Input
            data-sensor="site"
            placeholder="Site (ex. Camp Nord)"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          />
          <select
            data-sensor="type"
            value={type}
            onChange={(e) => setType(e.target.value as SensorType)}
            className="rounded-sm border border-border bg-bg px-2 py-1.5 text-sm text-fg"
          >
            <option value="camera">Caméra</option>
            <option value="barriere">Barrière</option>
            <option value="radar">Radar</option>
            <option value="autre">Autre</option>
          </select>
          <Input
            data-sensor="name"
            placeholder="Nom du capteur"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
          <Input
            data-sensor="silence"
            inputMode="numeric"
            aria-label="Délai de silence (s)"
            title="Délai de silence (s) : au-delà, le capteur est muet"
            value={silence}
            onChange={(e) => setSilence(e.target.value)}
          />
          <Button data-sensor="add" size="sm" variant="outline" onClick={() => void inscrire()}>
            <Plus className="mr-1 size-3.5" />
            Inscrire
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Inscrire un capteur ou changer sa clé : chef de division.
        </p>
      )}
      {erreur ? <p className="text-[11px] text-crit">{erreur}</p> : null}
      {cle ? <CleDuCapteur c={cle} fermer={() => setCle(null)} /> : null}
      {sensors.length > 0 ? (
        <ul className="divide-y divide-border rounded-sm border border-border">
          {sensors.map((s) => {
            const e = ETAT[s.etat.code];
            return (
              <li
                key={s.id}
                data-sensor-row={s.id}
                data-sensor-etat={s.etat.code}
                className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs"
              >
                <Badge tone={e.tone}>{e.texte}</Badge>
                <span className="text-fg">{s.name}</span>
                <span className="text-muted-foreground">
                  {libelleType(s.type)} · {s.site}
                  {s.dernier !== null ? ` · dernier message ${ilYa(heure - s.dernier)}` : ""}
                  {s.detail ? ` · « ${s.detail} »` : ""}
                  {s.aCle ? "" : " · sans clé : il ne peut rien dire"}
                </span>
                {isSuperadmin ? (
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      data-sensor-nouvelle-cle={s.id}
                      size="sm"
                      variant="ghost"
                      onClick={() => void changerCle(s)}
                    >
                      <KeyRound className="mr-1 size-3.5" />
                      Nouvelle clé
                    </Button>
                    <Button
                      data-sensor-retirer={s.id}
                      size="sm"
                      variant="ghost"
                      onClick={() => void retirer(s)}
                      aria-label={`retirer ${s.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
