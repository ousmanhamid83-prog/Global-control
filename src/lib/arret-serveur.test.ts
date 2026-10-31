import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { delaiArret, filetArretUtile } from "./arret-serveur.ts";

const MODULE = new URL("./arret-serveur.ts", import.meta.url).href;

/**
 * Lance un vrai processus Node qui arme le filet, attend qu'il soit prêt, lui envoie les signaux
 * demandés, et rend son code de sortie et le temps qu'il a mis à s'éteindre après le premier signal.
 */
function processusArme(
  corps: string,
  signaux: NodeJS.Signals[],
): Promise<{ code: number | null; ms: number }> {
  const code = `import { armerArret } from ${JSON.stringify(MODULE)};\n${corps}\nconsole.log("prêt");`;
  const enfant = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  return new Promise((resolve, reject) => {
    let t0 = 0;
    const garde = setTimeout(() => {
      enfant.kill("SIGKILL");
      reject(new Error("le processus ne s'est pas arrêté"));
    }, 8000);
    enfant.stdout.once("data", () => {
      t0 = Date.now();
      for (const [i, s] of signaux.entries()) setTimeout(() => enfant.kill(s), i * 50);
    });
    enfant.on("exit", (c) => {
      clearTimeout(garde);
      resolve({ code: c, ms: Date.now() - t0 });
    });
  });
}

describe("arrêt du serveur autonome", () => {
  it("FILET : un flux qui retient le processus n'empêche plus l'arrêt, une fois le délai passé", async () => {
    // L'intervalle jamais libéré joue le récepteur GPS série ou l'enregistrement ATC.
    const r = await processusArme(
      `setInterval(() => {}, 1000);\narmerArret(process, (c) => process.exit(c), 300);`,
      ["SIGTERM"],
    );
    assert.equal(r.code, 0);
    assert.ok(r.ms >= 250, `arrêté trop tôt (${r.ms} ms) : le délai de fermeture doit être laissé`);
  });

  it("NE RETIENT RIEN : un processus qui s'éteint seul s'éteint aussitôt, sans attendre le délai", async () => {
    // Le reste du serveur se libère sur le signal ; le filet (60 s) ne doit pas le garder en vie.
    const r = await processusArme(
      `const t = setInterval(() => {}, 1000);\nprocess.on("SIGTERM", () => clearInterval(t));\narmerArret(process, (c) => process.exit(c), 60000);`,
      ["SIGTERM"],
    );
    assert.equal(r.code, 0);
    assert.ok(r.ms < 3000, `${r.ms} ms : le filet retient le processus`);
  });

  it("SECOND CTRL+C : l'opérateur insiste, arrêt immédiat avec le code de SIGINT", async () => {
    const r = await processusArme(
      `setInterval(() => {}, 1000);\narmerArret(process, (c) => process.exit(c), 60000);`,
      ["SIGINT", "SIGINT"],
    );
    assert.equal(r.code, 130);
    assert.ok(r.ms < 3000);
  });

  it("SECOND SIGTERM : arrêt immédiat avec le code de SIGTERM", async () => {
    const r = await processusArme(
      `setInterval(() => {}, 1000);\narmerArret(process, (c) => process.exit(c), 60000);`,
      ["SIGTERM", "SIGTERM"],
    );
    assert.equal(r.code, 143);
  });

  it("DÉLAI : celui de srvx (SERVER_SHUTDOWN_TIMEOUT, 5 s par défaut) plus 2 s de marge", () => {
    assert.equal(delaiArret(undefined), 7000);
    assert.equal(delaiArret(""), 7000);
    assert.equal(delaiArret("n'importe quoi"), 7000);
    assert.equal(delaiArret("10"), 12000);
  });

  it("PORTÉE : serveur construit seulement, jamais en dev, sur Vercel ni en CI/TEST", () => {
    assert.equal(filetArretUtile(false, {}), true);
    assert.equal(filetArretUtile(true, {}), false);
    assert.equal(filetArretUtile(false, { VERCEL: "1" }), false);
    assert.equal(filetArretUtile(false, { CI: "true" }), false);
    assert.equal(filetArretUtile(false, { TEST: "1" }), false);
  });
});
