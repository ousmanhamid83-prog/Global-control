# AfriControl — architecture (document de reprise)

Ce fichier explique comment le poste est câblé, pour qu'un dev reprenne la main
sans fouiller tout le code. Il décrit **l'existant**, avec les repères
`fichier:ligne`. AfriControl est un poste de **réception seule** : il décode des
signaux publics (1090ES / Mode S, météo, phénomènes), il n'interroge rien et
n'émet jamais.

## Démarrer

- Node 22. `npm install`, puis `npm run dev` → le poste écoute sur le port 8080.
- Vérifs : `npx tsc --noEmit` (types) et
  `node --experimental-strip-types --test src/lib/vigilair/*.test.ts` (tests purs).
- Connexion de démonstration : `chef@vigilair.test` / `motdepasse-chef-123`.

## Le trajet d'une piste, de la source à l'écran

```
Antenne dump1090 ──TCP 30002─→ rx1090.server.ts (RxTable)  ─┐
                                                            ├─ withReceiver() ─→ LivePicture.aircraft
Réseau adsb.lol / adsb.fi ──→ live-feeds.ts (pullAdsb) ─────┘    (live-feeds.ts:626)
                                                                      │
                 LiveWatch (poll adaptatif 3–12 s) ── fetchLivePicture()
                                                                      │
                                     ingestLivePicture()  (store.ts)
                                                                      │
                                     mergeLiveTracks()  (live-adsb.ts:422) → liveTracks[]
                                                                      │
                        radar-map.tsx / ppi-radar.tsx  (<canvas>, requestAnimationFrame)
```

Deux fusions, à deux étages :
- **`withReceiver`** fusionne les deux *sources* (antenne + réseau) en une seule
  liste d'avions, dédoublonnée par adresse ICAO24.
- **`mergeLiveTracks`** fusionne cette liste avec les *pistes déjà à l'écran*
  (historique de trace, naissances, vieillissement des disparues).

## Modules clés

| Rôle | Fichier | Notes |
| --- | --- | --- |
| Décodeur Mode S / ADS-B (AVR) | `src/lib/vigilair/adsb-decode.ts` | Pur, sans import runtime → testable sous `node --test`. CRC-24, récupération d'adresse par syndrome, CPR global/local, altitudes 12/13 bits, vitesses TC19. Conforme DO-260B. |
| Redécoupage du flux TCP | `adsb-decode.ts` → `splitAvr()` | Recolle une trame coupée entre deux paquets. Testé. |
| Antenne dump1090 (client TCP) | `rx1090.server.ts` | Reconnexion backoff 2→30 s, keep-alive, timeout 90 s, garde anti-tampon, `RxTable` (positions, rejets de sauts, portée max 800 km). |
| Sources réseau + météo | `live-feeds.ts` | `pullAdsb` (cellules théâtre + continent/monde), METAR/TAF/SIGMET/SWPC/FIRMS, `withReceiver`, serveurs de fonctions (`fetchLivePicture`, archives, phonie, Sentinel). |
| Image live → pistes | `live-adsb.ts` | `mergeLiveTracks`, `liveAcToTrack`, allocation OACI 24 bits, `FriendKind`. |
| État global | `store.ts` (zustand `useVigilair`) | `ingestLivePicture`, verrou auto (`auto-lock.ts`), alertes, `applySim` (boucle rAF), rejeu. |
| Rendu carte COP | `components/vigilair/radar-map.tsx` | Canvas, tuiles via `/api/tile`, glyphes APP-6, désencombrement grandes échelles. |
| Rendu PPI | `components/vigilair/ppi-radar.tsx` | Balayage, RHI, portées jusqu'à 20 000 km. |

## Fusion réseau + antenne — `withReceiver` (`live-feeds.ts:626`)

- `live` (l.628) : l'antenne ne compte que branchée, connectée **et** < 60 s de silence.
- La **position/vitesse** viennent de l'antenne quand elle entend l'avion ; le
  **type ICAO / immat / militaire / catégorie** restent ceux du réseau (l.648-655).

**Invariants à protéger (passe anti-bugs) :**
1. Clé de dédup = `hex`. Les deux sources doivent normaliser l'ICAO24 en
   **minuscules** (`parseDump1090` et `RxTable`). → test d'invariant.
2. La position antenne prime toujours quand elle existe. Pour départager par
   fraîcheur réelle, comparer `a.seenS` vs `n.seenS` à la l.648.
3. Deux seuils de fraîcheur coexistent : `live` à 60 s ici, `POS_MAX_AGE_MS`
   à 20 s dans `rx1090.server.ts`. Normal, mais à garder en tête.

## Fusion avec l'écran — `mergeLiveTracks` (`live-adsb.ts:422`)

Ordre : index des pistes ADS-B existantes par hex (l.427) → maj / naissance des
entrantes (l.435) → vieillissement des non-entendues : < 45 s gardées, sinon
`idState: "perdu"` (l.445) → sortie = vivantes + périmées-non-perdues + le reste
(`feed !== "adsb"`, l.455).

**Invariants à protéger (passe anti-bugs) :**
1. `t.id.slice(5)` suppose le préfixe `live-` (5 car.). Le plus fragile. →
   test : `id === "live-" + hex`.
2. `mergeLiveTracks` suppose `incoming` déjà dédoublonné (c'est `withReceiver`
   qui l'a fait) ; le `seen` ne protège que le lot courant.
3. Le seuil 45 s doit rester cohérent avec `FRESH_MS` / `RX_STALE_MS`.

`mergeLiveTracks` est **pure** → testable directement. Cas utiles :
naissance, mise à jour, passage « perdu » à 45 s, hex vu deux fois, conservation
des pistes non-ADS-B.

## Rendu carte / PPI — leviers de perf

Boucle `requestAnimationFrame` : fond (tuiles) → anneaux → boucle sur les pistes
(un glyphe APP-6 chacune) → libellés. Désencombrement déjà présent
(`radar-map.tsx:1017`, `wide` = aes/sahel/monde ; `quiet` masque les labels calmes).

Leviers, par rendement décroissant :
1. **Flag `dirty`** : ne redessiner que si position/sélection/échelle ont changé.
2. **Culling écran** : sauter les pistes hors du canvas (+ marge).
3. **Budget de libellés** par frame (proches / verrouillés d'abord) — le texte
   canvas est le plus cher.
4. **Mémoriser les projections** lat/lon→pixel tant que centre/échelle ne bougent pas.
5. **Mesurer d'abord** (`performance.now()` autour de la boucle, onglet Performance).

Banc d'essai : activer le **balayage continental** (chef) → ~2 700 pistes réelles.
`screenshots/sweepon.mjs` pilote l'état depuis Playwright.

## Garde-fous

- `tsc` + tests purs après chaque modif. Ajouter un test **avant** de toucher une
  fonction pure (`mergeLiveTracks`, `splitAvr`, le décodeur) : c'est le filet.
- Le rendu n'a pas de test unitaire : vérifier à l'œil (`npm run dev` + balayage).

## Principe tenu partout : honnêteté des données

Rien n'est affiché comme « live » ou « réel » s'il ne l'est pas. Les injects sont
des exercices, le rejeu porte son heure d'origine, l'imagerie d'archive est
créditée comme telle, et les sources externes sont interrogées **par le serveur**
(l'IP de l'opérateur n'est pas exposée aux agrégateurs).
