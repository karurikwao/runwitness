import { timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { RunLedger } from "./ledger.js";
import type { RunEvent, RunRecord, RunStatus } from "./types.js";

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_RUN_LIMIT = 50;
const RUN_STATUSES = new Set<RunStatus>(["running", "completed", "failed", "blocked"]);

export type OperatorApprovalDecision = "allow" | "deny";
export type OperatorRole = "viewer" | "approver" | "admin";

export interface OperatorBearerCredential {
  token: string;
  operatorId?: string;
  roles?: readonly OperatorRole[];
  allowedUsers?: readonly string[];
  allowedWorkspaces?: readonly string[];
}

export interface OperatorAuthOptions {
  bearerTokens: readonly (string | OperatorBearerCredential)[];
}

export interface OperatorPrincipal {
  id: string;
  roles: OperatorRole[];
  allowedUsers?: string[];
  allowedWorkspaces?: string[];
}

export interface PendingApprovalRequest {
  runId: string;
  run: Pick<RunRecord, "id" | "task" | "agent" | "status" | "workspace" | "startedAt" | "endedAt">;
  sequence: number;
  stepId?: string;
  requestedAt: string;
  action: string;
  policyDecision?: string;
  riskLevel?: string;
  reasons: string[];
  payload: Record<string, unknown>;
}

export interface OperatorServerOptions {
  ledger: RunLedger;
  operatorId?: string;
  auth?: OperatorAuthOptions;
  maxBodyBytes?: number;
}

export interface ListenOperatorServerOptions extends OperatorServerOptions {
  host?: string;
  port?: number;
}

export interface OperatorServerInstance {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

export function createOperatorServer(options: OperatorServerOptions): Server {
  return http.createServer((request, response) => {
    void handleOperatorRequest(options, request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        sendError(response, error);
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    });
  });
}

export async function listenOperatorServer(options: ListenOperatorServerOptions): Promise<OperatorServerInstance> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const server = createOperatorServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Unable to determine operator server address");
  }

  return {
    server,
    url: `http://${formatHostForUrl(host)}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

export function listPendingApprovals(
  ledger: RunLedger,
  options: { runId?: string; limit?: number; user?: string; workspace?: string; principal?: OperatorPrincipal } = {}
): PendingApprovalRequest[] {
  const runs =
    options.runId === undefined
      ? ledger.listRuns({ limit: options.limit ?? 1000, workspace: options.workspace })
      : [ledger.getRun(options.runId)].filter((run): run is RunRecord => run !== undefined);
  const pending: PendingApprovalRequest[] = [];

  for (const run of runs) {
    const events = ledger.timeline(run.id);
    for (const event of events) {
      if (event.kind !== "approval_requested" || hasTerminalApproval(events, event)) {
        continue;
      }
      if (!approvalMatchesFilters(run, event, options)) {
        continue;
      }

      pending.push({
        runId: run.id,
        run: {
          id: run.id,
          task: run.task,
          agent: run.agent,
          status: run.status,
          workspace: run.workspace,
          startedAt: run.startedAt,
          endedAt: run.endedAt
        },
        sequence: event.sequence,
        stepId: event.stepId,
        requestedAt: event.timestamp,
        action: stringFromPayload(event.payload.action, "approval"),
        policyDecision: optionalString(event.payload.policyDecision),
        riskLevel: optionalString(event.payload.riskLevel),
        reasons: arrayOfStrings(event.payload.reasons),
        payload: event.payload
      });
    }
  }

  return pending;
}

async function handleOperatorRequest(
  options: OperatorServerOptions,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  const auth = normalizeAuthOptions(options);
  if (auth) {
    response.setHeader("Vary", "Authorization");
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      Allow: "GET, POST, OPTIONS",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type"
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://runwitness.local");
  const segments = pathSegments(url);
  const method = request.method ?? "GET";

  if (method === "GET" && segments.length === 1 && segments[0] === "health") {
    sendJson(response, 200, { ok: true, service: "runwitness-operator" });
    return;
  }

  const principal = auth ? authenticateOperatorRequest(request, url, auth) : undefined;

  if (method === "GET" && segments.length === 1 && segments[0] === "events") {
    streamOperatorEvents(options, principal, request, response);
    return;
  }

  if (segments[0] === "runs") {
    await handleRunsRoute(options, principal, method, segments, url, request, response);
    return;
  }

  if (method === "GET" && segments.length === 2 && segments[0] === "approvals" && segments[1] === "pending") {
    sendJson(response, 200, {
      approvals: listPendingApprovals(options.ledger, {
        user: userFilterFromUrl(url),
        workspace: optionalSearchParam(url, "workspace"),
        limit: parseIntegerParam(url.searchParams.get("limit"), 1000),
        principal
      })
    });
    return;
  }

  throw new HttpError(404, "Route not found");
}

async function handleRunsRoute(
  options: OperatorServerOptions,
  principal: OperatorPrincipal | undefined,
  method: string,
  segments: string[],
  url: URL,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (method === "GET" && segments.length === 1) {
    const status = parseRunStatus(url.searchParams.get("status"));
    const limit = parseIntegerParam(url.searchParams.get("limit"), DEFAULT_RUN_LIMIT);
    const offset = parseIntegerParam(url.searchParams.get("offset"), 0);
    const user = userFilterFromUrl(url);
    const runs = options.ledger.listRuns({
      status,
      agent: optionalSearchParam(url, "agent"),
      workspace: optionalSearchParam(url, "workspace")
    });
    sendJson(response, 200, {
      runs: paginateRuns(
        runs.filter((run) => runMatchesFilters(run, { user, principal })),
        offset,
        limit
      )
    });
    return;
  }

  const runId = segments[1];
  if (runId === undefined) {
    throw new HttpError(404, "Route not found");
  }

  const run = options.ledger.getRun(runId);
  if (!run) {
    throw new HttpError(404, "Run not found");
  }

  const resource = segments[2];
  if (resource === "approvals" && segments.length === 3) {
    await handleRunApprovalsRoute(options, principal, method, runId, url, request, response);
    return;
  }

  requireRunAccess(run, principal);

  if (method === "GET" && segments.length === 2) {
    sendJson(response, 200, { run });
    return;
  }

  if (method === "GET" && segments.length === 3 && resource === "timeline") {
    sendJson(response, 200, { events: options.ledger.timeline(runId) });
    return;
  }

  if (method === "GET" && segments.length === 3 && resource === "steps") {
    sendJson(response, 200, { steps: options.ledger.listSteps(runId) });
    return;
  }

  if (method === "GET" && resource === "receipts") {
    handleReceiptSummaryRoute(options, runId, segments, response);
    return;
  }

  if (method === "GET" && segments.length === 3 && resource === "receipt") {
    await handleReceiptArtifactRoute(options, runId, url, response);
    return;
  }

  throw new HttpError(404, "Route not found");
}

function handleReceiptSummaryRoute(
  options: OperatorServerOptions,
  runId: string,
  segments: string[],
  response: ServerResponse
): void {
  if (segments.length === 3) {
    sendJson(response, 200, {
      receipts: options.ledger.listReceipts(runId),
      exports: options.ledger.listReceiptExports(runId)
    });
    return;
  }

  if (segments.length !== 4) {
    throw new HttpError(404, "Route not found");
  }

  const receiptId = segments[3];
  const receipt = receiptId === "latest" ? options.ledger.readReceipt(runId) : options.ledger.readReceipt(runId, receiptId);
  if (!receipt) {
    throw new HttpError(404, "Receipt not found");
  }

  sendJson(response, 200, { receipt });
}

async function handleReceiptArtifactRoute(
  options: OperatorServerOptions,
  runId: string,
  url: URL,
  response: ServerResponse
): Promise<void> {
  const format = url.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "markdown" && format !== "md") {
    throw new HttpError(400, "Unsupported receipt format");
  }

  const exportRecord = options.ledger.readLatestReceiptExport(runId);
  const receiptPath = format === "json" ? exportRecord?.jsonPath : exportRecord?.markdownPath;
  if (!receiptPath) {
    throw new HttpError(404, "Receipt artifact not found");
  }

  let content: string;
  try {
    content = await fs.readFile(receiptPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HttpError(404, "Receipt artifact not found");
    }
    throw error;
  }

  response.writeHead(200, {
    "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8"
  });
  response.end(content);
}

async function handleRunApprovalsRoute(
  options: OperatorServerOptions,
  principal: OperatorPrincipal | undefined,
  method: string,
  runId: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (method === "GET") {
    sendJson(response, 200, {
      approvals: listPendingApprovals(options.ledger, {
        runId,
        user: userFilterFromUrl(url),
        workspace: optionalSearchParam(url, "workspace"),
        principal
      })
    });
    return;
  }

  if (method !== "POST") {
    throw new HttpError(405, "Method not allowed");
  }
  requireApprovalWriteAccess(principal);

  const body = await readJsonBody(request, options.maxBodyBytes ?? DEFAULT_BODY_LIMIT_BYTES);
  if (!isRecord(body)) {
    throw new HttpError(400, "Expected a JSON object");
  }

  const decision = parseApprovalDecision(body.decision);
  const pending = listPendingApprovals(options.ledger, { runId, principal }).at(-1);
  if (principal && !pending) {
    throw new HttpError(404, "Pending approval not found");
  }
  const action = optionalString(body.action) ?? pending?.action;
  if (!action) {
    throw new HttpError(400, "Approval action is required");
  }
  validateRequestedActor(body.decidedBy, principal);

  const decidedAt = new Date().toISOString();
  const decidedBy = principal ? actorFromPrincipal(principal) : parseActor(body.decidedBy, options.operatorId);
  const event = await options.ledger.appendEvent(
    runId,
    "approval_recorded",
    {
      action,
      decision,
      rationale: optionalString(body.rationale),
      decidedAt,
      decidedBy,
      operator: principal ? principalToPayload(principal) : undefined,
      requestSequence: pending?.sequence,
      source: "operator_server"
    },
    pending?.stepId
  );

  sendJson(response, 201, { approval: event });
}

function normalizeAuthOptions(options: OperatorServerOptions): NormalizedAuthOptions | undefined {
  if (!options.auth) {
    return undefined;
  }

  return {
    bearerTokens: options.auth.bearerTokens.map((credential) => normalizeBearerCredential(credential, options.operatorId))
  };
}

function normalizeBearerCredential(
  credential: string | OperatorBearerCredential,
  fallbackOperatorId: string | undefined
): NormalizedBearerCredential {
  if (typeof credential === "string") {
    return {
      token: credential,
      principal: {
        id: fallbackOperatorId ?? "operator",
        roles: ["approver"]
      }
    };
  }

  return {
    token: credential.token,
    principal: {
      id: credential.operatorId ?? fallbackOperatorId ?? "operator",
      roles: credential.roles === undefined || credential.roles.length === 0 ? ["approver"] : [...credential.roles],
      allowedUsers: normalizeStringList(credential.allowedUsers),
      allowedWorkspaces: normalizeStringList(credential.allowedWorkspaces)
    }
  };
}

function authenticateOperatorRequest(request: IncomingMessage, url: URL, auth: NormalizedAuthOptions): OperatorPrincipal {
  const header = request.headers.authorization;
  const match = typeof header === "string" ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  const token = match?.[1] ?? url.searchParams.get("token") ?? url.searchParams.get("access_token");
  if (!token) {
    throw new HttpError(401, "Bearer token required", { "WWW-Authenticate": "Bearer" });
  }

  const principal = findPrincipalForToken(auth, token);
  if (!principal) {
    throw new HttpError(401, "Invalid bearer token", { "WWW-Authenticate": "Bearer" });
  }

  return principal;
}

function streamOperatorEvents(
  options: OperatorServerOptions,
  principal: OperatorPrincipal | undefined,
  request: IncomingMessage,
  response: ServerResponse
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });

  let lastFingerprint = "";
  const writeSnapshot = () => {
    const snapshot = createOperatorSnapshot(options.ledger, principal);
    const fingerprint = JSON.stringify(snapshot);
    if (fingerprint === lastFingerprint) {
      response.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      return;
    }

    lastFingerprint = fingerprint;
    response.write(`event: snapshot\n`);
    response.write(`data: ${fingerprint}\n\n`);
  };

  writeSnapshot();
  const interval = setInterval(writeSnapshot, 2000);
  request.on("close", () => {
    clearInterval(interval);
  });
}

function createOperatorSnapshot(ledger: RunLedger, principal: OperatorPrincipal | undefined): Record<string, unknown> {
  const runs = ledger
    .listRuns({ limit: 50 })
    .filter((run) => runMatchesFilters(run, { principal }));
  return {
    generatedAt: new Date().toISOString(),
    runs,
    approvals: listPendingApprovals(ledger, { principal }),
    latestRunId: runs[0]?.id,
    latestEvents: runs[0] ? ledger.timeline(runs[0].id).slice(-25) : []
  };
}

function findPrincipalForToken(auth: NormalizedAuthOptions, token: string): OperatorPrincipal | undefined {
  for (const credential of auth.bearerTokens) {
    if (tokensEqual(credential.token, token)) {
      return credential.principal;
    }
  }

  return undefined;
}

function requireApprovalWriteAccess(principal: OperatorPrincipal | undefined): void {
  if (!principal) {
    return;
  }

  if (!principal.roles.some((role) => role === "approver" || role === "admin")) {
    throw new HttpError(403, "Approval write access requires approver role");
  }
}

function requireRunAccess(run: RunRecord, principal: OperatorPrincipal | undefined): void {
  if (!runMatchesFilters(run, { principal })) {
    throw new HttpError(403, "Run is outside operator scope");
  }
}

function validateRequestedActor(value: unknown, principal: OperatorPrincipal | undefined): void {
  if (!principal || value === undefined) {
    return;
  }

  if (isRecord(value) && typeof value.id === "string" && value.id.length > 0 && value.id !== principal.id) {
    throw new HttpError(403, "Approval actor must match authenticated operator");
  }
}

function actorFromPrincipal(principal: OperatorPrincipal): Record<string, unknown> {
  return {
    type: "human",
    id: principal.id,
    roles: principal.roles
  };
}

function principalToPayload(principal: OperatorPrincipal): Record<string, unknown> {
  return {
    id: principal.id,
    roles: principal.roles,
    allowedUsers: principal.allowedUsers,
    allowedWorkspaces: principal.allowedWorkspaces
  };
}

function tokensEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function hasTerminalApproval(events: RunEvent[], request: RunEvent): boolean {
  const requestedAction = optionalString(request.payload.action);
  const requestedSequence = request.sequence;
  return events.some((event) => {
    if (event.sequence <= request.sequence || event.kind !== "approval_recorded") {
      return false;
    }
    if (typeof event.payload.requestSequence === "number" && event.payload.requestSequence !== requestedSequence) {
      return false;
    }
    const decision = optionalString(event.payload.decision);
    if (decision !== "allow" && decision !== "deny" && decision !== "approved" && decision !== "denied") {
      return false;
    }
    const recordedAction = optionalString(event.payload.action);
    return requestedAction === undefined || recordedAction === undefined || recordedAction === requestedAction;
  });
}

function approvalMatchesFilters(
  run: RunRecord,
  event: RunEvent,
  filters: { user?: string; workspace?: string; principal?: OperatorPrincipal }
): boolean {
  const workspaceCandidates = [run.workspace, optionalString(event.payload.workspace)].filter(
    (value): value is string => value !== undefined
  );
  const userCandidates = approvalUserCandidates(run, event);

  return (
    matchesStringScope(workspaceCandidates, filters.workspace) &&
    matchesStringScope(userCandidates, filters.user) &&
    matchesStringScope(workspaceCandidates, undefined, filters.principal?.allowedWorkspaces) &&
    matchesStringScope(userCandidates, undefined, filters.principal?.allowedUsers)
  );
}

function runMatchesFilters(
  run: RunRecord,
  filters: { user?: string; workspace?: string; principal?: OperatorPrincipal }
): boolean {
  return (
    matchesStringScope([run.workspace], filters.workspace) &&
    matchesStringScope(runUserCandidates(run), filters.user) &&
    matchesStringScope([run.workspace], undefined, filters.principal?.allowedWorkspaces) &&
    matchesStringScope(runUserCandidates(run), undefined, filters.principal?.allowedUsers)
  );
}

function matchesStringScope(candidates: string[], exact?: string, allowed?: readonly string[]): boolean {
  if (exact !== undefined && !candidates.includes(exact)) {
    return false;
  }

  return allowed === undefined || allowed.length === 0 || candidates.some((candidate) => allowed.includes(candidate));
}

function approvalUserCandidates(run: RunRecord, event: RunEvent): string[] {
  return uniqueStrings([
    ...runUserCandidates(run),
    optionalString(event.payload.user),
    optionalString(event.payload.userId),
    actorId(event.payload.requestedBy),
    actorId(event.payload.actor)
  ]);
}

function runUserCandidates(run: RunRecord): string[] {
  return uniqueStrings([
    optionalString(run.metadata.user),
    optionalString(run.metadata.userId),
    actorId(run.metadata.requestedBy),
    actorId(run.metadata.owner)
  ]);
}

function actorId(value: unknown): string | undefined {
  return isRecord(value) ? optionalString(value.id) : undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function paginateRuns(runs: RunRecord[], offset: number, limit: number): RunRecord[] {
  return runs.slice(offset, offset + limit);
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let sizeBytes = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    sizeBytes += buffer.length;
    if (sizeBytes > maxBodyBytes) {
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function parseApprovalDecision(value: unknown): OperatorApprovalDecision {
  if (value === "allow" || value === "deny") {
    return value;
  }

  throw new HttpError(400, "Approval decision must be allow or deny");
}

function parseRunStatus(value: string | null): RunStatus | undefined {
  if (value === null || value === "") {
    return undefined;
  }

  if (RUN_STATUSES.has(value as RunStatus)) {
    return value as RunStatus;
  }

  throw new HttpError(400, "Invalid run status");
}

function parseIntegerParam(value: string | null, fallback: number): number {
  if (value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "Expected a non-negative integer query parameter");
  }

  return parsed;
}

function parseActor(value: unknown, operatorId: string | undefined): Record<string, unknown> {
  if (isRecord(value) && typeof value.id === "string" && value.id.length > 0) {
    return value;
  }

  return {
    type: "human",
    id: operatorId ?? "operator"
  };
}

function pathSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

function optionalSearchParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === "" ? undefined : value;
}

function userFilterFromUrl(url: URL): string | undefined {
  return optionalSearchParam(url, "user") ?? optionalSearchParam(url, "userId");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeStringList(value: readonly string[] | undefined): string[] | undefined {
  const normalized = uniqueStrings(value?.map((item) => (item.length > 0 ? item : undefined)) ?? []);
  return normalized.length > 0 ? normalized : undefined;
}

function stringFromPayload(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendError(response: ServerResponse, error: unknown): void {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "Internal server error";
  if (error instanceof HttpError) {
    for (const [name, value] of Object.entries(error.headers)) {
      response.setHeader(name, value);
    }
  }
  sendJson(response, statusCode, { error: message });
}

function formatHostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
  }
}

interface NormalizedAuthOptions {
  bearerTokens: NormalizedBearerCredential[];
}

interface NormalizedBearerCredential {
  token: string;
  principal: OperatorPrincipal;
}
