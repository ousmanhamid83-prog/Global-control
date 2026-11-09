<#
Prépare le poste AfriControl en une commande (Windows). À lancer UNE FOIS EN LIGNE, depuis le
dossier AfriControl ; ensuite tout tourne hors ligne. Les réglages vont dans poste.env, que le
serveur lit seul au démarrage (src/lib/config-poste.ts).

  powershell -ExecutionPolicy Bypass -File scripts\poste\preparer-poste.ps1
  powershell -ExecutionPolicy Bypass -File scripts\poste\preparer-poste.ps1 -Itineraire -Signal

  -Modele NOM     modèle d'IA (défaut selon la mémoire : qwen2.5:7b dès 15 Go, qwen2.5:3b dès
                  7 Go, sinon qwen2.5:1.5b)
  -Zone S,N,O,E   relief sur cette zone, en degrés entiers ; PLUSIEURS zones (sur n'importe quels
                  continents) en les séparant par une virgule entre guillemets (défaut : le Tchad,
                  7,23,13,23 — 187 tuiles, 862 Mo). Ex. : -Zone "7,23,13,23","42,48,1,8"
  -Imagerie       mosaïque Sentinel-2 HORS LIGNE (zooms 8 à 12), avec le compte Copernicus gratuit
                  de l'opérateur : AFRICONTROL_SENTINEL_ID et _SECRET dans poste.env. Une tuile =
                  une requête sur le quota mensuel du compte.
  -ZoneImagerie S,N,O,E   zone de la mosaïque, en degrés décimaux (implique -Imagerie) ; PLUSIEURS
                  zones entre guillemets, séparées par une virgule (défaut : le poste, FTTJ ± 0,55°
                  — 274 tuiles). Ex. : -ZoneImagerie "11.6,12.7,14.5,15.6","13.2,13.9,20.5,21.2"
                  Autres réglages (zooms, fenêtre, nuages) : node scripts\poste\imagerie-poste.mjs --help
  -Itineraire     serveur d'itinéraire OSRM du poste (Docker Desktop, carte OSM du Tchad, 151 Mo)
  -Signal         relais Signal du poste (Docker Desktop) : le détail des alertes, chiffré
                  jusqu'aux téléphones des destinataires
  -Recherche      moteur de recherche SearXNG du poste (Docker Desktop), pour la commande
                  /recherche : la requête sort alors du poste ; /recherche reste désactivée tant
                  que le chef de division ne l'active pas (Capteurs › Outils › Commandes du poste)
  -Copies DOSSIER dossier des copies du poste (AFRICONTROL_COPIES) : tout ce que le poste garde y
                  est doublé aussitôt. Sans -Copies, un autre disque INTERNE de la machine (pas une
                  clé USB ; le plus de place libre, 10 Go au moins), s'il y en a un ; sinon
                  data\copies, sur le disque du poste — sa panne emporterait les deux, le bilan le dit.
  -SansBuild  -SansIA  -SansRelief    sauter une étape

Relancer le script reprend là où il s'était arrêté : ce qui est déjà en place est gardé.
#>
param(
  [string]$Modele = "",
  [string[]]$Zone = @("7,23,13,23"),
  [switch]$Imagerie,
  [string[]]$ZoneImagerie = @(),
  [switch]$Itineraire,
  [switch]$Signal,
  [switch]$Recherche,
  [string]$Copies = "",
  [switch]$SansBuild,
  [switch]$SansIA,
  [switch]$SansRelief
)

$ErrorActionPreference = "Stop"
# Sans cela, Invoke-WebRequest de PowerShell 5.1 télécharge des dizaines de fois plus lentement.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

Set-Location (Join-Path $PSScriptRoot (Join-Path ".." ".."))
$Racine = (Get-Location).Path
$PosteEnv = Join-Path $Racine "poste.env"
$OsrmImage = "ghcr.io/project-osrm/osrm-backend:v26.11.0-debian"
$SignalImage = "bbernhard/signal-cli-rest-api:0.101"
$SearxngImage = "searxng/searxng:2026.11.2-cccbc9e15"

$Bilan = New-Object System.Collections.Generic.List[string]
$AFaire = New-Object System.Collections.Generic.List[string]
$NbEchecs = 0
function Etape([string]$Texte) { Write-Host ""; Write-Host "== $Texte" }
function Ok([string]$Texte) { $Bilan.Add("  [ok] $Texte"); Write-Host "  [ok] $Texte" -ForegroundColor Green }
function Rate([string]$Texte) {
  $Bilan.Add("  [échec] $Texte")
  $script:NbEchecs++
  Write-Host "  [échec] $Texte" -ForegroundColor Red
}

# Commande native, muette : vrai si elle réussit. ($ErrorActionPreference local : sous PowerShell
# 5.1, une simple ligne sur stderr lèverait sinon une exception.)
function Reussit([scriptblock]$Commande) {
  $ErrorActionPreference = "Continue"
  & $Commande *> $null
  return ($LASTEXITCODE -eq 0)
}

# Même chose, sortie gardée dans un journal.
function ReussitJournal([string]$Journal, [scriptblock]$Commande) {
  $ErrorActionPreference = "Continue"
  & $Commande *>> $Journal
  return ($LASTEXITCODE -eq 0)
}

function Repond([string]$Url) {
  try {
    $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url
    return $true
  } catch {
    return $false
  }
}

# Attendre <test> <secondes> : réessaie le test chaque seconde jusqu'au délai.
function Attendre([scriptblock]$Test, [int]$Secondes) {
  for ($i = 0; $i -lt $Secondes; $i++) {
    if (& $Test) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

# Regler CLE valeur : écrit ou remplace la ligne CLE= de poste.env (les autres lignes restent).
function Regler([string]$Cle, [string]$Valeur) {
  $lignes = New-Object System.Collections.Generic.List[string]
  if (Test-Path $PosteEnv) {
    foreach ($l in [IO.File]::ReadAllLines($PosteEnv)) { $lignes.Add($l) }
  } else {
    $lignes.Add("# Réglages du poste AfriControl, lus au démarrage du serveur.")
    $lignes.Add("# Écrit par scripts/poste/preparer-poste ; une variable posée au lancement garde la main.")
  }
  $fait = $false
  for ($i = 0; $i -lt $lignes.Count; $i++) {
    if ($lignes[$i].StartsWith("$Cle=")) {
      if ($fait) {
        $lignes.RemoveAt($i)
        $i--
      } else {
        $lignes[$i] = "$Cle=$Valeur"
        $fait = $true
      }
    }
  }
  if (-not $fait) { $lignes.Add("$Cle=$Valeur") }
  [IO.File]::WriteAllLines($PosteEnv, $lignes, (New-Object Text.UTF8Encoding($false)))
}

# Telecharger <fichier> <adresses> : la première adresse qui répond.
function Telecharger([string]$Fichier, [string[]]$Adresses) {
  foreach ($adresse in $Adresses) {
    Write-Host "  téléchargement : $adresse"
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $adresse -OutFile "$Fichier.part"
      Move-Item -Force "$Fichier.part" $Fichier
      return $true
    } catch {
      Write-Host "  échec : $($_.Exception.Message)"
    }
  }
  return $false
}

# Zones S,N,O,E. Lancé par « powershell -File », -Zone "a","b" arrive en UNE seule chaîne (mesuré :
# « 7,23,13,23,42,48,1,8 ») ; depuis une console PowerShell, en deux. Une zone a toujours quatre
# nombres : on les regroupe par quatre, et les deux façons de lancer donnent les mêmes zones.
# $null si le compte n'est pas un multiple de quatre.
function Zones([string[]]$Valeurs) {
  $nombres = @(($Valeurs -join ",").Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
  if ($nombres.Count -eq 0 -or $nombres.Count % 4 -ne 0) { return $null }
  $zones = @()
  for ($i = 0; $i -lt $nombres.Count; $i += 4) { $zones += ($nombres[$i..($i + 3)] -join ",") }
  return $zones
}

# Docker Desktop prêt pour les images du poste, qui sont des images Linux : $null, sinon ce qui
# manque. En conteneurs Windows, chaque téléchargement échouerait sans dire pourquoi.
function DockerManque {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    return "Docker Desktop absent (https://docs.docker.com/desktop/setup/install/windows-install/)"
  }
  $ErrorActionPreference = "Continue"
  $systeme = (& docker info --format "{{.OSType}}" 2> $null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    return "Docker Desktop arrêté : le lancer, attendre « Engine running », puis relancer le script"
  }
  if ($systeme -ne "linux") {
    return "Docker est en conteneurs Windows ($systeme) : clic droit sur l'icône de Docker Desktop, « Switch to Linux containers », puis relancer le script"
  }
  return $null
}

# Une image déjà là n'est pas retéléchargée : relancer le script hors ligne reste possible.
function ImagePresente([string]$Image) { return (Reussit { docker image inspect $Image }) }

Etape "Node"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node 22 ou plus est requis : https://nodejs.org/fr/download (ou : winget install -e --id OpenJS.NodeJS.LTS)"
  exit 1
}
$versionNode = (& node -p "process.versions.node").Trim()
if ([int]$versionNode.Split(".")[0] -lt 22) {
  Write-Host "Node v$versionNode est trop ancien : 22 ou plus est requis (https://nodejs.org/fr/download)."
  exit 1
}
Ok "Node v$versionNode"

if (-not $SansBuild) {
  Etape "Serveur AfriControl (dépendances, build autonome)"
  & npm ci --no-audit --no-fund
  $code = $LASTEXITCODE
  if ($code -eq 0) {
    $env:NITRO_PRESET = "node-server"
    & npm run build
    $code = $LASTEXITCODE
    Remove-Item Env:NITRO_PRESET
  }
  if ($code -ne 0) {
    Write-Host "Le build a échoué (messages ci-dessus). Coupure réseau : relancer le script. Autre erreur (npm ci, build) : la signaler avec ces messages."
    exit 1
  }
  Ok "serveur construit : .output\server\index.mjs"
}

function OllamaExe {
  $commande = Get-Command ollama -ErrorAction SilentlyContinue
  if ($commande) { return $commande.Source }
  if ($env:LOCALAPPDATA) {
    $chemin = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path $chemin) { return $chemin }
  }
  return $null
}
$UrlIa = "http://127.0.0.1:11434/api/version"

if (-not $SansIA) {
  Etape "IA du poste (Ollama, sur cette machine)"
  if (-not (Repond $UrlIa) -and -not (OllamaExe)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Write-Host "  installation d'Ollama (winget)…"
      & winget install -e --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
    } else {
      Write-Host "  installation d'Ollama (installeur officiel d'ollama.com)…"
      $installeur = Join-Path $env:TEMP "OllamaSetup.exe"
      Invoke-WebRequest -UseBasicParsing -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $installeur
      # Pas « Start-Process -Wait » : il attend aussi ce que l'installeur lance, dont l'application
      # d'Ollama, qui reste ouverte — le script attendrait sans fin. Seul l'installeur est attendu.
      $installation = Start-Process -PassThru -FilePath $installeur -ArgumentList "/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"
      $installation.WaitForExit()
    }
  }
  $ollama = OllamaExe
  if (-not (Repond $UrlIa) -and $ollama) {
    # Ollama se lance d'habitude seul à l'ouverture de session ; sinon, le serveur sans fenêtre.
    Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
  }
  if (-not $ollama) {
    Rate "IA : Ollama n'a pas pu être installé (messages ci-dessus)"
  } elseif (-not (Attendre { Repond $UrlIa } 60)) {
    Rate "IA : Ollama ne répond pas sur 127.0.0.1:11434"
  } else {
    if (-not $Modele) {
      $memoire = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
      if ($memoire -ge 15) { $Modele = "qwen2.5:7b" } elseif ($memoire -ge 7) { $Modele = "qwen2.5:3b" } else { $Modele = "qwen2.5:1.5b" }
      Write-Host "  mémoire : $memoire Go → modèle $Modele"
    }
    & $ollama pull $Modele
    if ($LASTEXITCODE -ne 0) {
      Rate "IA : le modèle $Modele n'a pas pu être téléchargé — relancer le script pour reprendre"
    } else {
      Regler "AFRICONTROL_IA" "http://127.0.0.1:11434/v1"
      Regler "AFRICONTROL_IA_MODELE" $Modele
      Write-Host "  essai d'une réponse (le premier chargement du modèle peut prendre une minute)…"
      $debut = Get-Date
      $question = @{ model = $Modele; max_tokens = 12; messages = @(@{ role = "user"; content = "Réponds seulement : prêt." }) } | ConvertTo-Json -Depth 4
      try {
        # Octets lus en UTF-8 : PowerShell 5.1 décode sinon en Latin-1 un JSON sans charset (« PrÃªt. »).
        $brut = Invoke-WebRequest -UseBasicParsing -Method Post -TimeoutSec 300 -Uri "http://127.0.0.1:11434/v1/chat/completions" -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($question))
        $reponse = [Text.Encoding]::UTF8.GetString($brut.RawContentStream.ToArray()) | ConvertFrom-Json
        $secondes = [Math]::Round(((Get-Date) - $debut).TotalSeconds)
        Ok "IA : $Modele répond en $secondes s (« $($reponse.choices[0].message.content.Trim()) »)"
      } catch {
        Rate "IA : $Modele installé mais n'a pas répondu à l'essai ($($_.Exception.Message))"
      }
    }
  }
}

if (-not $SansRelief) {
  Etape "Relief (tuiles Copernicus GLO-90, lues par le poste lui-même)"
  $dossierRelief = Join-Path $Racine (Join-Path "data" "relief")
  New-Item -ItemType Directory -Force -Path $dossierRelief | Out-Null
  # Liste dédupliquée des tuiles couvrant TOUTES les zones demandées (n'importe quels continents) :
  # deux zones qui se chevauchent ne téléchargent pas deux fois le même degré carré.
  $aPrendre = New-Object System.Collections.Generic.HashSet[string]
  $zonesRelief = Zones $Zone
  if ($null -eq $zonesRelief) {
    Write-Host "-Zone attend des zones de quatre degrés entiers S,N,O,E (reçu : $($Zone -join ' | '))"
    exit 2
  }
  foreach ($z in $zonesRelief) {
    $bornes = $z.Split(",")
    if ($bornes.Count -ne 4 -or ($bornes | Where-Object { $_ -notmatch '^-?\d+$' })) {
      Write-Host "-Zone attend quatre degrés entiers S,N,O,E (reçu : $z)"
      exit 2
    }
    $sud, $nord, $ouest, $est = $bornes | ForEach-Object { [int]$_ }
    if ($sud -gt $nord -or $ouest -gt $est) {
      Write-Host "-Zone : S<=N et O<=E attendus (reçu : $z)"
      exit 2
    }
    for ($lat = $sud; $lat -le $nord; $lat++) {
      for ($lon = $ouest; $lon -le $est; $lon++) {
        $ns = if ($lat -lt 0) { "S" } else { "N" }
        $ew = if ($lon -lt 0) { "W" } else { "E" }
        [void]$aPrendre.Add(("Copernicus_DSM_COG_30_{0}{1:D2}_00_{2}{3:D3}_00_DEM" -f $ns, [Math]::Abs($lat), $ew, [Math]::Abs($lon)))
      }
    }
  }
  $total = $aPrendre.Count
  # Garde-fou : un continent entier, c'est des milliers de tuiles et des dizaines de Go.
  if ($total -gt 2000) {
    Write-Host "  ATTENTION : $total tuiles demandees (environ $([Math]::Round($total * 0.0045)) Go). Ctrl+C pour arreter ; sinon ca continue dans 5 s..."
    Start-Sleep -Seconds 5
  }
  $n = 0; $neuves = 0; $mer = 0; $echecs = 0
  foreach ($nom in $aPrendre) {
    $n++
    $fichier = Join-Path $dossierRelief "$nom.tif"
    if (Test-Path $fichier) { continue }
    Write-Host -NoNewline "`r  tuile $n/$total "
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -Uri "https://copernicus-dem-90m.s3.amazonaws.com/$nom/$nom.tif" -OutFile "$fichier.part"
      # Une vraie tuile commence par l'en-tête TIFF « II » ; un portail captif renverrait du HTML.
      $flux = [IO.File]::OpenRead("$fichier.part")
      $entete = @($flux.ReadByte(), $flux.ReadByte())
      $flux.Close()
      if ($entete[0] -eq 0x49 -and $entete[1] -eq 0x49) {
        Move-Item -Force "$fichier.part" $fichier
        $neuves++
      } else {
        Remove-Item -Force "$fichier.part"
        $echecs++
      }
    } catch {
      if (Test-Path "$fichier.part") { Remove-Item -Force "$fichier.part" }
      $statut = 0
      if ($_.Exception.Response) { $statut = [int]$_.Exception.Response.StatusCode }
      if ($statut -eq 404) { $mer++ } else { $echecs++ } # 404 : pas de tuile, la mer
    }
  }
  Write-Host ""
  $tuiles = @(Get-ChildItem -Path $dossierRelief -Filter "Copernicus_DSM_COG_*_DEM.tif")
  $mo = [Math]::Round(($tuiles | Measure-Object -Property Length -Sum).Sum / 1MB)
  Ok "relief : $($tuiles.Count) tuiles dans data\relief ($mo Mo), dont $neuves téléchargées maintenant ; $mer en mer, sans tuile"
  if ($echecs -gt 0) {
    Rate "relief : $echecs tuiles n'ont pas pu être téléchargées — relancer le script pour les reprendre"
  }
}

if ($Imagerie -or $ZoneImagerie.Count -gt 0) {
  Etape "Imagerie hors ligne (mosaïque Sentinel-2, compte Copernicus de l'opérateur)"
  # Le script de mosaïque fait tout (plan, garde-fous, reprise) : il lit poste.env ici même.
  $argsImagerie = @()
  # Mal formées (pas un multiple de quatre nombres), les zones passent telles quelles : le script
  # de mosaïque dit alors quoi corriger.
  $zonesImagerie = if ($ZoneImagerie.Count -gt 0) { Zones $ZoneImagerie } else { @() }
  if ($null -eq $zonesImagerie) { $zonesImagerie = $ZoneImagerie }
  foreach ($z in $zonesImagerie) { $argsImagerie += @("--zone", $z) }
  # $ErrorActionPreference local : sous PowerShell 5.1, une ligne sur stderr lèverait une exception.
  $ErrorActionPreference = "Continue"
  & node scripts/poste/imagerie-poste.mjs @argsImagerie
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($code -eq 0) {
    $plan = & node scripts/poste/imagerie-poste.mjs @argsImagerie --essai |
      Where-Object { $_ -match '^  zooms ' } | Select-Object -Last 1
    Ok "imagerie : $($plan.Trim()) — lues par le serveur, même hors ligne"
  } elseif ($code -eq 1) {
    Rate "imagerie : des tuiles n'ont pas pu être obtenues — relancer le script pour les reprendre"
  } else {
    Rate "imagerie : arrêtée (raison ci-dessus)"
  }
  $reglee = $env:AFRICONTROL_SENTINEL_ID -or
    ((Test-Path $PosteEnv) -and (Select-String -Quiet -Path $PosteEnv -Pattern '^AFRICONTROL_SENTINEL_ID='))
  if (-not $reglee) {
    $AFaire.Add("Imagerie hors ligne : créer un client OAuth sur le compte Copernicus (gratuit) :")
    $AFaire.Add("  https://shapps.dataspace.copernicus.eu/dashboard/#/account/settings → User Settings → OAuth clients → Create ;")
    $AFaire.Add("  l'écrire dans poste.env : AFRICONTROL_SENTINEL_ID=… et AFRICONTROL_SENTINEL_SECRET=…")
    $AFaire.Add("  (le même compte sert à l'imagerie fraîche de la console), puis relancer avec -Imagerie.")
  }
}

$UrlRoute = "http://127.0.0.1:5810/route/v1/driving/15.0444,12.1067;20.8324,13.8292?overview=false"

if ($Itineraire) {
  Etape "Itinéraire (serveur OSRM du poste, carte OpenStreetMap du Tchad)"
  $docker = DockerManque
  if ($docker) {
    Rate "itinéraire : $docker"
  } else {
    $dossierOsrm = Join-Path $Racine (Join-Path "data" "osrm")
    New-Item -ItemType Directory -Force -Path $dossierOsrm | Out-Null
    $carte = Join-Path $dossierOsrm "tchad.osm.pbf"
    $journal = Join-Path $dossierOsrm "preparation.log"
    if ((Test-Path $carte) -or (Telecharger $carte @("https://download.openstreetmap.fr/extracts/africa/chad.osm.pbf", "https://download.geofabrik.de/africa/chad-latest.osm.pbf"))) {
      if (-not (ImagePresente $OsrmImage) -and -not (Reussit { docker pull -q $OsrmImage })) {
        Rate "itinéraire : l'image $OsrmImage n'a pas pu être téléchargée — relancer le script"
      } elseif (-not (Test-Path (Join-Path $dossierOsrm "tchad.osrm.mldgr"))) {
        Write-Host "  préparation du graphe routier (quelques minutes)…"
        $volume = "${dossierOsrm}:/data"
        foreach ($outil in @(@("osrm-extract", "-p", "/opt/car.lua", "/data/tchad.osm.pbf"), @("osrm-partition", "/data/tchad.osrm"), @("osrm-customize", "/data/tchad.osrm"))) {
          if (-not (ReussitJournal $journal { docker run --rm -v $volume $OsrmImage @outil })) {
            Rate "itinéraire : $($outil[0]) a échoué (voir data\osrm\preparation.log)"
            break
          }
        }
      }
      if (Test-Path (Join-Path $dossierOsrm "tchad.osrm.mldgr")) {
        $null = Reussit { docker rm -f africontrol-osrm }
        $volume = "${dossierOsrm}:/data"
        $null = Reussit { docker run -d --name africontrol-osrm --restart unless-stopped -p 127.0.0.1:5810:5000 -v $volume $OsrmImage osrm-routed --algorithm mld /data/tchad.osrm }
        if (Attendre { Repond $UrlRoute } 120) {
          Regler "AFRICONTROL_ITINERAIRE" "http://127.0.0.1:5810"
          $km = [Math]::Round((Invoke-RestMethod -Uri $UrlRoute).routes[0].distance / 1000)
          Ok "itinéraire : OSRM sur 127.0.0.1:5810, redémarre avec la machine (essai N'Djamena → Abéché : $km km par la route)"
        } else {
          Rate "itinéraire : OSRM ne répond pas sur 127.0.0.1:5810 (docker logs africontrol-osrm)"
        }
      }
    } else {
      Rate "itinéraire : la carte OSM du Tchad n'a pas pu être téléchargée — relancer le script"
    }
  }
}

if ($Signal) {
  Etape "Relais Signal du poste (détail des alertes, chiffré jusqu'aux téléphones)"
  $docker = DockerManque
  if ($docker) {
    Rate "relais Signal : $docker"
  } else {
    $dossierSignal = Join-Path $Racine (Join-Path "data" "signal")
    New-Item -ItemType Directory -Force -Path $dossierSignal | Out-Null
    # Docker Hub limite les téléchargements anonymes : le miroir de Google sert la même image.
    $miroir = "mirror.gcr.io/$SignalImage"
    if (-not (ImagePresente $SignalImage) -and -not (Reussit { docker pull -q $SignalImage }) -and -not ((Reussit { docker pull -q $miroir }) -and (Reussit { docker tag $miroir $SignalImage }))) {
      Rate "relais Signal : l'image $SignalImage n'a pas pu être téléchargée — relancer le script"
    } else {
      $null = Reussit { docker rm -f africontrol-signal }
      $volume = "${dossierSignal}:/home/.local/share/signal-cli"
      $null = Reussit { docker run -d --name africontrol-signal --restart unless-stopped -p 127.0.0.1:8085:8080 -e MODE=native -v $volume $SignalImage }
    }
    if ((Reussit { docker inspect africontrol-signal }) -and (Attendre { Repond "http://127.0.0.1:8085/v1/about" } 90)) {
      Ok "relais Signal sur 127.0.0.1:8085, redémarre avec la machine — reste à inscrire le numéro du poste (ci-dessous)"
      $AFaire.Add("Inscrire le numéro propre du poste chez Signal (une fois, sans relier de téléphone) :")
      $AFaire.Add("  1. une puce active réservée au poste, dans un mobile sans Signal pour ce numéro ;")
      $AFaire.Add("  2. AfriControl → Capteurs › Outils › Bot Signal du poste → Numéro propre au bot (chef de division) :")
      $AFaire.Add("     captcha de https://signalcaptchas.org/registration/generate, puis le code reçu par SMS ;")
      $AFaire.Add("  3. AfriControl → Division → Webhook Signal, coller (number = ce numéro, recipients = qui reçoit) :")
      $AFaire.Add("     http://127.0.0.1:8085/v2/send?number=+235XXXXXXXX&recipients=+235YYYYYYYY,+235ZZZZZZZZ")
      $AFaire.Add("  4. bot Signal (facultatif) : au même endroit, ajouter puis activer les numéros autorisés, et le bot.")
    } else {
      Rate "relais Signal : ne répond pas sur 127.0.0.1:8085 (docker logs africontrol-signal)"
    }
  }
}

if ($Recherche) {
  Etape "Moteur de recherche du poste (SearXNG, pour /recherche)"
  $docker = DockerManque
  if ($docker) {
    Rate "recherche : $docker"
  } else {
    $dossierRecherche = Join-Path $Racine (Join-Path "data" "searxng")
    New-Item -ItemType Directory -Force -Path $dossierRecherche | Out-Null
    # Écrit une fois : relancer le script garde la clé du moteur. Sans BOM : c'est du YAML.
    $reglages = Join-Path $dossierRecherche "settings.yml"
    if (-not (Test-Path $reglages)) {
      $octets = New-Object byte[] 32
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($octets)
      $cle = -join ($octets | ForEach-Object { $_.ToString("x2") })
      $yaml = @(
        "# Moteur de recherche du poste AfriControl (scripts/poste/preparer-poste -Recherche).",
        "use_default_settings: true",
        "server:",
        "  secret_key: `"$cle`"",
        "  limiter: false",
        "search:",
        "  formats:",
        "    - html",
        "    - json",
        ""
      ) -join "`n"
      [IO.File]::WriteAllText($reglages, $yaml, (New-Object Text.UTF8Encoding $false))
    }
    $miroir = "mirror.gcr.io/$SearxngImage"
    if (-not (ImagePresente $SearxngImage) -and -not (Reussit { docker pull -q $SearxngImage }) -and -not ((Reussit { docker pull -q $miroir }) -and (Reussit { docker tag $miroir $SearxngImage }))) {
      Rate "recherche : l'image $SearxngImage n'a pas pu être téléchargée — relancer le script"
    } else {
      $null = Reussit { docker rm -f africontrol-recherche }
      $volume = "${dossierRecherche}:/etc/searxng"
      # L'image écoute en IPv6 par défaut (::) : sur un noyau sans IPv6, elle plante en boucle
      # (erreur 97, vu à l'essai). IPv4 dans le conteneur ; le port reste lié au seul poste.
      $null = Reussit { docker run -d --name africontrol-recherche --restart unless-stopped -p 127.0.0.1:8888:8080 -e GRANIAN_HOST=0.0.0.0 -v $volume $SearxngImage }
    }
    # Le moteur répond, et en JSON (sans « json » dans search.formats, il répond 403).
    if ((Reussit { docker inspect africontrol-recherche }) -and (Attendre { Repond "http://127.0.0.1:8888/search?q=test&format=json" } 90)) {
      Regler "AFRICONTROL_RECHERCHE" "http://127.0.0.1:8888"
      Ok "moteur de recherche sur 127.0.0.1:8888, redémarre avec la machine — /recherche reste désactivée"
      $AFaire.Add("Recherche en ligne : le chef de division active /recherche (Capteurs › Outils › Commandes du poste).")
      $AFaire.Add("  La requête sort alors du poste ; jamais un contact du relevé ni des coordonnées ; journalisée.")
    } else {
      Rate "recherche : le moteur ne répond pas en JSON sur 127.0.0.1:8888 (docker logs africontrol-recherche)"
    }
  }
}

# Le disque physique (son numéro) qui porte une lettre de lecteur ; $null si on ne sait pas le dire.
function DisqueDe([string]$Lettre) {
  try {
    return [int](Get-Partition -DriveLetter $Lettre -ErrorAction Stop | Select-Object -First 1).DiskNumber
  } catch {
    return $null
  }
}

# Un autre disque que celui du poste, pour ses copies : un volume NTFS ou ReFS d'un AUTRE disque
# physique (deux partitions d'un même disque mourraient ensemble), branché en interne (une clé ou
# un disque USB s'enlève), avec 10 Go libres au moins ; le plus de place. $null s'il n'y en a pas.
function AutreDisque {
  $lettre = $Racine.Substring(0, 1)
  $disque = DisqueDe $lettre
  if ($null -eq $disque) { return $null }
  try {
    $volumes = @(Get-Volume -ErrorAction Stop | Where-Object {
        $_.DriveLetter -and [string]$_.DriveLetter -ne $lettre -and "$($_.DriveType)" -eq "Fixed" -and
        @("NTFS", "ReFS") -contains $_.FileSystem -and $_.SizeRemaining -ge 10GB
      } | Sort-Object SizeRemaining -Descending)
  } catch {
    return $null
  }
  foreach ($v in $volumes) {
    $d = DisqueDe ([string]$v.DriveLetter)
    if ($null -eq $d -or $d -eq $disque) { continue }
    if ("$((Get-Disk -Number $d -ErrorAction SilentlyContinue).BusType)" -eq "USB") { continue }
    return $v
  }
  return $null
}

Etape "Copies du poste (un autre disque que le sien)"
$reglee = $null
if (Test-Path $PosteEnv) {
  $reglee = Select-String -Path $PosteEnv -Pattern "^AFRICONTROL_COPIES=(.+)$" | Select-Object -Last 1
}
$dossierCopies = $null
if ($Copies) {
  try {
    New-Item -ItemType Directory -Force -Path $Copies -ErrorAction Stop | Out-Null
    $dossierCopies = (Resolve-Path $Copies).Path
    Regler "AFRICONTROL_COPIES" $dossierCopies
    Ok "copies du poste dans $dossierCopies"
  } catch {
    Rate "copies : $Copies impossible à créer ($($_.Exception.Message))"
  }
} elseif ($reglee) {
  $dossierCopies = $reglee.Matches[0].Groups[1].Value
  Ok "copies du poste : AFRICONTROL_COPIES déjà réglé dans poste.env ($dossierCopies), gardé"
} else {
  $autre = AutreDisque
  if ($autre) {
    $dossierCopies = "$($autre.DriveLetter):\AfriControl-copies"
    New-Item -ItemType Directory -Force -Path $dossierCopies | Out-Null
    Regler "AFRICONTROL_COPIES" $dossierCopies
    Ok "copies du poste sur un autre disque : $dossierCopies ($([math]::Round($autre.SizeRemaining / 1GB)) Go libres)"
  } else {
    $dossierCopies = "data\copies"
    Ok "copies du poste dans data\copies (pas d'autre disque interne avec 10 Go libres)"
  }
}
if ($dossierCopies) {
  # Relatif : au dossier du serveur, comme le lit le poste.
  $absolu = if ([System.IO.Path]::IsPathRooted($dossierCopies)) { $dossierCopies } else { Join-Path $Racine $dossierCopies }
  $anciennes = Join-Path $Racine "data\copies"
  if ((Test-Path $anciennes) -and @(Get-ChildItem $anciennes -Force).Count -gt 0 -and
    (Resolve-Path $anciennes).Path.TrimEnd("\") -ne $absolu.TrimEnd("\")) {
    $AFaire.Add("Les copies déjà faites dans data\copies : le poste les rapatrie dans $absolu (comparées une à une, puis retirées du disque du poste), et y recopie tout ce qu'il garde.")
  }
  $dp = DisqueDe $Racine.Substring(0, 1)
  $dc = DisqueDe $absolu.Substring(0, 1)
  if ($null -eq $dp -or $null -eq $dc) {
    $AFaire.Add("Copies du poste : le disque de $absolu n'a pas pu être comparé à celui du poste — s'assurer qu'il est autre.")
  } elseif ($dp -eq $dc) {
    $AFaire.Add("Copies du poste sur le même disque que lui (disque $dp) : sa panne emporterait les deux. Brancher un autre disque (ou une clé), puis relancer avec -Copies E:\AfriControl-copies.")
  } else {
    Ok "copies sur un autre disque (disque $dc) que le poste (disque $dp)"
  }
}

foreach ($ancienne in @("AFRICONTROL_DEEPSEEK", "XAI_API_KEY")) {
  $dansFichier = (Test-Path $PosteEnv) -and (Select-String -Path $PosteEnv -Pattern "^$ancienne=" -Quiet)
  if ([Environment]::GetEnvironmentVariable($ancienne) -or $dansFichier) {
    $AFaire.Add("$ancienne n'est plus lue (l'IA reste sur le poste) : la retirer de l'environnement ou de poste.env.")
  }
}

Etape "Bilan"
$Bilan | ForEach-Object { Write-Host $_ }
if (Test-Path $PosteEnv) {
  Write-Host ""
  Write-Host "  poste.env :"
  Get-Content $PosteEnv | Where-Object { $_ -like "AFRICONTROL_*" } | ForEach-Object { Write-Host "    $_" }
}
if ($AFaire.Count -gt 0) {
  Write-Host ""
  $AFaire | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
Write-Host "  Lancer le poste (poste.env est lu tout seul) :"
Write-Host '    $env:PORT="8080"; node .output\server\index.mjs'
Write-Host "  Puis Capteurs > Outils > « Tester le serveur » pour l'IA, et le diagnostic pour le reste."
Write-Host "  Relevé Internet : coupé à la livraison, rien ne sort du poste — le chef de division l'active"
Write-Host "  dans Capteurs > Outils > Relevé Internet du poste."
if ($NbEchecs -gt 0) { exit 1 }
