import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { disquesLinux, disquesPhysiques } from "./disque-physique.server.ts";

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
    "LINUX (cette machine) : le dossier du serveur a son disque ; un disque en mémoire (tmpfs), aucun",
    { skip: process.platform !== "linux" },
    async () => {
      const ici = await disquesPhysiques(process.cwd());
      assert.ok(ici && ici.length > 0, JSON.stringify(ici));
      assert.equal(await disquesPhysiques("/dev/shm"), null);
    },
  );

  it(
    "WINDOWS (CIM) : la lettre du lecteur a son disque ; un partage réseau, aucun ; la réponse gardée",
    { skip: process.platform !== "win32" },
    async () => {
      const c = await disquesPhysiques("C:\\");
      assert.ok(c && c.every((n) => /^\d+$/.test(n)), JSON.stringify(c));
      const t0 = performance.now();
      assert.deepEqual(await disquesPhysiques("c:\\Windows"), c, "même lettre, même disque");
      assert.ok(performance.now() - t0 < 50, "gardée : pas un second PowerShell");
      assert.equal(await disquesPhysiques("\\\\serveur\\partage\\copies"), null);
    },
  );
});
