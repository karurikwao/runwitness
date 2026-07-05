import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import { createRunId, createStepId } from "./ids.js";
import type {
  AppendReceiptInput,
  CreateRunInput,
  CreateStepInput,
  EventKind,
  ListRunsOptions,
  ReceiptExportRecord,
  ReceiptSummary,
  RunEvent,
  RunRecord,
  RunStatus,
  RunStep,
  StepStatus
} from "./types.js";

let sqlPromise: Promise<SqlJsStatic> | undefined;

async function loadSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    sqlPromise = initSqlJs({
      locateFile: () => wasmPath
    });
  }

  return sqlPromise;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  const parsed = JSON.parse(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export class RunLedger {
  private constructor(
    private readonly dbPath: string,
    private readonly db: Database
  ) {}

  static async open(dbPath: string): Promise<RunLedger> {
    const SQL = await loadSql();
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    let db: Database;
    try {
      const bytes = await fs.readFile(dbPath);
      db = new SQL.Database(new Uint8Array(bytes));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      db = new SQL.Database();
    }

    const ledger = new RunLedger(dbPath, db);
    ledger.applySchema();
    await ledger.save();
    return ledger;
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: input.id ?? createRunId(),
      task: input.task,
      agent: input.agent,
      status: "running",
      workspace: input.workspace,
      startedAt: now,
      metadata: input.metadata ?? {}
    };

    this.db.run(
      `insert into runs (id, task, agent, status, workspace, started_at, metadata_json)
       values (?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.task,
        run.agent,
        run.status,
        run.workspace,
        run.startedAt,
        stringifyJson(run.metadata)
      ]
    );
    await this.appendEvent(run.id, "run_started", {
      task: run.task,
      agent: run.agent,
      workspace: run.workspace
    });
    return run;
  }

  async appendEvent(
    runId: string,
    kind: EventKind,
    payload: Record<string, unknown> = {},
    stepId?: string,
    receipt?: ReceiptSummary
  ): Promise<RunEvent> {
    const timestamp = new Date().toISOString();
    const sequence = this.nextEventSequence(runId);
    this.db.run(
      `insert into events (run_id, sequence, kind, step_id, timestamp, payload_json, receipt_json)
       values (?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        sequence,
        kind,
        stepId ?? null,
        timestamp,
        stringifyJson(payload),
        receipt ? stringifyJson(receipt) : null
      ]
    );

    const row = this.selectOne(
      `select id, run_id, sequence, kind, step_id, timestamp, payload_json, receipt_json
       from events
       where run_id = ?
       order by sequence desc
       limit 1`,
      [runId]
    );

    if (!row) {
      throw new Error("Failed to read appended event");
    }

    await this.save();
    return this.mapEvent(row);
  }

  async finishRun(runId: string, status: Exclude<RunStatus, "running">): Promise<RunRecord> {
    const endedAt = new Date().toISOString();
    await this.appendEvent(runId, "run_finished", { status, endedAt });
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Run not found after finish: ${runId}`);
    }
    return run;
  }

  async createStep(input: CreateStepInput): Promise<RunStep> {
    const now = new Date().toISOString();
    const step: RunStep = {
      id: input.id ?? createStepId("step"),
      runId: input.runId,
      name: input.name,
      status: input.status ?? "pending",
      sequence: input.sequence ?? this.nextStepSequence(input.runId),
      createdAt: now,
      updatedAt: now,
      parentStepId: input.parentStepId,
      metadata: input.metadata ?? {}
    };

    this.db.run(
      `insert into steps
         (id, run_id, parent_step_id, name, status, sequence, created_at, metadata_json)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        step.id,
        step.runId,
        step.parentStepId ?? null,
        step.name,
        step.status,
        step.sequence,
        step.createdAt,
        stringifyJson(step.metadata)
      ]
    );

    await this.appendEvent(
      input.runId,
      "step_created",
      {
        stepId: step.id,
        name: step.name,
        status: step.status,
        sequence: step.sequence,
        parentStepId: step.parentStepId ?? null
      },
      step.id
    );

    return step;
  }

  listSteps(runId: string): RunStep[] {
    return this.selectAll(
      `select id, run_id, parent_step_id, name, status, sequence, created_at, metadata_json
       from steps
       where run_id = ?
       order by sequence asc, created_at asc`,
      [runId]
    ).map((row) => this.mapStep(row));
  }

  async appendReceipt(input: AppendReceiptInput): Promise<ReceiptSummary> {
    const receipt: ReceiptSummary = {
      id: input.id ?? createStepId("receipt"),
      kind: input.kind,
      capturedAt: input.capturedAt ?? new Date().toISOString(),
      status: input.status,
      label: input.label,
      uri: input.uri,
      digest: input.digest,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      metadata: input.metadata
    };

    await this.appendEvent(
      input.runId,
      "receipt_recorded",
      {
        ...(input.payload ?? {}),
        receiptId: receipt.id,
        message: input.message ?? ""
      },
      input.stepId,
      receipt
    );

    return receipt;
  }

  listReceipts(runId: string, stepId?: string): ReceiptSummary[] {
    return this.selectAll(
      `select receipt_json
       from events
       where run_id = ?
         and receipt_json is not null
         and (? is null or step_id = ?)
       order by sequence asc`,
      [runId, stepId ?? null, stepId ?? null]
    )
      .map((row) => parseReceipt(row.receipt_json))
      .filter((receipt): receipt is ReceiptSummary => receipt !== undefined);
  }

  readReceipt(runId: string, receiptId?: string): ReceiptSummary | undefined {
    const receipts = this.listReceipts(runId);
    if (receiptId === undefined) {
      return receipts.at(-1);
    }

    return receipts.find((receipt) => receipt.id === receiptId);
  }

  getRun(runId: string): RunRecord | undefined {
    const row = this.selectOne(
      `select id, task, agent, status, workspace, started_at, ended_at, metadata_json
       from runs
       where id = ?`,
      [runId]
    );
    return row ? this.mapRun(row) : undefined;
  }

  listRuns(options: ListRunsOptions = {}): RunRecord[] {
    const rows = this.selectAll(
      `select id, task, agent, status, workspace, started_at, ended_at, metadata_json
       from runs
       where (? is null or agent = ?)
         and (? is null or workspace = ?)
       order by started_at desc, id desc`,
      [
        options.agent ?? null,
        options.agent ?? null,
        options.workspace ?? null,
        options.workspace ?? null
      ]
    );
    const runs = rows
      .map((row) => this.mapRun(row))
      .filter((run) => options.status === undefined || run.status === options.status);
    const offset = normalizeOffset(options.offset);
    const limit = normalizeLimit(options.limit);
    return limit === undefined ? runs.slice(offset) : runs.slice(offset, offset + limit);
  }

  timeline(runId: string): RunEvent[] {
    return this.selectAll(
      `select id, run_id, sequence, kind, step_id, timestamp, payload_json, receipt_json
       from events
       where run_id = ?
       order by sequence asc`,
      [runId]
    ).map((row) => this.mapEvent(row));
  }

  listReceiptExports(runId: string): ReceiptExportRecord[] {
    return this.timeline(runId)
      .filter((event) => event.kind === "receipt_exported")
      .map((event) => ({
        runId,
        sequence: event.sequence,
        timestamp: event.timestamp,
        jsonPath: typeof event.payload.jsonPath === "string" ? event.payload.jsonPath : undefined,
        markdownPath: typeof event.payload.markdownPath === "string" ? event.payload.markdownPath : undefined,
        payload: event.payload
      }));
  }

  readLatestReceiptExport(runId: string): ReceiptExportRecord | undefined {
    return this.listReceiptExports(runId).at(-1);
  }

  exportSnapshot(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }

  private applySchema(): void {
    this.db.run("pragma foreign_keys = on");
    this.db.run(`
      create table if not exists runs (
        id text primary key,
        task text not null,
        agent text not null,
        status text not null,
        workspace text not null,
        started_at text not null,
        ended_at text,
        metadata_json text not null default '{}'
      );

      create table if not exists steps (
        id text primary key,
        run_id text not null,
        parent_step_id text,
        name text not null,
        status text not null,
        sequence integer not null,
        created_at text not null,
        metadata_json text not null default '{}',
        foreign key (run_id) references runs (id),
        foreign key (parent_step_id) references steps (id),
        unique (run_id, sequence)
      );

      create table if not exists events (
        id integer primary key autoincrement,
        run_id text not null,
        sequence integer not null,
        kind text not null,
        step_id text,
        timestamp text not null,
        payload_json text not null default '{}',
        receipt_json text,
        foreign key (run_id) references runs (id),
        unique (run_id, sequence)
      );

      create index if not exists idx_steps_run_id on steps (run_id, sequence);
      create index if not exists idx_events_run_id on events (run_id, sequence);
      create index if not exists idx_events_step_id on events (step_id);
    `);

    for (const table of ["runs", "steps", "events"]) {
      this.db.run(`
        create trigger if not exists ${table}_append_only_update
        before update on ${table}
        begin
          select raise(abort, '${table} is append-only');
        end;

        create trigger if not exists ${table}_append_only_delete
        before delete on ${table}
        begin
          select raise(abort, '${table} is append-only');
        end;
      `);
    }
  }

  private async save(): Promise<void> {
    const bytes = Buffer.from(this.db.export());
    const tmpPath = `${this.dbPath}.tmp`;
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, this.dbPath);
  }

  private selectOne(sql: string, params: SqlValue[] = []): Record<string, unknown> | undefined {
    return this.selectAll(sql, params)[0];
  }

  private selectAll(sql: string, params: SqlValue[] = []): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(sql, params);
    const rows: Array<Record<string, unknown>> = [];
    try {
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  private mapRun(row: Record<string, unknown>): RunRecord {
    const runId = String(row.id);
    const terminal = [...this.timeline(runId)].reverse().find((event) => event.kind === "run_finished");
    const status =
      typeof terminal?.payload.status === "string"
        ? (terminal.payload.status as RunStatus)
        : (String(row.status) as RunStatus);
    const endedAt =
      typeof terminal?.payload.endedAt === "string"
        ? terminal.payload.endedAt
        : typeof row.ended_at === "string"
          ? row.ended_at
          : undefined;

    return {
      id: runId,
      task: String(row.task),
      agent: String(row.agent),
      status,
      workspace: String(row.workspace),
      startedAt: String(row.started_at),
      endedAt,
      metadata: parseJson(row.metadata_json),
      receipts: summarizeReceipts(this.listReceipts(runId))
    };
  }

  private mapEvent(row: Record<string, unknown>): RunEvent {
    const kind = String(row.kind) as EventKind;
    const timestamp = String(row.timestamp);
    return {
      id: String(row.id),
      sequence: Number(row.sequence ?? row.id),
      runId: String(row.run_id),
      type: kind,
      kind,
      stepId: typeof row.step_id === "string" ? row.step_id : undefined,
      observedAt: timestamp,
      timestamp,
      payload: parseJson(row.payload_json),
      receipt: parseReceipt(row.receipt_json)
    };
  }

  private mapStep(row: Record<string, unknown>): RunStep {
    const stepId = String(row.id);
    const runId = String(row.run_id);
    const events = this.timeline(runId).filter((event) => event.stepId === stepId);
    const latest = events.at(-1);

    return {
      id: stepId,
      runId,
      name: String(row.name),
      status: deriveStepStatus(String(row.status) as StepStatus, events),
      sequence: Number(row.sequence),
      createdAt: String(row.created_at),
      updatedAt: latest?.timestamp ?? String(row.created_at),
      parentStepId: typeof row.parent_step_id === "string" ? row.parent_step_id : undefined,
      startedAt: firstEventTimestamp(events, "step_started"),
      endedAt: terminalStepTimestamp(events),
      metadata: parseJson(row.metadata_json)
    };
  }

  private nextEventSequence(runId: string): number {
    const row = this.selectOne(
      `select coalesce(max(sequence), 0) + 1 as next_sequence
       from events
       where run_id = ?`,
      [runId]
    );
    return Number(row?.next_sequence ?? 1);
  }

  private nextStepSequence(runId: string): number {
    const row = this.selectOne(
      `select coalesce(max(sequence), 0) + 1 as next_sequence
       from steps
       where run_id = ?`,
      [runId]
    );
    return Number(row?.next_sequence ?? 1);
  }
}

function parseReceipt(value: unknown): ReceiptSummary | undefined {
  const parsed = parseJson(value);
  return typeof parsed.id === "string" && typeof parsed.kind === "string" && typeof parsed.capturedAt === "string"
    ? (parsed as unknown as ReceiptSummary)
    : undefined;
}

function summarizeReceipts(receipts: ReceiptSummary[]) {
  const byKind: Record<string, number> = {};
  for (const receipt of receipts) {
    byKind[receipt.kind] = (byKind[receipt.kind] ?? 0) + 1;
  }
  return {
    total: receipts.length,
    byKind,
    latest: receipts.at(-1)
  };
}

function deriveStepStatus(initial: StepStatus, events: RunEvent[]): StepStatus {
  return events.reduce((status, event) => {
    if (event.kind === "step_started" || event.kind === "command_started") {
      return "running";
    }
    if (event.kind === "step_finished") {
      return String(event.payload.status ?? "completed") as StepStatus;
    }
    if (event.kind === "command_finished") {
      return event.payload.exitCode === 0 ? "completed" : "failed";
    }
    return status;
  }, initial);
}

function firstEventTimestamp(events: RunEvent[], kind: EventKind): string | undefined {
  return events.find((event) => event.kind === kind)?.timestamp;
}

function terminalStepTimestamp(events: RunEvent[]): string | undefined {
  return [...events]
    .reverse()
    .find((event) => event.kind === "step_finished" || event.kind === "command_finished")?.timestamp;
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.trunc(value));
}
