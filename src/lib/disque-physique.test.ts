import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { disquesLinux, disquesPhysiques, enMemoireVive } from "./disque-physique.server.ts";

let racine = "";
before(() => {
  racine = mkdtempSync(path.join(tmpdir(), "disque-physique-"));
});
after(() => rmSync(racine, { recursive: true, force: true }));

describe("disque physique d'un dossier — pas son volume : deux partitions d'un même disque meurent ensemble", () => {
  it(
    "LINUX (montages et /sys d'essai) : partition → son disque ; LVM, RAID → ceux qui les portent ; NVMe ; nom à espaces ; réseau → inconnu",
    { skip: process.platform === "win32" },
    async () => {
      const sys = path.join(racine, "sys");
      const appareil = (p: string, partition: boolean) => {
        mkdirSync(path.join(sys, "devices", p), { recursive: true });
        if (partition) writeFileSync(path.join(sys, "devices", p, "partition"), "1\n");
      };
      appareil("pci0/block/sda/sda1", true);
      appareil("pci0/block/sda/sda2", true);
      appareil("pci0/block/sdb/sdb1", true);
      appareil("pci0/nvme/nvme0n1/nvme0n1p1", true);
      for (const [v, portants] of [
        ["dm-0", ["pci0/block/sda/sda2"]],
        ["md0", ["pci0/block/sda/sda1", "pci0/block/sdb/sdb1"]],
      ] as const) {
        mkdirSync(path.join(sys, "devices", "virtual", "block", v, "slaves"), { recursive: true });
        for (const p of portants) {
          symlinkSync(
            path.join(sys, "devices", p),
            path.join(sys, "devices", "virtual", "block", v, "slaves", path.basename(p)),
          );
        }
      }
      mkdirSync(path.join(sys, "dev", "block"), { recursive: true });
      for (const [numero, cible] of [
        ["8:1", "pci0/block/sda/sda1"],
        ["8:17", "pci0/block/sdb/sdb1"],
        ["253:0", "virtual/block/dm-0"],
        ["9:0", "virtual/block/md0"],
        ["259:1", "pci0/nvme/nvme0n1/nvme0n1p1"],
      ]) {
        symlinkSync(path.join(sys, "devices", cible), path.join(sys, "dev", "block", numero));
      }
      const m = (n: string) => path.join(racine, "m", n);
      for (const d of [
        "data/sous",
        "copies",
        "raid",
        "nvme disque",
        "reseau",
        "ailleurs",
        "dessus",
      ]) {
        mkdirSync(m(d), { recursive: true });
      }
      const echappe = (p: string) => p.replace(/ /g, "\\040");
      const mountinfo = path.join(racine, "mountinfo");
      writeFileSync(
        mountinfo,
        [
          "22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw",
          `23 22 253:0 / ${m("data")} rw - ext4 /dev/mapper/vg-data rw`,
          `24 22 8:17 / ${m("copies")} rw shared:5 - ext4 /dev/sdb1 rw`,
          `25 22 9:0 / ${m("raid")} rw - ext4 /dev/md0 rw`,
          `26 22 259:1 / ${echappe(m("nvme disque"))} rw - ext4 /dev/nvme0n1p1 rw`,
          `27 22 0:50 / ${m("reseau")} rw - nfs4 serveur:/partage rw`,
          `28 22 8:17 / ${m("dessus")} rw - ext4 /dev/sdb1 rw`,
          `29 28 8:1 / ${m("dessus")} rw - ext4 /dev/sda1 rw`, // monté par-dessus
          "",
        ].join("\n"),
      );
      const r = { mountinfo, sys };
      assert.deepEqual(await disquesLinux(m("data/sous"), r), ["sda"], "LVM sur sda2");
      assert.deepEqual(await disquesLinux(m("copies"), r), ["sdb"]);
      assert.deepEqual(await disquesLinux(m("raid"), r), ["sda", "sdb"], "RAID sur sda1 et sdb1");
      assert.deepEqual(await disquesLinux(m("nvme disque"), r), ["nvme0n1"]);
      assert.equal(await disquesLinux(m("reseau"), r), null, "réseau : pas un disque d'ici");
      assert.deepEqual(await disquesLinux(m("ailleurs"), r), ["sda"], "sous / : sda1");
      assert.deepEqual(
        await disquesLinux(m("dessus"), r),
        ["sda"],
        "deux au même endroit : le dernier",
      );
      assert.equal(await disquesLinux(path.join(racine, "absent"), r), null);
    },
  );

  it(
    "LINUX : un disque loop (fichier image) a le disque de son fichier ; une mémoire vive (zram) se reconnaît",
    { skip: process.platform === "win32" },
    async () => {
      const sys = path.join(racine, "sys-loop");
      const dev = (nom: string, cible: string) => {
        mkdirSync(path.join(sys, "dev", "block"), { recursive: true });
        symlinkSync(path.join(sys, "devices", cible), path.join(sys, "dev", "block", nom));
      };
      const appareil = (p: string, partition = false) => {
        mkdirSync(path.join(sys, "devices", p), { recursive: true });
        if (partition) writeFileSync(path.join(sys, "devices", p, "partition"), "1\n");
      };
      const m = (n: string) => path.join(racine, "ml", n);
      // sda1 porte /poste ; sdb1, /autre ; les images des loops sont posées sur l'un ou l'autre.
      appareil("pci0/block/sda/sda1", true);
      appareil("pci0/block/sdb/sdb1", true);
      dev("8:1", "pci0/block/sda/sda1");
      dev("8:17", "pci0/block/sdb/sdb1");
      const image = (loop: string, fichier: string) => {
        appareil(`virtual/block/${loop}/loop`);
        writeFileSync(
          path.join(sys, "devices", "virtual", "block", loop, "loop", "backing_file"),
          `${fichier}\n`,
        );
      };
      image("loop0", path.join(m("poste"), "images", "cle.img"));
      dev("7:0", "virtual/block/loop0");
      // Un loop partitionné, son image sur l'autre disque.
      image("loop1", path.join(m("autre"), "disque.img"));
      appareil("virtual/block/loop1/loop1p1", true);
      dev("259:5", "virtual/block/loop1/loop1p1");
      // Image effacée depuis : le noyau l'écrit « … (deleted) ».
      image("loop2", "/nulle/part/vieux.img (deleted)");
      dev("7:2", "virtual/block/loop2");
      // Une image posée dans son propre montage : la remontée s'arrête.
      image("loop3", path.join(m("boucle"), "soi.img"));
      dev("7:3", "virtual/block/loop3");
      appareil("virtual/block/zram0");
      dev("251:0", "virtual/block/zram0");
      // Une image posée en mémoire vive (tmpfs) : le loop est en mémoire vive lui aussi.
      image("loop4", path.join(m("shm"), "vive.img"));
      dev("7:4", "virtual/block/loop4");
      const dossiers = ["poste/images", "autre", "cle", "partitionne", "efface", "boucle", "zram"];
      for (const d of [...dossiers, "shm", "ramfs", "loop-vive"]) {
        mkdirSync(m(d), { recursive: true });
      }
      for (const f of [
        "poste/images/cle.img",
        "autre/disque.img",
        "boucle/soi.img",
        "shm/vive.img",
      ])
        writeFileSync(m(f), "");
      const mountinfo = path.join(racine, "mountinfo-loop");
      writeFileSync(
        mountinfo,
        [
          `30 1 8:1 / ${m("poste")} rw - ext4 /dev/sda1 rw`,
          `31 1 8:17 / ${m("autre")} rw - ext4 /dev/sdb1 rw`,
          `32 1 7:0 / ${m("cle")} rw - ext4 /dev/loop0 rw`,
          `33 1 259:5 / ${m("partitionne")} rw - ext4 /dev/loop1p1 rw`,
          `34 1 7:2 / ${m("efface")} rw - ext4 /dev/loop2 rw`,
          `35 1 7:3 / ${m("boucle")} rw - ext4 /dev/loop3 rw`,
          `36 1 251:0 / ${m("zram")} rw - ext4 /dev/zram0 rw`,
          `37 1 0:41 / ${m("shm")} rw - tmpfs tmpfs rw,size=65536k`,
          `38 1 0:42 / ${m("ramfs")} rw - ramfs none rw`,
          `39 1 7:4 / ${m("loop-vive")} rw - ext4 /dev/loop4 rw`,
          "",
        ].join("\n"),
      );
      const r = { mountinfo, sys };
      assert.deepEqual(
        await disquesLinux(m("cle"), r),
        ["sda"],
        "le loop : le disque de son image",
      );
      assert.deepEqual(await disquesLinux(m("partitionne"), r), ["sdb"], "sa partition aussi");
      assert.equal(await disquesLinux(m("efface"), r), null, "image effacée : on ne sait pas");
      assert.equal(
        await disquesLinux(m("boucle"), r),
        null,
        "image dans son propre montage : pas de boucle sans fin",
      );
      assert.deepEqual(await disquesLinux(m("zram"), r), ["zram0"]);
      assert.deepEqual(await disquesLinux(m("shm"), r), ["tmpfs"], "tmpfs : dit par son type");
      assert.deepEqual(await disquesLinux(m("ramfs"), r), ["ramfs"]);
      assert.deepEqual(await disquesLinux(m("loop-vive"), r), ["tmpfs"], "image en mémoire vive");
      assert.equal(enMemoireVive(["zram0"]), true);
      assert.equal(enMemoireVive(["sda", "ram1"]), true);
      assert.equal(enMemoireVive(["tmpfs"]), true);
      assert.equal(enMemoireVive(["ramfs"]), true);
      assert.equal(enMemoireVive(["sda", "nvme0n1"]), false);
      for (const nom of ["zramX", "ram", "xtmpfs", "ramfs1", "sdram0"]) {
        assert.equal(enMemoireVive([nom]), false, nom);
      }
      assert.equal(enMemoireVive(null), false);
    },
  );

  it(
    "LINUX : un montage sans périphérique propre (btrfs, « 0:… ») est pris par sa source, quand c'en est un",
    { skip: process.platform !== "linux" },
    async (t) => {
      // La source du « / » de cette machine, si c'est un vrai périphérique (pas dans un conteneur).
      const racineMachine = (await import("node:fs"))
        .readFileSync("/proc/self/mountinfo", "utf8")
        .split("\n")
        .map((l) => l.split(" "))
        .find((c) => c[4] === "/");
      const source = racineMachine?.[racineMachine.indexOf("-") + 2];
      const attendu = await disquesLinux("/");
      if (!source?.startsWith("/dev/") || attendu === null) return t.skip("pas de disque sous /");
      const sous = path.join(racine, "btrfs");
      mkdirSync(sous, { recursive: true });
      const mountinfo = path.join(racine, "mountinfo-btrfs");
      writeFileSync(mountinfo, `40 1 0:60 / ${sous} rw - btrfs ${source} rw\n`);
      assert.deepEqual(await disquesLinux(sous, { mountinfo, sys: "/sys" }), attendu);
    },
  );

  it(
    "LINUX (cette machine) : le dossier du serveur a son disque ; /dev/shm, la mémoire vive (tmpfs)",
    { skip: process.platform !== "linux" },
    async () => {
      const ici = await disquesPhysiques(process.cwd());
      assert.ok(ici && ici.length > 0, JSON.stringify(ici));
      assert.equal(enMemoireVive(ici), false, JSON.stringify(ici));
      assert.deepEqual(await disquesPhysiques("/dev/shm"), ["tmpfs"]);
    },
  );

  it(
    "LINUX (cette machine) : le script de préparation et le serveur disent les mêmes disques, montage par montage — loops, zram, tmpfs compris ; la racine dite « /dev/root » se lit par /sys",
    { skip: process.platform !== "linux" },
    async (t) => {
      const script = readFileSync(
        path.join(import.meta.dirname, "..", "..", "scripts", "poste", "preparer-poste.sh"),
        "utf8",
      );
      const fonction = (nom: string) =>
        script.match(new RegExp(`^${nom}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, "m"))?.[0];
      const disquesDe = fonction("disques_de");
      const memoire = fonction("en_memoire_vive");
      assert.ok(disquesDe && memoire, "disques_de et en_memoire_vive dans le script");
      const outils = ["findmnt", "lsblk"].every(
        (o) => spawnSync(o, ["--version"], { stdio: "ignore" }).status === 0,
      );
      if (!outils) return t.skip("findmnt et lsblk (util-linux) absents");
      // Le script lancé sur un chemin ; `masque` : ce que findmnt dit de la source du montage.
      const parScript = (chemin: string, masque = "") => {
        const r = spawnSync(
          "bash",
          [
            "-c",
            `set -euo pipefail\n${masque}\n${disquesDe}\n${memoire}\nd=$(disques_de "$1")\necho "$d"\nif en_memoire_vive "$d"; then echo VIVE; fi`,
            "essai",
            chemin,
          ],
          { encoding: "utf8" },
        );
        assert.equal(r.status, 0, r.stderr);
        const lignes = r.stdout.split("\n").filter(Boolean);
        return { disques: lignes.filter((l) => l !== "VIVE"), vive: lignes.includes("VIVE") };
      };
      const decoder = (s: string) =>
        s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
      const points = [
        ...new Set(
          readFileSync("/proc/self/mountinfo", "utf8")
            .split("\n")
            .map((l) => l.split(" "))
            .filter((c) => c.length > 6)
            .map((c) => decoder(c[4]!)),
        ),
      ].filter((p) => !/^\/(proc|sys)(\/|$)/.test(p));
      let vus = 0;
      for (const p of points) {
        try {
          realpathSync(p);
        } catch {
          continue; // pas lisible par ce compte
        }
        const serveur = await disquesLinux(p);
        const sh = parScript(p);
        assert.deepEqual(
          sh.disques,
          serveur ?? [],
          `${p} : script ${sh.disques}, serveur ${serveur}`,
        );
        assert.equal(sh.vive, enMemoireVive(serveur), p);
        vus++;
      }
      assert.ok(vus > 0);
      // Les noms de la mémoire vive, et seulement eux (un disque parmi d'autres suffit).
      const vive = (disques: string) =>
        spawnSync("bash", ["-c", `${memoire}\nen_memoire_vive "$1"`, "essai", disques]).status ===
        0;
      for (const d of ["zram0", "ram1", "tmpfs", "ramfs", "sda\nzram12"]) assert.ok(vive(d), d);
      for (const d of ["", "sda", "nvme0n1", "zramX", "ram", "xtmpfs", "ramfs1", "sdram0"]) {
        assert.ok(!vive(d), d);
      }
      // La racine dite « /dev/root » (qui n'existe pas) : son disque se lit quand même, par /sys.
      const racineServeur = await disquesLinux("/");
      if (racineServeur === null) return t.skip("pas de disque sous / (conteneur)");
      const masque = `findmnt() { if [[ " $* " == *" SOURCE "* ]]; then echo /dev/root; else command findmnt "$@"; fi; }`;
      assert.deepEqual(parScript("/", masque).disques, racineServeur);
    },
  );

  it(
    "WINDOWS (CIM) : la lettre du lecteur a son disque ; un dossier absent ou un partage réseau, aucun ; la réponse gardée",
    { skip: process.platform !== "win32" },
    async () => {
      const c = await disquesPhysiques("C:\\");
      assert.ok(c && c.every((n) => /^\d+$/.test(n)), JSON.stringify(c));
      const t0 = performance.now();
      assert.deepEqual(await disquesPhysiques("c:\\Windows"), c, "même lettre, même disque");
      assert.ok(performance.now() - t0 < 50, "gardée : pas un second PowerShell");
      assert.equal(
        await disquesPhysiques(path.join(racine, "cle-retiree")),
        null,
        "absent : pas le disque de sa lettre",
      );
      assert.equal(await disquesPhysiques("\\\\serveur\\partage\\copies"), null);
    },
  );
});
