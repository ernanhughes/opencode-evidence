import type { Info as ToolInfo } from "@opencode/plugin/promise/tool";
import type { EvidenceClient } from "./client";
import { EVIDENCE_KINDS } from "./schema";

function text(result: unknown): { content: string } {
  return { content: JSON.stringify(result, null, 2) };
}

function failure(error: unknown): { content: string } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
}

export function EvidenceRecordTool(client: EvidenceClient): ToolInfo {
  return {
    name: "evidence_record",
    description:
      "Preserve a structured observation as an EvidenceRecord (canonicalized, hashed, stored). " +
      "Observation only: this tool never judges whether the observation proves anything. " +
      "Caller-supplied claim/confidence words inside observation stay inert data.",
    input: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...EVIDENCE_KINDS] },
        subject: { type: "string" },
        observation: {},
        source_kind: { type: "string" },
        source_locator: { type: "string" },
      },
      required: ["kind", "observation"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const args = input as {
          kind: (typeof EVIDENCE_KINDS)[number];
          subject?: string;
          observation: unknown;
          source_kind?: string;
          source_locator?: string;
        };
        const result = client.recordStructured(args.kind, args.observation, {
          ...(args.subject !== undefined ? { subject: args.subject } : {}),
          source: {
            kind: args.source_kind ?? "caller",
            ...(args.source_locator !== undefined ? { locator: args.source_locator } : {}),
          },
        });
        return text({ ok: true, ...result });
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function EvidenceCommandTool(client: EvidenceClient): ToolInfo {
  return {
    name: "evidence_command",
    description:
      "Turn an ALREADY-OBSERVED command result into evidence. This tool does NOT execute commands; " +
      "observe the process with the shell/tool first, then pass command, exit_code, stdout, stderr. " +
      "exit_code is stored as data; exit 0 is never reinterpreted as task success.",
    input: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1 },
        exit_code: { type: "integer" },
        stdout: { type: "string" },
        stderr: { type: "string" },
        cwd: { type: "string" },
        started_at: { type: "string" },
        ended_at: { type: "string" },
        subject: { type: "string" },
      },
      required: ["command", "exit_code"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const args = input as {
          command: string;
          exit_code: number;
          stdout?: string;
          stderr?: string;
          cwd?: string;
          started_at?: string;
          ended_at?: string;
          subject?: string;
        };
        const result = client.recordCommand(args);
        return text({ ok: true, ...result });
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function EvidenceFileTool(client: EvidenceClient): ToolInfo {
  return {
    name: "evidence_file",
    description:
      "Observe a local file's current state (existence, size, content hash, bounded excerpt) " +
      "and store it as evidence. Reads are bounded; large files get metadata-only records. " +
      "Missing files are valid observations (exists: false).",
    input: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        subject: { type: "string" },
        max_excerpt_bytes: { type: "integer", minimum: 0, maximum: 65536 },
        include_content: { type: "boolean" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const args = input as {
          path: string;
          subject?: string;
          max_excerpt_bytes?: number;
          include_content?: boolean;
        };
        const result = client.recordFile(args.path, {
          ...(args.subject !== undefined ? { subject: args.subject } : {}),
          ...(args.max_excerpt_bytes !== undefined
            ? { maxExcerptBytes: args.max_excerpt_bytes }
            : {}),
          ...(args.include_content !== undefined ? { includeContent: args.include_content } : {}),
        });
        return text({ ok: true, ...result });
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function EvidenceGetTool(client: EvidenceClient): ToolInfo {
  return {
    name: "evidence_get",
    description:
      "Retrieve an EvidenceRecord by id. Read-only: retrieval never mutates the record.",
    input: {
      type: "object",
      properties: {
        evidence_id: { type: "string", minLength: 1 },
      },
      required: ["evidence_id"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const args = input as { evidence_id: string };
        return text({ ok: true, record: client.get(args.evidence_id) });
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function EvidenceExplainTool(client: EvidenceClient): ToolInfo {
  return {
    name: "evidence_explain",
    description:
      "Explain an evidence record's fields, provenance, and integrity check. " +
      "States what the record does NOT establish. Never reinterprets evidence as verification.",
    input: {
      type: "object",
      properties: {
        evidence_id: { type: "string", minLength: 1 },
      },
      required: ["evidence_id"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const args = input as { evidence_id: string };
        return text({ ok: true, explanation: client.explain(args.evidence_id) });
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function EvidenceHealthTool(client: EvidenceClient): ToolInfo {
  return {
    name: "evidence_health",
    description:
      "Report plugin readiness and store writability. Runtime checks only; performs no model inference.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      return text(client.doctor());
    },
  };
}

export const EVIDENCE_TOOL_NAMES = [
  "evidence_record",
  "evidence_command",
  "evidence_file",
  "evidence_get",
  "evidence_explain",
  "evidence_health",
] as const;
