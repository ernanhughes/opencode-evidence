import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256Hex } from "./canonical";

export type EvidenceConfig = {
  store_dir?: string;
};

/**
 * Storage decision (v0.1):
 * - Default: a user-data location OUTSIDE the repository, namespaced per
 *   project by a hash of the canonical project path. Evidence can contain
 *   secrets, excerpts, and runtime output; it must not become committed
 *   source by accident.
 * - Override: OPENCODE_EVIDENCE_DIR env var, or { "store_dir": ... } in
 *   <project>/.opencode/evidence.json (relative paths resolve against the
 *   project dir). Project-local stores are explicit opt-in.
 */
export function defaultStoreDir(projectDir: string): string {
  const canonical = resolve(projectDir).replace(/\\/g, "/").toLowerCase();
  const slug = sha256Hex(canonical).slice(0, 12);
  return join(userDataDir(), "opencode-evidence", "projects", `ev-${slug}`);
}

function userDataDir(): string {
  if (process.platform === "win32") {
    return process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
  }
  return process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
}

export function loadFileConfig(projectDir: string): EvidenceConfig {
  const path = join(resolve(projectDir), ".opencode", "evidence.json");
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`EVIDENCE_CONFIG_INVALID: ${path} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`EVIDENCE_CONFIG_INVALID: ${path} must be a JSON object`);
  }
  const cfg = parsed as Record<string, unknown>;
  if (cfg["store_dir"] !== undefined && typeof cfg["store_dir"] !== "string") {
    throw new Error(`EVIDENCE_CONFIG_INVALID: store_dir must be a string`);
  }
  const out: EvidenceConfig = {};
  if (typeof cfg["store_dir"] === "string" && cfg["store_dir"].length > 0) {
    out.store_dir = cfg["store_dir"];
  }
  return out;
}

export function resolveStoreDir(projectDir: string, overrides: EvidenceConfig = {}): string {
  const env = process.env["OPENCODE_EVIDENCE_DIR"];
  if (env && env.length > 0) return resolve(env);
  const fileCfg = loadFileConfig(projectDir);
  const configured = overrides.store_dir ?? fileCfg.store_dir;
  if (configured && configured.length > 0) {
    return resolve(projectDir, configured);
  }
  return defaultStoreDir(projectDir);
}

/** Scratch fallback for tests/smoke runs that must not touch user data. */
export function tempStoreDir(prefix = "opencode-evidence-"): string {
  return join(tmpdir(), `${prefix}${Date.now()}-${process.pid}`);
}
