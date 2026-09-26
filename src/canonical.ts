import { createHash } from "node:crypto";

/**
 * Deterministic canonical JSON serialization.
 *
 * Rules:
 * - Object keys are sorted in UTF-16 code-unit order (default Array.sort).
 * - Object properties with `undefined` values are dropped (JSON semantics).
 * - Array items that are `undefined` become `null` (JSON semantics).
 * - Non-finite numbers become `null` (JSON semantics).
 * - Date instances serialize as ISO strings.
 * - bigint, function, and symbol values throw: they have no stable JSON form.
 * - No whitespace is emitted.
 */
export function canonicalize(value: unknown): string {
  return stringifyCanonical(value);
}

function stringifyCanonical(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value as number)) return "null";
    return JSON.stringify(value);
  }
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (t === "bigint") {
    throw new Error("EVIDENCE_NON_JSON_VALUE: bigint has no canonical JSON form");
  }
  if (t === "function" || t === "symbol") {
    throw new Error(`EVIDENCE_NON_JSON_VALUE: ${t} has no canonical JSON form`);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonical(item)).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifyCanonical(obj[k])}`).join(",")}}`;
  }
  throw new Error(`EVIDENCE_NON_JSON_VALUE: unsupported typeof ${t}`);
}

/** Canonical JSON re-serialized for human-inspectable storage (sorted keys, 2-space indent). */
export function prettyCanonical(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalize(value)), null, 2)}\n`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function sha256BytesHex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
