/**
 * L'image de NOS sources (drone, caméra de site) en fond de carte. Le chef la cale de deux façons :
 * en cliquant sur la carte les quatre coins où l'image tombe au sol, ou — pour un drone relié — en
 * laissant le poste calculer l'emprise de sa télémétrie (caméra à la verticale). C'est une image de
 * terrain sous les pistes : le poste n'y cherche ni n'y identifie personne.
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
import { effectiveUrl } from "@/lib/vigilair/drones-core";
import { etatFond, NOMS_COINS } from "@/lib/vigilair/drones-dessin";
import {
  CHAMP_DEFAUT_DEG,
  CHAMP_MAX_DEG,
  CHAMP_MIN_DEG,
  refusCoins,
  type Coins,
  type PointGeo,
} from "@/lib/vigilair/drones-fond";
import {
  calerSource,
  reglerFond,
  releverImageFond,
  subscribeSuivi,
  suiviServeur,
  suiviSnapshot,
} from "@/lib/vigilair/drones-suivi";
import { useStaff } from "@/lib/vigilair/staff-context";
import { useVigilair } from "@/lib/vigilair/store";

const heure = (a: number): string => `${new Date(a).toISOString().slice(11, 19)} Z`;

function Fiche({
  source,
  chef,
  enCours,
}: {
  source: OwnDrone;
  chef: boolean;
  /** Les coins déjà cliqués, si c'est cette source qu'on cale. */
  enCours: PointGeo[] | null;
}) {
  const setCopTool = useVigilair((s) => s.setCopTool);
  const [champ, setChamp] = useState(
    String(source.fond?.mode === "drone" ? source.fond.champDeg : CHAMP_DEFAUT_DEG),
  );
  const [dit, setDit] = useState<{ ok: boolean; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const etat = etatFond(source);
  const fond = source.fond;
  const non = enCours?.length === 4 ? refusCoins(enCours) : null;

  const cesser = () => {
    calerSource(null);
    setCopTool("lock");
  };
  const relever = async () => {
    setOccupe(true);
    const erreur = await releverImageFond(source);
    setOccupe(false);
    setDit(erreur ? { ok: false, texte: erreur } : null);
  };
  const commencer = () => {
    setDit(null);
    calerSource(source.id);
    setCopTool("coins");
    // Sans image sous les yeux, rien à caler : on la relève tout de suite.
    if (!etat) void relever();
  };
  /** Règle le fond ; réussi, relève l'image aussitôt pour que la carte la montre. */
  const regler = async (quoi: string, calage: Parameters<typeof reglerFond>[1]) => {
    setOccupe(true);
    const erreur = await reglerFond(source.id, calage);
    if (!erreur) cesser();
    const sansImage =
      !erreur && calage ? await releverImageFond({ ...source, fond: calage }) : null;
    setOccupe(false);
    setDit(
      erreur
        ? { ok: false, texte: erreur }
        : { ok: true, texte: sansImage ? `${quoi} — image pas encore reçue : ${sansImage}` : quoi },
    );
  };

  return (
    <li data-fond-source={source.id} className="space-y-1.5 px-3 py-2 text-[11px]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-fg">{source.name}</span>
        <span data-fond-etat className="text-muted-foreground">
          {!fond
            ? "pas en fond de carte"
            : fond.mode === "coins"
              ? "quatre coins posés à la main"
              : `emprise calculée du drone, champ de ${fond.champDeg}°`}
          {etat ? ` · image de ${heure(etat.a)}` : " · pas encore d'image reçue"}
        </span>
      </div>
      {fond && etat && !etat.posee ? (
        <p data-fond-pas-posee className="text-warn">
          Image pas posée : à cette heure-là, la liaison ne donnait ni position ni cap frais du
          drone, ou il était au sol.
        </p>
      ) : null}
      {etat ? (
        <img
          src={etat.src}
          alt={`Image de ${source.name}`}
          className="max-h-24 rounded-sm border border-border"
        />
      ) : null}
      {enCours ? (
        <div data-fond-calage className="space-y-1.5 rounded-sm border border-border bg-bg/70 p-2">
          <p data-fond-coins-dit className={non ? "text-warn" : "text-fg"}>
            {enCours.length < 4
              ? `Cliquer sur la carte le coin ${NOMS_COINS[enCours.length]} de l'image (${enCours.length + 1}/4).`
              : (non ?? "Quatre coins posés : l'image est tendue à l'essai sur la carte.")}
          </p>
          <div className="flex flex-wrap gap-1">
            <Button
              data-fond-enregistrer
              size="sm"
              disabled={occupe || enCours.length < 4 || non !== null}
              onClick={() =>
                void regler("image posée en fond de carte", {
                  mode: "coins",
                  coins: enCours as Coins,
                })
              }
            >
              Enregistrer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={occupe}
              onClick={() => calerSource(source.id)}
            >
              Reprendre
            </Button>
            <Button size="sm" variant="ghost" disabled={occupe} onClick={cesser}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            data-fond-relever
            size="sm"
            variant="outline"
            disabled={occupe}
            onClick={() => void relever()}
          >
            Relever l'image
          </Button>
          {chef ? (
            <Button
              data-fond-poser
              size="sm"
              variant="outline"
              disabled={occupe}
              onClick={commencer}
            >
              Poser les 4 coins
            </Button>
          ) : null}
          {chef && fond ? (
            <Button
              data-fond-retirer
              size="sm"
              variant="ghost"
              disabled={occupe}
              onClick={() => void regler("image retirée du fond de carte", null)}
            >
              Retirer
            </Button>
          ) : null}
        </div>
      )}
      {chef && !enCours && source.kind !== "camera" ? (
        <label className="flex flex-wrap items-center gap-2 text-muted-foreground">
          Caméra à la verticale, champ (°, {CHAMP_MIN_DEG} à {CHAMP_MAX_DEG})
          <Input
            data-fond-champ
            className="h-7 w-16"
            inputMode="decimal"
            value={champ}
            onChange={(ev) => setChamp(ev.target.value)}
          />
          <Button
            data-fond-drone
            size="sm"
            variant="outline"
            disabled={occupe}
            onClick={() =>
              void regler("emprise calculée depuis le drone", {
                mode: "drone",
                champDeg: Number(champ.replace(",", ".")),
              })
            }
          >
            Calculer depuis le drone
          </Button>
        </label>
      ) : null}
      {dit ? (
        <p data-fond-dit className={dit.ok ? "text-ok" : "text-warn"}>
          {dit.texte}
        </p>
      ) : null}
    </li>
  );
}

export function DronesFond() {
  const drones = useSyncExternalStore(subscribeDrones, dronesSnapshot, dronesServerSnapshot);
  const suivi = useSyncExternalStore(subscribeSuivi, suiviSnapshot, suiviServeur);
  const { isSuperadmin } = useStaff();
  const [ouvert, setOuvert] = useState(false);
  const sources = drones.filter((d) => effectiveUrl(d));
  if (sources.length === 0) return null;
  return (
    <div data-drones-fond className="shrink-0 border-b border-border font-mono">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground hover:text-fg"
        onClick={() => setOuvert(!ouvert)}
        aria-expanded={ouvert}
      >
        <span>Images en fond de carte</span>
        <Badge tone="default">
          {sources.filter((d) => d.fond).length}/{sources.length}
        </Badge>
      </button>
      {ouvert ? (
        <>
          <ul className="divide-y divide-border/60 border-t border-border/60">
            {sources.map((d) => (
              <Fiche
                key={d.id}
                source={d}
                chef={isSuperadmin}
                enCours={suivi.calage?.id === d.id ? suivi.calage.coins : null}
              />
            ))}
          </ul>
          <p className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
            Image de terrain sous les pistes, renouvelée par la veille mouvement ou à la demande ;
            le poste n'y identifie personne.{" "}
            {isSuperadmin ? "Chaque calage va au journal." : "Le calage est réservé au chef."}
          </p>
        </>
      ) : null}
    </div>
  );
}
