import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// Un faux récepteur (flux audio HTTP) : chaque morceau poussé à la main.
let dossier = "";
const cwd = process.cwd();
let serveur: http.Server;
let pousser: ((b: Buffer) => void) | null = null;
let connexions = 0;
let atc: typeof import("./atc.server.ts");
let disque: typeof import("../disque-poste.server.ts");

before(async () => {
  dossier = mkdtempSync(path.join(tmpdir(), "atc-garde-"));
  process.chdir(dossier); // le dossier des enregistrements est fixé au chargement du module
  serveur = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "audio/mpeg" });
    const ici = (b: Buffer) => res.write(b);
    pousser = ici;
    connexions += 1;
    req.on("close", () => {
      if (pousser === ici) pousser = null;
    });
  });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", r));
  process.env.AFRICONTROL_ATC = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/atc.mp3`;
  atc = await import("./atc.server.ts");
  disque = await import("../disque-poste.server.ts");
});
after(async () => {
  atc.atcStop();
  serveur.closeAllConnections();
  await new Promise((r) => serveur.close(r));
  delete process.env.AFRICONTROL_ATC;
  process.chdir(cwd);
  rmSync(dossier, { recursive: true, force: true });
});

// performance.now : l'heure (Date) est avancée à la main dans le premier essai.
async function attendre(vrai: () => boolean, quoi: string): Promise<void> {
  const t0 = performance.now();
  while (!vrai()) {
    if (performance.now() - t0 > 5000) throw new Error(`jamais : ${quoi}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const lu = (f: string) => (fs.existsSync(f) ? readFileSync(f, "utf8") : null);

/** Les fichiers forcés sur le disque (FileHandle.sync) pendant `faire`, par inode. */
async function forces(faire: (inos: Set<number>) => Promise<void>): Promise<Set<number>> {
  const inos = new Set<number>();
  const temoin = await fs.promises.open(process.execPath, "r");
  const poignee = Object.getPrototypeOf(temoin) as { sync(this: FileHandle): Promise<void> };
  await temoin.close();
  const vrai = poignee.sync;
  poignee.sync = async function () {
    inos.add((await this.stat()).ino);
    return vrai.call(this);
  };
  try {
    await faire(inos);
  } finally {
    poignee.sync = vrai;
  }
  return inos;
}

/** Un enregistrement : démarré, les morceaux reçus, le segment ouvert (et sa copie attendue). */
async function enregistrer(morceaux: string[]): Promise<{ principal: string; copie: string }> {
  const avant = new Set(fs.existsSync("recordings/atc") ? readdirSync("recordings/atc") : []);
  const deja = connexions;
  atc.atcStart();
  await attendre(() => connexions > deja && pousser !== null, "le récepteur branché");
  let n = atc.atcStatus().bytes;
  for (const m of morceaux) {
    pousser!(Buffer.from(m));
    n += Buffer.byteLength(m);
    await attendre(() => atc.atcStatus().bytes === n, `« ${m} » reçu`);
  }
  const seg = readdirSync("recordings/atc").filter((f) => !avant.has(f));
  assert.equal(seg.length, 1, String(seg));
  const principal = path.join(dossier, "recordings", "atc", seg[0]!);
  return { principal, copie: disque.copieDe(principal) };
}

describe("phonie ATC : chaque morceau reçu gardé aussitôt, et doublé", () => {
  it("DOUBLÉE AU FIL DE L'EAU : la copie a chaque morceau, segment encore ouvert ; les deux forcés sur le disque toutes les 10 s, et à la fin", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    let fichiers = { principal: "", copie: "" };
    try {
      await forces(async (vus) => {
        fichiers = await enregistrer(["ID3 un ", "deux "]);
        await attendre(() => lu(fichiers.copie) === "ID3 un deux ", "la copie à jour");
        assert.equal(lu(fichiers.principal), "ID3 un deux ");
        assert.equal(atc.atcStatus().recording, true, "segment encore ouvert");
        const ino = (f: string) => statSync(f).ino;
        const tousDeux = () => vus.has(ino(fichiers.principal)) && vus.has(ino(fichiers.copie));
        vus.clear();
        t.mock.timers.tick(10_000);
        pousser!(Buffer.from("trois"));
        await attendre(tousDeux, "forcés 10 s plus tard");
        await attendre(() => lu(fichiers.copie) === "ID3 un deux trois", "la copie à jour");
        vus.clear();
        atc.atcStop();
        await attendre(tousDeux, "forcés à la fin");
      });
    } finally {
      atc.atcStop();
    }
    assert.equal(lu(fichiers.copie), lu(fichiers.principal));
    assert.equal(
      disque.defautsCopies().find((d) => d.quoi === "copie de la phonie ATC"),
      undefined,
    );
  });

  it("ARRÊT PUIS REPRISE DANS LA MÊME SECONDE : un nouveau segment, l'ancien n'est pas écrasé", async () => {
    const a = await enregistrer(["premier"]);
    atc.atcStop();
    await attendre(() => pousser === null, "le récepteur débranché");
    const b = await enregistrer(["second"]);
    atc.atcStop();
    assert.notEqual(a.principal, b.principal);
    await attendre(() => lu(b.copie) === "second", "la copie du second");
    assert.equal(lu(a.principal), "premier");
    assert.equal(lu(a.copie), "premier");
  });

  it("COPIE EN DÉFAUT (clé retirée) : l'enregistrement continue, le défaut est dit ; effacé quand la copie remarche", async () => {
    rmSync(path.join(dossier, "data"), { recursive: true, force: true });
    fs.mkdirSync(path.join(dossier, "data"));
    writeFileSync(path.join(dossier, "data", "copies"), ""); // plus de dossier des copies
    const a = await enregistrer(["sans copie"]);
    atc.atcStop();
    await attendre(() => lu(a.principal) === "sans copie", "l'enregistrement fait");
    const d = disque.defautsCopies().find((x) => x.quoi === "copie de la phonie ATC");
    assert.ok(d && d.raison.length > 0, JSON.stringify(disque.defautsCopies()));
    rmSync(path.join(dossier, "data", "copies"));
    const b = await enregistrer(["avec copie"]);
    atc.atcStop();
    await attendre(
      () => disque.defautsCopies().every((x) => x.quoi !== "copie de la phonie ATC"),
      "le défaut effacé",
    );
    assert.equal(lu(b.copie), "avec copie");
    assert.equal(lu(a.copie), "sans copie", "le segment manqué, recopié en entier");
  });

  it("COPIE QUI CASSE EN ROUTE (son fichier inouvrable, disque plein) : rattrapée — l'enregistrement continue, le défaut est dit", async (t) => {
    const T = Date.UTC(2026, 10, 9, 12, 0, 0, 123);
    t.mock.timers.enable({ apis: ["Date"], now: T });
    rmSync(path.join(dossier, "data"), { recursive: true, force: true });
    const nom = `atc-${new Date(T).toISOString().replace(/[:.]/g, "-").slice(0, 23)}Z.mp3`;
    // Un dossier à la place du fichier de copie : le dossier des copies s'ouvre, le fichier non.
    fs.mkdirSync(path.join(dossier, "data", "copies", "fichiers", "recordings", "atc", nom), {
      recursive: true,
    });
    let principal = "";
    try {
      principal = (await enregistrer(["la copie casse"])).principal;
      assert.equal(path.basename(principal), nom);
      await attendre(
        () => disque.defautsCopies().some((x) => x.quoi === "copie de la phonie ATC"),
        "le défaut dit",
      );
      pousser!(Buffer.from(", l'enregistrement continue"));
      await attendre(
        () => lu(principal) === "la copie casse, l'enregistrement continue",
        "l'enregistrement",
      );
    } finally {
      atc.atcStop();
    }
  });
});
