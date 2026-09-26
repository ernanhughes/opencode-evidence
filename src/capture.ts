import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { canonicalize, sha256BytesHex } from "./canonical";
import { computeContentHash, deriveEvidenceId } from "./identity";
import type { EvidenceKind, EvidenceRecord, EvidenceSource } from "./schema";
import { isEvidenceKind } from "./schema";
import { EVIDENCE_SCHEMA, PLUGIN_ID, PLUGIN_VERSION } from "./version";

/** Bounds: evidence must stay small, local, and inspectable. */
export const MAX_OUTPUT_CHARS = 16_000;
export const MAX_EXCERPT_BYTES = 8_192;
export const MAX_FILE_HASH_BYTES = 20_971_520; // 20 MiB: above this, metadata-only
export const MAX_OBSERVATION_BYTES = 262_144; // 256 KiB canonical observation cap

export type BuildRecordInput = {
  kind: EvidenceKind;
  subject?: string;
  observation: unknown;
  source: EvidenceSource;
  observed_at?: string;
  producerVersion?: string;
  metadata?: Record<string, unknown>;
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Core constructor. Pure: no I/O, no inference. Enforces size caps. */
export function buildRecord(input: BuildRecordInput): EvidenceRecord {
  if (!isEvidenceKind(input.kind)) {
    throw new Error(`EVIDENCE_BAD_KIND: unsupported kind ${String(input.kind)}`);
  }
  if (input.observation === undefined) {
    throw new Error("EVIDENCE_MISSING_OBSERVATION: observation must be present");
  }
  if (!input.source || typeof input.source.kind !== "string" || input.source.kind.length === 0) {
    throw new Error("EVIDENCE_BAD_SOURCE: source.kind must be a non-empty string");
  }
  // Canonicalization doubles as a JSON-compatibility gate (throws on bigint/function/symbol).
  const observationBytes = canonicalize(input.observation).length;
  if (observationBytes > MAX_OBSERVATION_BYTES) {
    throw new Error(
      `EVIDENCE_TOO_LARGE: canonical observation is ${observationBytes} bytes (cap ${MAX_OBSERVATION_BYTES})`,
    );
  }
  const observed_at = input.observed_at ?? nowIso();
  if (Number.isNaN(Date.parse(observed_at))) {
    throw new Error("EVIDENCE_BAD_TIME: observed_at must be a parseable timestamp string");
  }
  const kind = input.kind;
  const subject = input.subject;
  const source: EvidenceSource = {
    kind: input.source.kind,
    ...(input.source.locator !== undefined ? { locator: input.source.locator } : {}),
    ...(input.source.version !== undefined ? { version: input.source.version } : {}),
  };
  const content_hash = computeContentHash({ kind, subject, observation: input.observation, source });
  const evidence_id = deriveEvidenceId(content_hash);
  const record: EvidenceRecord = {
    schema: EVIDENCE_SCHEMA,
    evidence_id,
    kind,
    ...(subject !== undefined ? { subject } : {}),
    observation: input.observation,
    source,
    observed_at,
    content_hash,
    producer: { plugin: PLUGIN_ID, version: input.producerVersion ?? PLUGIN_VERSION },
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
  return record;
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}

export type CommandResultInput = {
  command: string;
  exit_code: number;
  stdout?: string;
  stderr?: string;
  cwd?: string;
  started_at?: string;
  ended_at?: string;
  subject?: string;
  sourceLocator?: string;
};

/**
 * Normalize an ALREADY-OBSERVED command result into evidence.
 * This function never executes anything: the caller (agent shell tool,
 * test harness, CI log) observed the process; we only normalize + bound it.
 * exit_code is preserved as data. No success/verified field is derived.
 */
export function normalizeCommandResult(input: CommandResultInput): BuildRecordInput {
  if (typeof input.command !== "string" || input.command.length === 0) {
    throw new Error("EVIDENCE_BAD_COMMAND: command must be a non-empty string");
  }
  if (!Number.isInteger(input.exit_code)) {
    throw new Error("EVIDENCE_BAD_EXIT_CODE: exit_code must be an integer");
  }
  const stdout = truncateText(input.stdout ?? "", MAX_OUTPUT_CHARS);
  const stderr = truncateText(input.stderr ?? "", MAX_OUTPUT_CHARS);
  return {
    kind: "command_result",
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    observation: {
      command: input.command,
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      exit_code: input.exit_code,
      stdout: stdout.text,
      stdout_truncated: stdout.truncated,
      stderr: stderr.text,
      stderr_truncated: stderr.truncated,
      ...(input.started_at !== undefined ? { started_at: input.started_at } : {}),
      ...(input.ended_at !== undefined ? { ended_at: input.ended_at } : {}),
    },
    source: { kind: "process", locator: input.sourceLocator ?? "local" },
  };
}

export type TestResultInput = {
  runner?: string;
  command?: string;
  exit_code?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  duration_ms?: number;
  output?: string;
  subject?: string;
  sourceLocator?: string;
};

/** Normalize caller-supplied test counts. Counts are data; no pass/fail verdict is derived. */
export function normalizeTestResult(input: TestResultInput): BuildRecordInput {
  for (const key of ["passed", "failed", "skipped", "exit_code", "duration_ms"] as const) {
    const v = input[key];
    if (v !== undefined && (!Number.isFinite(v) || (key !== "duration_ms" && !Number.isInteger(v)))) {
      throw new Error(`EVIDENCE_BAD_TEST_RESULT: ${key} must be a finite number`);
    }
  }
  const output = truncateText(input.output ?? "", MAX_OUTPUT_CHARS);
  return {
    kind: "test_result",
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    observation: {
      ...(input.runner !== undefined ? { runner: input.runner } : {}),
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.exit_code !== undefined ? { exit_code: input.exit_code } : {}),
      ...(input.passed !== undefined ? { passed: input.passed } : {}),
      ...(input.failed !== undefined ? { failed: input.failed } : {}),
      ...(input.skipped !== undefined ? { skipped: input.skipped } : {}),
      ...(input.duration_ms !== undefined ? { duration_ms: input.duration_ms } : {}),
      output_excerpt: output.text,
      output_truncated: output.truncated,
    },
    source: { kind: "test-runner", locator: input.sourceLocator ?? "local" },
  };
}

export type FileObservationOptions = {
  subject?: string;
  maxExcerptBytes?: number;
  includeContent?: boolean;
};

/**
 * Observe a file's current state. Reads are bounded; files larger than
 * MAX_FILE_HASH_BYTES get a metadata-only record (no hash, no excerpt)
 * rather than a lossy rewrite. Missing files are valid observations
 * ({ exists: false }), not errors.
 */
export function observeFile(
  projectDir: string,
  targetPath: string,
  opts: FileObservationOptions = {},
): BuildRecordInput {
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    throw new Error("EVIDENCE_BAD_PATH: path must be a non-empty string");
  }
  const absolute = isAbsolute(targetPath) ? resolve(targetPath) : resolve(projectDir, targetPath);
  const rel = relative(resolve(projectDir), absolute);
  const displayPath = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : absolute;
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(absolute);
  } catch {
    return {
      kind: "file_observation",
      ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
      observation: { path: displayPath, exists: false },
      source: { kind: "filesystem", locator: absolute },
    };
  }
  if (stat.isDirectory()) {
    return {
      kind: "file_observation",
      ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
      observation: {
        path: displayPath,
        exists: true,
        is_directory: true,
        mtime: stat.mtime.toISOString(),
      },
      source: { kind: "filesystem", locator: absolute },
    };
  }
  const size = stat.size;
  const mtime = stat.mtime.toISOString();
  if (size > MAX_FILE_HASH_BYTES) {
    return {
      kind: "file_observation",
      ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
      observation: {
        path: displayPath,
        exists: true,
        size,
        mtime,
        content_omitted: `size ${size} exceeds hash cap ${MAX_FILE_HASH_BYTES}`,
      },
      source: { kind: "filesystem", locator: absolute },
    };
  }
  const bytes = readFileSync(absolute);
  const file_hash = sha256BytesHex(bytes);
  const includeContent = opts.includeContent ?? true;
  const maxExcerpt = opts.maxExcerptBytes ?? MAX_EXCERPT_BYTES;
  const excerptBytes = includeContent ? bytes.subarray(0, maxExcerpt) : Buffer.alloc(0);
  return {
    kind: "file_observation",
    ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
    observation: {
      path: displayPath,
      exists: true,
      size,
      mtime,
      file_hash,
      ...(includeContent
        ? {
            content_excerpt: excerptBytes.toString("utf8"),
            excerpt_truncated: bytes.length > excerptBytes.length,
          }
        : { content_omitted: "excerpt excluded by caller" }),
    },
    source: { kind: "filesystem", locator: absolute },
  };
}

/** Generic escape hatch: canonicalize + bound caller-supplied JSON-like state. */
export function recordStructured(
  kind: EvidenceKind,
  observation: unknown,
  opts: {
    subject?: string;
    source?: EvidenceSource;
    observed_at?: string;
    metadata?: Record<string, unknown>;
  } = {},
): EvidenceRecord {
  return buildRecord({
    kind,
    ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
    observation,
    source: opts.source ?? { kind: "caller" },
    ...(opts.observed_at !== undefined ? { observed_at: opts.observed_at } : {}),
    ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
  });
}
