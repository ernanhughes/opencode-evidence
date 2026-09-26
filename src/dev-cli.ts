/** Developer CLI: health, smoke, and offline load checks. No model inference. */
import { statSync } from "node:fs";
import { join } from "node:path";
import { EvidenceClient } from "./client";
import { verifyIntegrity } from "./identity";
import { FORBIDDEN_TOP_LEVEL_FIELDS } from "./schema";

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function check(cond: boolean, message: string): void {
  if (!cond) fail(message);
  console.log(`ok: ${message}`);
}

async function cmdHealth(projectDir: string): Promise<void> {
  const client = new EvidenceClient(projectDir);
  console.log(JSON.stringify(client.doctor(), null, 2));
}

async function cmdLoad(projectDir: string): Promise<void> {
  // Prove the plugin module loads and registers exactly the expected tools,
  // using a fake OpenCode ctx (offline structural check, no model, no server).
  const mod = await import("./plugin");
  check(typeof mod.default === "object" && mod.default !== null, "plugin module loads with default export");
  const plugin = mod.default as {
    setup: (ctx: unknown) => Promise<void>;
  };
  check(typeof plugin.setup === "function", "plugin exposes setup()");
  const added: string[] = [];
  const fakeCtx = {
    location: { directory: projectDir },
    tool: {
      transform: async (fn: (editor: { add: (t: { name: string }) => void }) => void) => {
        fn({ add: (t) => void added.push(t.name) });
      },
    },
    session: { hook: async () => {} },
  };
  await plugin.setup(fakeCtx);
  const expected = [
    "evidence_record",
    "evidence_command",
    "evidence_file",
    "evidence_get",
    "evidence_explain",
    "evidence_health",
  ];
  check(
    JSON.stringify(added) === JSON.stringify(expected),
    `tools registered: ${added.join(", ")}`,
  );

  const client = new EvidenceClient(projectDir);
  const health = client.doctor() as { ok: boolean; model_inference: string };
  check(health.model_inference === "none", "health reports model_inference=none");
  console.log(JSON.stringify({ load: "PASS", tools: added, health }, null, 2));
}

async function cmdSmoke(projectDir: string): Promise<void> {
  const client = new EvidenceClient(projectDir);
  console.log(`store: ${(client.doctor() as { store_dir: string }).store_dir}`);

  // Demo 1: observe package.json, retrieve, re-verify hash. No correctness claim.
  const pkgPath = join(projectDir, "package.json");
  try {
    statSync(pkgPath);
  } catch {
    fail("smoke needs package.json in the project dir");
  }
  const fileRes = client.recordFile("package.json", { subject: "package-manifest" });
  console.log(`file evidence: ${fileRes.record.evidence_id}`);
  const fetched = client.get(fileRes.record.evidence_id);
  const integrity = verifyIntegrity(fetched);
  check(integrity.ok, "file record round-trips with matching content hash");
  const obs = fetched.observation as Record<string, unknown>;
  check(obs["exists"] === true, "file observation reports exists:true");
  check(typeof obs["file_hash"] === "string", "file observation carries a content hash");
  check(
    FORBIDDEN_TOP_LEVEL_FIELDS.every((f) => (fetched as Record<string, unknown>)[f] === undefined),
    "file record carries no verdict fields",
  );
  console.log("note: this record does NOT claim package.json is correct.");

  // Demo 2: observed test result stays observation, never becomes verification.
  const testRes = client.recordCommand({
    command: "bun test",
    exit_code: 0,
    stdout: "42 passed, 0 failed",
    subject: "test-suite",
  });
  console.log(`command evidence: ${testRes.record.evidence_id}`);
  const testFetched = client.get(testRes.record.evidence_id);
  const testObs = testFetched.observation as Record<string, unknown>;
  check(testObs["exit_code"] === 0, "exit_code preserved as observed data");
  const topKeys = Object.keys(testFetched);
  check(
    !topKeys.some((k) => ["verified", "verdict", "task_success", "task_verified", "confidence", "success"].includes(k)),
    "exit_code 0 did NOT become verified/task_success",
  );
  const explanation = client.explain(testRes.record.evidence_id) as {
    does_not_establish: string[];
  };
  check(
    Array.isArray(explanation.does_not_establish) && explanation.does_not_establish.length > 0,
    "explanation states what is NOT established",
  );
  console.log("SMOKE PASS");
}

const [, , cmd] = process.argv;
const projectDir = process.cwd();
if (cmd === "health") await cmdHealth(projectDir);
else if (cmd === "load") await cmdLoad(projectDir);
else if (cmd === "smoke") await cmdSmoke(projectDir);
else {
  console.error("usage: dev-cli.ts <health|load|smoke>");
  process.exit(2);
}
