#!/usr/bin/env python3
"""Build VIGILAIR PC + mobile install kits (offline HTML + icons)."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path("/workspace")
PUB = ROOT / "public"
OUT = PUB / "kits"
ART = ROOT / "artifacts"
OUT.mkdir(parents=True, exist_ok=True)
ART.mkdir(parents=True, exist_ok=True)

CSS = """
:root { --bg:#09090b; --fg:#f4f4f5; --muted:#a1a1aa; --border:#27272a; --ok:#7d9b86; --warn:#c4a574; --crit:#c45c5c; --surface:#121214; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--bg); color:var(--fg); font: 16px/1.5 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif; }
main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-size: 1.5rem; letter-spacing: -0.02em; margin: 0 0 .25rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
p, li { color: var(--muted); }
.kicker { font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.card { border: 1px solid var(--border); background: var(--surface); border-radius: 12px; padding: 1rem 1.15rem; margin: 1rem 0; }
ol { padding-left: 1.25rem; }
code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .85em; color: var(--fg); }
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.crit { color: var(--crit); }
hr { border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }
"""

PC_HTML = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VIGILAIR — installer le poste PC</title>
<style>{CSS}</style>
</head>
<body>
<main>
<p class="kicker">Kit poste · Windows · macOS · Linux</p>
<h1>Installer VIGILAIR sur l'ordinateur</h1>
<p>Ceci n'est pas un simulateur. Le COP tourne en application (PWA) dans Chrome ou Edge. Mêmes flux réels : 1090ES, METAR, SIGMET, FTTJ, GNSS.</p>
<div class="card">
<p class="ok">Compatible Windows 10/11 (HP EliteBook, Dell, Lenovo), macOS, Linux. Navigateur : Google Chrome ou Microsoft Edge, à jour. Pas de fichier .exe : le poste s'installe comme une application native (raccourci Démarrer / bureau).</p>
</div>
<h2>1. Ouvrir le COP</h2>
<ol>
<li>Connectez-vous au réseau de la division.</li>
<li>Ouvrez l'URL VIGILAIR fournie par le chef (publication / serveur de division) dans <strong>Chrome</strong> ou <strong>Edge</strong>.</li>
<li>Chef : e-mail + mot de passe. Agent : e-mail professionnel + clé VA-.</li>
</ol>
<h2>2. Installer comme un logiciel</h2>
<ol>
<li>Icône <strong>+</strong> ou <strong>Installer</strong> dans la barre d'adresse.</li>
<li>Ou menu Edge / Chrome · <em>Applications · Installer ce site en tant qu'application</em>.</li>
<li>Le raccourci apparaît dans le menu Démarrer et peut être épinglé au bureau.</li>
<li>À l'ouverture suivante : plein écran, sans onglet navigateur.</li>
</ol>
<h2>3. Identité</h2>
<ul>
<li>Chaque agent a un e-mail professionnel (identité) et une clé VA- (secret).</li>
<li>L'e-mail n'est pas un mot de passe. Sans la bonne clé, refus générique — pas d'indication que le compte existe.</li>
<li>Renseignez grade, téléphone, unité dans Division · Identité du poste.</li>
</ul>
<h2>4. Discipline et garde</h2>
<ul>
<li>Une clé VA- = un poste. Elle se scelle au premier ordinateur.</li>
<li>Ne jamais copier le logiciel (Ctrl+S, F12). Coupure + alerte chef.</li>
<li>Cinq refus d'identifiants = verrou 15 minutes, COP figé, sessions agents coupées.</li>
<li>Huit clés fausses en 5 min = spray. Même contre-mesure.</li>
<li class="warn">VIGILAIR ne riposte pas en réseau : il coupe, consigne, alerte. Pas de hack-back.</li>
</ul>
<p>Icônes du poste : dossier <code>icons/</code> (192 et 512). À utiliser si vous créez un raccourci manuel.</p>
<hr/>
<p>VIGILAIR · C-UAS N'Djamena · lecture seule 1090ES · n'émet pas.</p>
</main>
</body>
</html>
"""

MOB_HTML = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="apple-mobile-web-app-title" content="VIGILAIR"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<title>VIGILAIR — installer Android / iOS</title>
<style>{CSS}</style>
</head>
<body>
<main>
<p class="kicker">Kit mobile · Android · iPhone · iPad</p>
<h1>Installer VIGILAIR sur le téléphone</h1>
<p>Même COP que le poste PC. À installer sur l'écran d'accueil. Pas d'application Play Store / App Store : c'est le poste web scellé de la division.</p>
<div class="card">
<p class="ok">Android : Chrome. iPhone / iPad : Safari uniquement (les autres navigateurs iOS n'installent pas correctement). Pas d'APK ni d'IPA.</p>
</div>
<h2>Android</h2>
<ol>
<li>Ouvrez l'URL VIGILAIR dans <strong>Chrome</strong>.</li>
<li>Menu · <em>Ajouter à l'écran d'accueil</em> / <em>Installer l'application</em>.</li>
<li>Confirmez. L'icône VIGILAIR apparaît sur l'écran d'accueil.</li>
<li>Connectez-vous : e-mail + clé VA- (agent) ou e-mail + mot de passe (chef).</li>
</ol>
<h2>iPhone / iPad</h2>
<ol>
<li>Ouvrez l'URL dans <strong>Safari</strong> (pas Chrome iOS).</li>
<li>Bouton Partager (carré + flèche).</li>
<li><em>Sur l'écran d'accueil</em> · Ajouter.</li>
<li>Ouvrez l'icône. Connexion comme sur le poste PC.</li>
</ol>
<h2>Identité mobile</h2>
<ul>
<li>Même e-mail professionnel + même clé VA- que le poste attribué.</li>
<li>Le téléphone devient LE poste si c'est la première machine : ne pas installer la même clé sur un PC ensuite.</li>
</ul>
<h2>Discipline mobile</h2>
<ul>
<li>Ne pas transférer la clé VA- sur un second appareil.</li>
<li>Capture d'écran massive / AirDrop de dossiers = sentinelle, session coupée.</li>
<li>Réseau : 4G/5G ou Wi-Fi division. Les capteurs (1090, METAR) restent des flux réels.</li>
<li class="warn">Cinq refus = verrou. VIGILAIR coupe, consigne, alerte. Il n'attaque pas le réseau adverse.</li>
</ul>
<p>Icônes : dossier <code>icons/</code>. Fond noir, lisible de jour comme de nuit.</p>
<hr/>
<p>VIGILAIR · C-UAS N'Djamena · n'émet pas.</p>
</main>
</body>
</html>
"""

README_PC = """VIGILAIR — kit poste PC
=======================
1. Ouvrez INSTALLER.html (double-clic).
2. Suivez Chrome / Edge · Installer l'application.
3. Chef : e-mail + mot de passe. Agent : e-mail + clé VA-.

Windows, macOS, Linux. Pas de fichier .exe : le poste est une application web
installée (PWA), c'est le mode supporté sur tous les ordinateurs de la division.

VIGILAIR n'émet pas. 1090ES / METAR / SIGMET / GNSS = capteurs réels.
"""

README_MOB = """VIGILAIR — kit Android / iOS
============================
1. Ouvrez INSTALLER.html sur le téléphone (ou lisez-le depuis un PC).
2. Android : Chrome · Ajouter à l'écran d'accueil.
3. iPhone : Safari · Partager · Sur l'écran d'accueil.

Pas d'APK ni d'IPA. L'installation officielle est l'écran d'accueil (PWA),
valable Android et iOS.

VIGILAIR n'émet pas.
"""

IDENTITE = """VIGILAIR — identité
===================
Chef de division
  e-mail + mot de passe (8 caractères minimum).
  Premier compte créé = super-administrateur du contrat.

Agent
  e-mail professionnel (identité, pas un secret)
  + clé VA-XXXX-XXXX-XXXX (secret, une fois, un poste).

Fiche identité (Division)
  Nom, e-mail, grade, téléphone, unité / bureau.

L'e-mail sans la bonne clé = refus générique.
La clé sans le bon e-mail = refus générique.
"""

SECURITE = """VIGILAIR — garde anti-piratage
==============================
Détection
  5 refus e-mail / mot de passe ou clé VA- en 10 min = force brute
  8 clés fausses en 5 min = spray
  Copie logiciel (Ctrl+S, F12) ou dossier = sentinelle
  Clé VA- présentée sur un second poste = usurpation

Contre-mesure (défensive uniquement)
  Verrou 15 minutes sur l'identité attaquée
  COP figé (lecture seule) — inject, EW, Mode 4, clés, quart suspendus
  Sessions agents coupées (le chef reste pour lever le verrou)
  Incident consigné + alerte chef (Telegram / Signal si configurés)

VIGILAIR n'émet pas. Il ne riposte pas sur le réseau adverse.
Il coupe, consigne, alerte.
"""


def add_icons(zf: ZipFile, prefix: str) -> None:
    mapping = {
        f"{prefix}icons/icon-192.png": PUB / "icon-192.png",
        f"{prefix}icons/icon-512.png": PUB / "icon-512.png",
        f"{prefix}icons/favicon.svg": PUB / "favicon.svg",
        f"{prefix}icons/apple-touch-icon.png": PUB / "__grok" / "icon-180.png",
    }
    for arc, src in mapping.items():
        if src.exists():
            zf.write(src, arc)


def build(name: str, installer: str, readme: str) -> Path:
    path = OUT / name
    prefix = name.replace(".zip", "") + "/"
    with ZipFile(path, "w", ZIP_DEFLATED) as zf:
        zf.writestr(prefix + "INSTALLER.html", installer)
        zf.writestr(prefix + "LIRE-MOI.txt", readme)
        zf.writestr(prefix + "IDENTITE.txt", IDENTITE)
        zf.writestr(prefix + "SECURITE.txt", SECURITE)
        add_icons(zf, prefix)
    dest = ART / name
    dest.write_bytes(path.read_bytes())
    print("wrote", path, path.stat().st_size, "and", dest)
    return path


if __name__ == "__main__":
    build("VIGILAIR-poste-PC.zip", PC_HTML, README_PC)
    build("VIGILAIR-poste-mobile.zip", MOB_HTML, README_MOB)
