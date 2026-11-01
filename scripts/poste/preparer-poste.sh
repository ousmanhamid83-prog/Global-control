#!/usr/bin/env bash
# Prépare le poste AfriControl en une commande. À lancer UNE FOIS EN LIGNE, depuis le dossier
# AfriControl ; ensuite tout tourne hors ligne. Les réglages vont dans poste.env, que le serveur
# lit seul au démarrage (src/lib/config-poste.ts).
#
#   bash scripts/poste/preparer-poste.sh                         IA + relief + serveur construit
#   bash scripts/poste/preparer-poste.sh --itineraire --signal   + itinéraire et relais Signal
#
#   --modele NOM     modèle d'IA (défaut selon la mémoire : qwen2.5:7b dès 15 Go, qwen2.5:3b dès
#                    7 Go, sinon qwen2.5:1.5b)
#   --zone S,N,O,E   relief sur cette zone, en degrés entiers (défaut : le Tchad, 7,23,13,23 —
#                    187 tuiles, 862 Mo)
#   --itineraire     serveur d'itinéraire OSRM du poste (Docker, carte OSM du Tchad, 151 Mo)
#   --signal         relais Signal du poste (Docker) : le détail des alertes, chiffré jusqu'aux
#                    téléphones des destinataires
#   --sans-build  --sans-ia  --sans-relief    sauter une étape
#
# Relancer le script reprend là où il s'était arrêté : ce qui est déjà en place est gardé.
set -euo pipefail

cd "$(dirname "$0")/../.."
RACINE=$PWD
POSTE_ENV=$RACINE/poste.env
OSRM_IMAGE=ghcr.io/project-osrm/osrm-backend:v26.11.0-debian
SIGNAL_IMAGE=bbernhard/signal-cli-rest-api:0.101

MODELE=""
ZONE="7,23,13,23"
BUILD=1 IA=1 RELIEF=1 ITINERAIRE=0 SIGNAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --modele) MODELE=${2:?--modele attend un nom de modèle}; shift ;;
    --zone) ZONE=${2:?--zone attend S,N,O,E}; shift ;;
    --itineraire) ITINERAIRE=1 ;;
    --signal) SIGNAL=1 ;;
    --sans-build) BUILD=0 ;;
    --sans-ia) IA=0 ;;
    --sans-relief) RELIEF=0 ;;
    -h | --help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1 (voir --help)" >&2; exit 2 ;;
  esac
  shift
done

BILAN=()
A_FAIRE=()
etape() { printf '\n== %s\n' "$*"; }
ok() { BILAN+=("  ✓ $*"); echo "  ✓ $*"; }
rate() { BILAN+=("  ✗ $*"); echo "  ✗ $*" >&2; }

# attendre <commande> <secondes> : réessaie la commande chaque seconde jusqu'au délai.
attendre() {
  local i
  for ((i = 0; i < $2; i++)); do
    if "$1"; then return 0; fi
    sleep 1
  done
  return 1
}

# regler CLE valeur : écrit ou remplace la ligne CLE= de poste.env (les autres lignes restent).
regler() {
  if [ ! -f "$POSTE_ENV" ]; then
    printf '# Réglages du poste AfriControl, lus au démarrage du serveur.\n# Écrit par scripts/poste/preparer-poste ; une variable posée au lancement garde la main.\n' >"$POSTE_ENV"
    chmod 600 "$POSTE_ENV"
  fi
  awk -v cle="$1" -v valeur="$2" '
    index($0, cle "=") == 1 { if (!fait) print cle "=" valeur; fait = 1; next }
    { print }
    END { if (!fait) print cle "=" valeur }
  ' "$POSTE_ENV" >"$POSTE_ENV.tmp"
  cat "$POSTE_ENV.tmp" >"$POSTE_ENV"
  rm -f "$POSTE_ENV.tmp"
}

# telecharger <fichier> <adresse>… : première adresse qui répond ; reprise d'un .part interrompu.
telecharger() {
  local fichier=$1 adresse
  shift
  for adresse in "$@"; do
    echo "  téléchargement : $adresse"
    if curl -fL --retry 3 --retry-delay 3 -C - -o "$fichier.part" "$adresse"; then
      mv "$fichier.part" "$fichier"
      return 0
    fi
  done
  return 1
}

docker_pret() { command -v docker >/dev/null && docker info >/dev/null 2>&1; }
# Une image déjà là n'est pas retéléchargée : relancer le script hors ligne reste possible.
image_presente() { docker image inspect "$1" >/dev/null 2>&1; }

# installer_paquet <nom> : par apt (Debian, Ubuntu) ou dnf (Fedora, RHEL).
installer_paquet() {
  local sudo=""
  if [ "$(id -u)" != 0 ]; then sudo=sudo; fi
  if command -v apt-get >/dev/null; then
    $sudo apt-get install -y "$1" || { $sudo apt-get update && $sudo apt-get install -y "$1"; }
  elif command -v dnf >/dev/null; then
    $sudo dnf install -y "$1"
  else
    return 1
  fi
}

etape "Node"
if ! command -v node >/dev/null; then
  echo "Node 22 ou plus est requis : https://nodejs.org/fr/download" >&2
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "Node $(node -v) est trop ancien : 22 ou plus est requis (https://nodejs.org/fr/download)." >&2
  exit 1
fi
ok "Node $(node -v)"

if [ "$BUILD" = 1 ]; then
  etape "Serveur AfriControl (dépendances, build autonome)"
  if ! npm ci --no-audit --no-fund || ! NITRO_PRESET=node-server npm run build; then
    echo "Le build a échoué (messages ci-dessus) : vérifier la connexion, puis relancer le script." >&2
    exit 1
  fi
  ok "serveur construit : .output/server/index.mjs"
fi

ia_repond() { curl -fsS -m 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; }

if [ "$IA" = 1 ]; then
  etape "IA du poste (Ollama, sur cette machine)"
  if ! command -v ollama >/dev/null; then
    # L'installeur officiel exige zstd, absent de bien des installations neuves.
    if ! command -v zstd >/dev/null; then
      echo "  installation de zstd (l'installeur d'Ollama en a besoin)…"
      installer_paquet zstd || true
    fi
    echo "  installation d'Ollama (script officiel d'ollama.com)…"
    curl -fsSL https://ollama.com/install.sh | sh || true
  fi
  if command -v ollama >/dev/null && ! ia_repond; then
    if [ -d /run/systemd/system ]; then
      if [ "$(id -u)" = 0 ]; then systemctl start ollama || true; else sudo systemctl start ollama || true; fi
    fi
    if ! ia_repond; then
      mkdir -p data
      nohup ollama serve >>data/ollama.log 2>&1 &
      A_FAIRE+=("Ollama n'a pas de service système ici : relancer « ollama serve » après un redémarrage.")
    fi
  fi
  if ! command -v ollama >/dev/null; then
    rate "IA : Ollama n'a pas pu être installé (messages ci-dessus)"
  elif ! attendre ia_repond 60; then
    rate "IA : Ollama ne répond pas sur 127.0.0.1:11434 (voir data/ollama.log)"
  else
    if [ -z "$MODELE" ]; then
      memoire=$(awk '/^MemTotal:/ { printf "%d", $2 / 1048576 + 0.5 }' /proc/meminfo)
      if [ "$memoire" -ge 15 ]; then
        MODELE=qwen2.5:7b
      elif [ "$memoire" -ge 7 ]; then
        MODELE=qwen2.5:3b
      else
        MODELE=qwen2.5:1.5b
      fi
      echo "  mémoire : $memoire Go → modèle $MODELE"
    fi
    if ! ollama pull "$MODELE"; then
      rate "IA : le modèle $MODELE n'a pas pu être téléchargé — relancer le script pour reprendre"
    else
      regler AFRICONTROL_IA http://127.0.0.1:11434/v1
      regler AFRICONTROL_IA_MODELE "$MODELE"
      echo "  essai d'une réponse (le premier chargement du modèle peut prendre une minute)…"
      debut=$(date +%s)
      if reponse=$(curl -fsS -m 300 http://127.0.0.1:11434/v1/chat/completions \
        -H 'Content-Type: application/json' \
        -d "{\"model\":\"$MODELE\",\"max_tokens\":12,\"messages\":[{\"role\":\"user\",\"content\":\"Réponds seulement : prêt.\"}]}"); then
        texte=$(printf '%s' "$reponse" | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).choices[0].message.content.trim()))')
        ok "IA : $MODELE répond en $(($(date +%s) - debut)) s (« $texte »)"
      else
        rate "IA : $MODELE installé mais n'a pas répondu à l'essai (voir data/ollama.log)"
      fi
    fi
  fi
fi

if [ "$RELIEF" = 1 ]; then
  etape "Relief (tuiles Copernicus GLO-90, lues par le poste lui-même)"
  IFS=, read -r sud nord ouest est <<<"$ZONE"
  for v in "$sud" "$nord" "$ouest" "$est"; do
    if ! [[ "$v" =~ ^-?[0-9]+$ ]]; then
      echo "--zone attend quatre degrés entiers S,N,O,E (reçu : $ZONE)" >&2
      exit 2
    fi
  done
  mkdir -p data/relief
  total=$(((nord - sud + 1) * (est - ouest + 1)))
  n=0 neuves=0 mer=0 echecs=0
  for lat in $(seq "$sud" "$nord"); do
    for lon in $(seq "$ouest" "$est"); do
      n=$((n + 1))
      ns=N ew=E
      if [ "$lat" -lt 0 ]; then ns=S; fi
      if [ "$lon" -lt 0 ]; then ew=W; fi
      nom=$(printf 'Copernicus_DSM_COG_30_%s%02d_00_%s%03d_00_DEM' "$ns" "${lat#-}" "$ew" "${lon#-}")
      fichier=data/relief/$nom.tif
      if [ -f "$fichier" ]; then continue; fi
      printf '\r  tuile %d/%d ' "$n" "$total"
      code=$(curl -sL --retry 3 --retry-delay 3 -m 600 -o "$fichier.part" -w '%{http_code}' \
        "https://copernicus-dem-90m.s3.amazonaws.com/$nom/$nom.tif" 2>/dev/null) || true
      # Une vraie tuile commence par l'en-tête TIFF « II » ; un portail captif renverrait du HTML.
      if [ "$code" = 200 ] && [ "$(head -c 2 "$fichier.part")" = II ]; then
        mv "$fichier.part" "$fichier"
        neuves=$((neuves + 1))
      elif [ "$code" = 404 ]; then
        rm -f "$fichier.part" # pas de tuile : la mer
        mer=$((mer + 1))
      else
        rm -f "$fichier.part"
        echecs=$((echecs + 1))
      fi
    done
  done
  echo
  presentes=$(find data/relief -maxdepth 1 -name 'Copernicus_DSM_COG_*_DEM.tif' | wc -l)
  ok "relief : $presentes tuiles dans data/relief ($(du -sh data/relief | cut -f1)), dont $neuves téléchargées maintenant ; $mer en mer, sans tuile"
  if [ "$echecs" -gt 0 ]; then
    rate "relief : $echecs tuiles n'ont pas pu être téléchargées — relancer le script pour les reprendre"
  fi
fi

osrm_repond() {
  curl -fsS -m 5 'http://127.0.0.1:5810/route/v1/driving/15.0444,12.1067;20.8324,13.8292?overview=false' 2>/dev/null | grep -q '"code":"Ok"'
}

if [ "$ITINERAIRE" = 1 ]; then
  etape "Itinéraire (serveur OSRM du poste, carte OpenStreetMap du Tchad)"
  if ! docker_pret; then
    rate "itinéraire : Docker absent ou arrêté (https://docs.docker.com/engine/install/)"
  else
    mkdir -p data/osrm
    if [ -f data/osrm/tchad.osm.pbf ] || telecharger data/osrm/tchad.osm.pbf \
      https://download.openstreetmap.fr/extracts/africa/chad.osm.pbf \
      https://download.geofabrik.de/africa/chad-latest.osm.pbf; then
      if ! image_presente "$OSRM_IMAGE" && ! docker pull -q "$OSRM_IMAGE" >/dev/null; then
        rate "itinéraire : l'image $OSRM_IMAGE n'a pas pu être téléchargée — relancer le script"
      elif [ ! -f data/osrm/tchad.osrm.mldgr ]; then
        echo "  préparation du graphe routier (quelques minutes)…"
        for outil in "osrm-extract -p /opt/car.lua /data/tchad.osm.pbf" "osrm-partition /data/tchad.osrm" "osrm-customize /data/tchad.osrm"; do
          # shellcheck disable=SC2086 # l'outil et ses arguments, découpés exprès
          docker run --rm -v "$RACINE/data/osrm:/data" "$OSRM_IMAGE" $outil >data/osrm/preparation.log 2>&1 ||
            { rate "itinéraire : ${outil%% *} a échoué (voir data/osrm/preparation.log)"; break; }
        done
      fi
      if [ -f data/osrm/tchad.osrm.mldgr ]; then
        docker rm -f africontrol-osrm >/dev/null 2>&1 || true
        docker run -d --name africontrol-osrm --restart unless-stopped -p 127.0.0.1:5810:5000 \
          -v "$RACINE/data/osrm:/data" "$OSRM_IMAGE" osrm-routed --algorithm mld /data/tchad.osrm >/dev/null
        if attendre osrm_repond 120; then
          regler AFRICONTROL_ITINERAIRE http://127.0.0.1:5810
          km=$(curl -fsS 'http://127.0.0.1:5810/route/v1/driving/15.0444,12.1067;20.8324,13.8292?overview=false' |
            node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(Math.round(JSON.parse(s).routes[0].distance/1000)))')
          ok "itinéraire : OSRM sur 127.0.0.1:5810, redémarre avec la machine (essai N'Djamena → Abéché : $km km par la route)"
        else
          rate "itinéraire : OSRM ne répond pas sur 127.0.0.1:5810 (docker logs africontrol-osrm)"
        fi
      fi
    else
      rate "itinéraire : la carte OSM du Tchad n'a pas pu être téléchargée — relancer le script"
    fi
  fi
fi

signal_repond() { curl -fsS -m 3 http://127.0.0.1:8085/v1/about >/dev/null 2>&1; }

if [ "$SIGNAL" = 1 ]; then
  etape "Relais Signal du poste (détail des alertes, chiffré jusqu'aux téléphones)"
  if ! docker_pret; then
    rate "relais Signal : Docker absent ou arrêté (https://docs.docker.com/engine/install/)"
  else
    mkdir -p data/signal
    # Docker Hub limite les téléchargements anonymes : le miroir de Google sert la même image.
    if ! image_presente "$SIGNAL_IMAGE" && ! docker pull -q "$SIGNAL_IMAGE" >/dev/null 2>&1 &&
      ! { docker pull -q "mirror.gcr.io/$SIGNAL_IMAGE" >/dev/null && docker tag "mirror.gcr.io/$SIGNAL_IMAGE" "$SIGNAL_IMAGE"; }; then
      rate "relais Signal : l'image $SIGNAL_IMAGE n'a pas pu être téléchargée — relancer le script"
    else
      docker rm -f africontrol-signal >/dev/null 2>&1 || true
      docker run -d --name africontrol-signal --restart unless-stopped -p 127.0.0.1:8085:8080 -e MODE=native \
        -v "$RACINE/data/signal:/home/.local/share/signal-cli" "$SIGNAL_IMAGE" >/dev/null
    fi
    if docker inspect africontrol-signal >/dev/null 2>&1 && attendre signal_repond 90; then
      ok "relais Signal sur 127.0.0.1:8085, redémarre avec la machine — reste à lier le téléphone (ci-dessous)"
      A_FAIRE+=(
        "Lier le téléphone Signal du poste (une fois) :"
        "  1. ouvrir http://127.0.0.1:8085/v1/qrcodelink?device_name=AfriControl dans le navigateur du poste ;"
        "  2. sur le téléphone : Signal → Paramètres → Appareils reliés → « + », scanner le QR ;"
        "  3. AfriControl → Division → Webhook Signal, coller (number = le téléphone relié, recipients = qui reçoit) :"
        "     http://127.0.0.1:8085/v2/send?number=+235XXXXXXXX&recipients=+235YYYYYYYY,+235ZZZZZZZZ"
      )
    else
      rate "relais Signal : ne répond pas sur 127.0.0.1:8085 (docker logs africontrol-signal)"
    fi
  fi
fi

for ancienne in AFRICONTROL_DEEPSEEK XAI_API_KEY; do
  if [ -n "${!ancienne:-}" ] || grep -qs "^$ancienne=" "$POSTE_ENV"; then
    A_FAIRE+=("$ancienne n'est plus lue (l'IA reste sur le poste) : la retirer de l'environnement ou de poste.env.")
  fi
done

etape "Bilan"
printf '%s\n' "${BILAN[@]}"
if [ -f "$POSTE_ENV" ]; then
  echo
  echo "  poste.env :"
  grep '^AFRICONTROL_' "$POSTE_ENV" | sed 's/^/    /'
fi
if [ ${#A_FAIRE[@]} -gt 0 ]; then
  echo
  printf '  %s\n' "${A_FAIRE[@]}"
fi
echo
echo "  Lancer le poste (poste.env est lu tout seul) :"
echo "    PORT=8080 node .output/server/index.mjs"
echo "  Puis Capteurs > Outils > « Tester le serveur » pour l'IA, et le diagnostic pour le reste."
for ligne in "${BILAN[@]}"; do
  if [[ "$ligne" == *✗* ]]; then exit 1; fi
done
