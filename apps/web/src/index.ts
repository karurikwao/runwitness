import { cockpitStyles, escapeHtml } from "@runwitness/ui";
import type {
  ApprovalItemViewModel,
  CockpitMetricViewModel,
  OperatorCockpitViewModel,
  PolicyPanelViewModel,
  ReceiptItemViewModel,
  RunListItemViewModel,
  TimelineItemViewModel,
} from "@runwitness/ui";

export type WebCockpitViewModel = OperatorCockpitViewModel;

export interface WebCockpitDocumentOptions {
  title?: string;
  language?: string;
  includeStyles?: boolean;
  live?: LiveCockpitOptions;
}

export interface LiveCockpitOptions {
  apiBase?: string;
  authTokenStorageKey?: string;
  pollIntervalMs?: number;
}

export interface CreateCockpitViewModelInput {
  title?: string;
  generatedAt?: string;
  runs?: RunListItemViewModel[];
  approvals?: ApprovalItemViewModel[];
  policy?: PolicyPanelViewModel;
  receipts?: ReceiptItemViewModel[];
  timeline?: TimelineItemViewModel[];
  selectedRunId?: string;
}

export const webAppStatus = {
  name: "RunWitness Web",
  status: "static-cockpit-foundation",
  renderer: "static-html",
} as const;

const webCockpitStyles = `
.rw-shell {
  background: #f4f6f8;
  color: #1d252f;
}

.rw-cockpit {
  min-height: 100vh;
}

.rw-cockpit [hidden] {
  display: none !important;
}

.rw-skip {
  position: absolute;
  left: 16px;
  top: 10px;
  z-index: 10;
  transform: translateY(-140%);
  padding: 8px 12px;
  border: 1px solid #9ab2d2;
  border-radius: 6px;
  background: #ffffff;
  color: #163b69;
  font-weight: 700;
}

.rw-skip:focus {
  transform: translateY(0);
}

.rw-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.rw-cockpit__masthead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
  gap: 18px;
  align-items: stretch;
  padding: 18px;
  border-bottom: 1px solid #d8dde6;
  background: #ffffff;
}

.rw-cockpit__hero {
  display: grid;
  gap: 14px;
  align-content: start;
}

.rw-title p {
  max-width: 78ch;
}

.rw-toolbar,
.rw-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rw-nav {
  align-items: center;
}

.rw-nav a,
.rw-button,
.rw-actions button,
.rw-run-select {
  min-height: 34px;
  border: 1px solid #c8d3df;
  border-radius: 6px;
  background: #ffffff;
  color: #1b426f;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 700;
  text-decoration: none;
}

.rw-nav a,
.rw-button {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
}

.rw-nav a:hover,
.rw-button:hover,
.rw-actions button:hover,
.rw-run-select:hover {
  border-color: #7a96b8;
  background: #eef5ff;
}

.rw-nav a:focus-visible,
.rw-button:focus-visible,
.rw-actions button:focus-visible,
.rw-run-select:focus-visible {
  outline: 3px solid #9bc1f7;
  outline-offset: 2px;
}

.rw-button--primary {
  border-color: #285f9f;
  background: #285f9f;
  color: #ffffff;
}

.rw-button--primary:hover {
  border-color: #194a82;
  background: #194a82;
}

.rw-session {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid #d8dde6;
  border-radius: 8px;
  background: #fbfcfe;
}

.rw-session__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.rw-session h2 {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.25;
}

.rw-status {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  padding: 14px 18px;
  background: #eef2f6;
}

.rw-stat {
  min-width: 0;
  padding: 12px;
  border: 1px solid #d8dde6;
  border-radius: 8px;
  background: #ffffff;
}

.rw-stat__value {
  display: block;
  overflow-wrap: anywhere;
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1.1;
}

.rw-stat__label {
  display: block;
  margin-top: 4px;
  color: #657182;
  font-size: 0.78rem;
}

.rw-stat--success {
  border-left: 4px solid #2e8b57;
}

.rw-stat--warning {
  border-left: 4px solid #b9770e;
}

.rw-stat--danger {
  border-left: 4px solid #c0392b;
}

.rw-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(330px, 0.95fr);
  gap: 16px;
  padding: 16px;
}

.rw-primary,
.rw-aside,
.rw-pane-stack {
  display: grid;
  gap: 16px;
  align-content: start;
}

.rw-panel {
  border-color: #d8dde6;
  box-shadow: 0 1px 2px rgba(31, 44, 60, 0.05);
}

.rw-panel__header {
  align-items: flex-start;
  background: #ffffff;
}

.rw-panel__header p {
  margin: 3px 0 0;
}

.rw-panel__title {
  min-width: 0;
}

.rw-panel__summary {
  flex: none;
  margin-top: 0;
}

.rw-table {
  table-layout: fixed;
}

.rw-table th,
.rw-table td {
  word-break: normal;
  overflow-wrap: anywhere;
}

.rw-table th:nth-child(1) {
  width: 112px;
}

.rw-table th:nth-child(3) {
  width: 128px;
}

.rw-table th:nth-child(5),
.rw-table th:nth-child(6) {
  width: 138px;
}

.rw-run-select {
  display: inline-grid;
  gap: 2px;
  width: 100%;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.rw-run-select:hover {
  background: transparent;
}

.rw-run-select .rw-row__title {
  color: #1b426f;
}

.rw-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rw-policy-groups {
  display: grid;
  gap: 8px;
}

.rw-policy-groups > h3 {
  margin: 12px 14px 0;
  color: #536173;
  font-size: 0.76rem;
  letter-spacing: 0;
  text-transform: uppercase;
}

.rw-receipt-target {
  display: grid;
  gap: 2px;
}

.rw-actions button:disabled,
.rw-actions button[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.64;
}

@media (max-width: 1100px) {
  .rw-cockpit__masthead,
  .rw-layout {
    grid-template-columns: 1fr;
  }

  .rw-status {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .rw-cockpit__masthead,
  .rw-layout,
  .rw-status {
    padding-left: 12px;
    padding-right: 12px;
  }

  .rw-status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rw-table-wrap {
    overflow-x: visible;
  }

  .rw-table,
  .rw-table tbody,
  .rw-table tr,
  .rw-table td {
    display: block;
    width: 100%;
  }

  .rw-table thead {
    display: none;
  }

  .rw-table tr {
    padding: 10px 12px;
    border-bottom: 1px solid #e8ebf0;
  }

  .rw-table td {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px;
    padding: 6px 0;
    border-bottom: 0;
  }

  .rw-table td::before {
    content: attr(data-label);
    color: #657182;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
}

@media (max-width: 520px) {
  .rw-status {
    grid-template-columns: 1fr;
  }

  .rw-row__head,
  .rw-session__heading,
  .rw-panel__header {
    display: grid;
  }
}
`;

export function createCockpitViewModel(input: CreateCockpitViewModelInput = {}): WebCockpitViewModel {
  return {
    title: input.title ?? "RunWitness Cockpit",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    runs: input.runs ?? [],
    approvals: input.approvals ?? [],
    policy: input.policy ?? { defaultDecision: "ask", rules: [] },
    receipts: input.receipts ?? [],
    timeline: input.timeline ?? [],
    selectedRunId: input.selectedRunId,
  };
}

export function renderWebCockpitDocument(
  view: WebCockpitViewModel,
  options: WebCockpitDocumentOptions = {},
): string {
  const language = options.language ?? "en";
  const pageTitle = options.title ?? `${view.title} | RunWitness`;
  const styles = options.includeStyles === false ? "" : `<style>${cockpitStyles}\n${webCockpitStyles}</style>`;

  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  ${styles}
</head>
<body>
${renderWebCockpitBody(view)}
${options.live ? renderLiveCockpitScript(options.live) : ""}
</body>
</html>`;
}

export function renderWebCockpitBody(view: WebCockpitViewModel): string {
  const selectedRunId = view.selectedRunId ?? view.runs.find((run) => run.active === true)?.id;

  return `
<main class="rw-shell rw-cockpit" data-selected-run="${escapeHtml(selectedRunId ?? "")}">
  <a class="rw-skip" href="#rw-main-panels">Skip to cockpit content</a>
  <header class="rw-topbar rw-cockpit__masthead">
    <div class="rw-cockpit__hero">
      <div class="rw-title">
        <h1>${escapeHtml(view.title)}</h1>
        <p>${escapeHtml(formatCount(view.runs.length, "run"))} tracked. Review active sessions, pending approvals, policy posture, and receipt evidence from one operator view.</p>
      </div>
      <nav class="rw-nav" aria-label="Cockpit sections">
        <a href="#rw-panel-runs">Runs</a>
        <a href="#rw-panel-approvals">Approvals</a>
        <a href="#rw-panel-policy">Policy</a>
        <a href="#rw-panel-receipts">Receipts</a>
        <a href="#rw-panel-timeline">Timeline</a>
      </nav>
      <div class="rw-toolbar" role="group" aria-label="Cockpit controls">
        <button class="rw-button rw-button--primary" type="button" data-refresh-cockpit aria-label="Refresh cockpit data">Refresh</button>
        <a class="rw-button" href="#rw-panel-approvals">Review approvals</a>
      </div>
      <div class="rw-meta">Generated ${escapeHtml(formatTimestamp(view.generatedAt))}</div>
    </div>
    ${renderSessionPanel()}
  </header>
  ${renderStatusSummary(view)}
  <div class="rw-layout" id="rw-main-panels">
    <div class="rw-primary">
      ${renderRunsPanel(view.runs, selectedRunId)}
      ${renderTimelinePanel(view.timeline)}
    </div>
    <aside class="rw-aside" aria-label="Decision support">
      ${renderApprovalsPanel(view.approvals)}
      <div class="rw-pane-stack" aria-label="Policy and receipts">
        ${renderPolicyPanel(view.policy)}
        ${renderReceiptsPanel(view.receipts)}
      </div>
    </aside>
  </div>
</main>`;
}

export function renderLiveWebCockpitDocument(options: WebCockpitDocumentOptions & { initial?: CreateCockpitViewModelInput } = {}): string {
  return renderWebCockpitDocument(createCockpitViewModel(options.initial), {
    ...options,
    live: {
      apiBase: "/",
      authTokenStorageKey: "runwitness.operatorToken",
      pollIntervalMs: 2500,
      ...options.live
    }
  });
}

interface WebStatusCard {
  key: string;
  label: string;
  value: string | number;
  tone: "neutral" | "success" | "warning" | "danger";
}

function renderSessionPanel(): string {
  return `<section class="rw-session" data-operator-session aria-labelledby="rw-session-title">
    <div class="rw-session__heading">
      <h2 id="rw-session-title">Operator session</h2>
      ${renderStatusPill("neutral", "static snapshot")}
    </div>
    <div><strong>Operator</strong> <span class="rw-code">offline snapshot</span></div>
    <div class="rw-row__meta" aria-label="Operator roles">${renderStatusPill("neutral", "role:none")}</div>
    <div class="rw-row__meta" aria-label="Operator scope">${renderStatusPill("neutral", "scope:all")}</div>
    <div class="rw-row__meta" aria-label="Operator capabilities">${renderStatusPill("neutral", "read-only approvals")}${renderStatusPill("warning", "policy writes:disabled")}</div>
  </section>`;
}

function renderStatusSummary(view: WebCockpitViewModel): string {
  const cards = [...defaultStatusCards(view), ...(view.metrics ?? []).map(metricToStatusCard)];

  return `<section class="rw-status" aria-label="Cockpit status summary">${cards
    .map(
      (card) => `<article class="rw-stat rw-stat--${card.tone}" data-summary-card="${escapeHtml(card.key)}">
        <span class="rw-stat__value" data-summary-value="${escapeHtml(card.key)}">${escapeHtml(card.value)}</span>
        <span class="rw-stat__label" data-summary-label="${escapeHtml(card.key)}">${escapeHtml(card.label)}</span>
      </article>`,
    )
    .join("")}</section>`;
}

function defaultStatusCards(view: WebCockpitViewModel): WebStatusCard[] {
  const activeRuns = view.runs.filter((run) => run.active === true || ["pending", "running"].includes(run.status.toLowerCase())).length;
  const failedRuns = view.runs.filter((run) => ["blocked", "critical", "danger", "denied", "deny", "failed"].includes(run.status.toLowerCase())).length;
  const health =
    failedRuns > 0
      ? { value: "Attention", tone: "danger" as const }
      : view.approvals.length > 0
        ? { value: "Review", tone: "warning" as const }
        : activeRuns > 0
          ? { value: "Running", tone: "warning" as const }
          : { value: "Ready", tone: "success" as const };

  return [
    { key: "health", label: "System state", value: health.value, tone: health.tone },
    { key: "runs", label: `${formatCount(activeRuns, "active run")}`, value: view.runs.length, tone: activeRuns > 0 ? "warning" : "neutral" },
    {
      key: "approvals",
      label: "Pending approvals",
      value: view.approvals.length,
      tone: view.approvals.length > 0 ? "warning" : "success",
    },
    { key: "receipts", label: "Receipts captured", value: view.receipts.length, tone: view.receipts.length > 0 ? "success" : "neutral" },
    { key: "events", label: "Timeline events", value: view.timeline.length, tone: "neutral" },
  ];
}

function metricToStatusCard(metric: CockpitMetricViewModel, index: number): WebStatusCard {
  return {
    key: `metric-${index}`,
    label: metric.label,
    value: metric.value,
    tone: metric.tone ?? "neutral",
  };
}

function renderRunsPanel(runs: RunListItemViewModel[], selectedRunId?: string): string {
  const rows = runs.map((run) => renderRunRow(run, selectedRunId)).join("");
  const body = `<div class="rw-table-wrap">
    <table class="rw-table" aria-describedby="rw-runs-hint">
      <caption class="rw-sr-only">Run sessions</caption>
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Run</th>
          <th scope="col">Agent</th>
          <th scope="col">Workspace</th>
          <th scope="col">Started</th>
          <th scope="col">Signals</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="rw-empty" data-empty-for="runs"${runs.length > 0 ? " hidden" : ""}>No runs recorded.</div>
  <p class="rw-sr-only" id="rw-runs-hint">Select a run row to refresh timeline, policy, and receipt panes for that session.</p>`;

  return renderPanel("rw-panel-runs", "Runs", "Live sessions and recent workspaces.", body, formatCount(runs.length, "run"));
}

function renderRunRow(run: RunListItemViewModel, selectedRunId?: string): string {
  const isSelected = selectedRunId === run.id || run.active === true;
  const runLabel = `Select run ${run.id}`;

  return `<tr${isSelected ? ' aria-current="true"' : ""} data-run-id="${escapeHtml(run.id)}">
    <td data-label="Status">${renderStatusPill(run.status)}</td>
    <td data-label="Run">
      <button class="rw-run-select" type="button" data-run-id="${escapeHtml(run.id)}" aria-label="${escapeHtml(runLabel)}">
        <span class="rw-row__title">${escapeHtml(run.task)}</span>
        <span class="rw-muted rw-code">${escapeHtml(run.id)}</span>
      </button>
    </td>
    <td data-label="Agent">${escapeHtml(run.agent)}</td>
    <td data-label="Workspace" class="rw-code">${escapeHtml(run.workspace)}</td>
    <td data-label="Started">${escapeHtml(formatTimestamp(run.startedAt))}</td>
    <td data-label="Signals">${renderInlineMetrics(run.metrics ?? [])}</td>
  </tr>`;
}

function renderApprovalsPanel(approvals: ApprovalItemViewModel[]): string {
  const body =
    approvals.length === 0
      ? `<div class="rw-empty">No approvals waiting.</div>`
      : `<div class="rw-stack">${approvals.map(renderApprovalRow).join("")}</div>`;

  return renderPanel("rw-panel-approvals", "Approvals", "Pending operator decisions.", body, formatCount(approvals.length, "item"));
}

function renderApprovalRow(approval: ApprovalItemViewModel): string {
  const reasons = approval.reasons ?? [];
  const title = approval.actionSummary ?? approval.action;
  const decision = approval.policyDecision ?? approval.decision;

  return `<article class="rw-row">
    <div class="rw-row__head">
      <div class="rw-row__title">${escapeHtml(title)}</div>
      ${renderStatusPill(decision)}
    </div>
    <div class="rw-row__meta">
      <span>${escapeHtml(approval.actionType)}</span>
      <span>${escapeHtml(formatTimestamp(approval.requestedAt))}</span>
      ${approval.policyDecision ? `<span>Policy ${escapeHtml(humanize(approval.policyDecision))}</span>` : ""}
      ${approval.mode ? `<span>${escapeHtml(humanize(approval.mode))}</span>` : ""}
    </div>
    <div class="rw-code">${escapeHtml(approval.action)}</div>
    ${reasons.length > 0 ? `<div class="rw-muted">${escapeHtml(reasons.join(", "))}</div>` : ""}
    <div class="rw-actions" role="group" aria-label="Approval controls for ${escapeHtml(title)}">
      <button type="button" disabled aria-disabled="true" aria-label="Allow approval ${escapeHtml(approval.id)}">Allow</button>
      <button type="button" disabled aria-disabled="true" aria-label="Deny approval ${escapeHtml(approval.id)}">Deny</button>
    </div>
  </article>`;
}

function renderPolicyPanel(policy: PolicyPanelViewModel): string {
  const findings = policy.findings ?? [];
  const groups = [
    findings.length > 0 ? renderPolicyGroup("Active Findings", findings) : "",
    policy.rules.length > 0 ? renderPolicyGroup("Loaded Rules", policy.rules) : "",
  ]
    .filter(Boolean)
    .join("");
  const body = `${renderPolicyEditState()}${groups || `<div class="rw-empty">No policy rules loaded.</div>`}`;
  const summary = policy.defaultDecision ? `Default ${humanize(policy.defaultDecision)}` : undefined;

  return renderPanel("rw-panel-policy", "Policy", "Effective rules and guarded edit state.", body, summary);
}

function renderPolicyEditState(): string {
  return `<article class="rw-row" data-policy-edit-state="blocked">
    <div class="rw-row__head">
      <div class="rw-row__title">Policy edit disabled</div>
      ${renderStatusPill("blocked", "blocked")}
    </div>
    <div class="rw-row__meta"><span class="rw-code">policy-edit</span><span>disabled</span></div>
    <div class="rw-muted">Admin role required before audited policy edit controls are shown.</div>
    <div class="rw-actions"><button type="button" disabled aria-disabled="true">Policy edit unavailable</button></div>
  </article>`;
}

function renderPolicyGroup(title: string, rules: PolicyPanelViewModel["rules"]): string {
  return `<div class="rw-policy-groups">
    <h3>${escapeHtml(title)}</h3>
    <div class="rw-stack" aria-label="${escapeHtml(title)}">${rules.map(renderPolicyRuleRow).join("")}</div>
  </div>`;
}

function renderPolicyRuleRow(rule: PolicyPanelViewModel["rules"][number]): string {
  return `<article class="rw-row">
    <div class="rw-row__head">
      <div class="rw-row__title">${escapeHtml(rule.label)}</div>
      ${renderStatusPill(rule.decision)}
    </div>
    <div class="rw-row__meta">
      <span class="rw-code">${escapeHtml(rule.code)}</span>
      ${rule.severity ? `<span>${escapeHtml(humanize(rule.severity))}</span>` : ""}
    </div>
    ${rule.description ? `<div class="rw-muted rw-code">${escapeHtml(rule.description)}</div>` : ""}
  </article>`;
}

function renderReceiptsPanel(receipts: ReceiptItemViewModel[]): string {
  const body =
    receipts.length === 0
      ? `<div class="rw-empty">No receipts captured.</div>`
      : `<div class="rw-stack">${receipts.map(renderReceiptRow).join("")}</div>`;

  return renderPanel("rw-panel-receipts", "Receipts", "Captured artifacts and digests.", body, formatCount(receipts.length, "receipt"));
}

function renderReceiptRow(receipt: ReceiptItemViewModel): string {
  const href = receipt.uri ? safeHref(receipt.uri) : undefined;
  const target = href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(receipt.label)}</a>`
    : `<span>${escapeHtml(receipt.label)}</span>${receipt.uri ? `<span class="rw-muted rw-code">${escapeHtml(receipt.uri)}</span>` : ""}`;

  return `<article class="rw-row">
    <div class="rw-row__head">
      <div class="rw-row__title rw-receipt-target">${target}</div>
      ${renderStatusPill(receipt.status)}
    </div>
    <div class="rw-row__meta">
      <span>${escapeHtml(receipt.kind)}</span>
      <span>${escapeHtml(formatTimestamp(receipt.capturedAt))}</span>
      ${receipt.mimeType ? `<span>${escapeHtml(receipt.mimeType)}</span>` : ""}
      ${receipt.sizeBytes === undefined ? "" : `<span>${escapeHtml(formatBytes(receipt.sizeBytes))}</span>`}
    </div>
    ${receipt.digest ? `<div class="rw-muted rw-code">${escapeHtml(receipt.digest)}</div>` : ""}
  </article>`;
}

function renderTimelinePanel(items: TimelineItemViewModel[]): string {
  const rows = items
    .map(
      (item) => `<article class="rw-timeline__item">
        <div class="rw-timeline__sequence">#${escapeHtml(String(item.sequence).padStart(3, "0"))}</div>
        <div>
          <div class="rw-row__head">
            <div class="rw-row__title">${escapeHtml(item.label)}</div>
            ${renderStatusPill(item.tone, item.kind ?? item.tone)}
          </div>
          <div class="rw-row__meta">
            <span>${escapeHtml(formatTimestamp(item.timestamp))}</span>
            ${item.stepId ? `<span class="rw-code">${escapeHtml(item.stepId)}</span>` : ""}
          </div>
          ${item.detail ? `<div class="rw-muted">${escapeHtml(item.detail)}</div>` : ""}
        </div>
      </article>`,
    )
    .join("");
  const body = rows ? `<div class="rw-timeline">${rows}</div>` : `<div class="rw-empty">No timeline events.</div>`;

  return renderPanel("rw-panel-timeline", "Timeline", "Selected run event stream.", body, formatCount(items.length, "event"));
}

function renderPanel(id: string, title: string, description: string, body: string, summary?: string): string {
  return `<section class="rw-panel" aria-labelledby="${id}">
    <header class="rw-panel__header">
      <div class="rw-panel__title">
        <h2 id="${id}">${escapeHtml(title)}</h2>
        <p class="rw-muted">${escapeHtml(description)}</p>
      </div>
      ${summary ? `<span class="rw-muted rw-panel__summary">${escapeHtml(summary)}</span>` : ""}
    </header>
    <div class="rw-panel__body">${body}</div>
  </section>`;
}

function renderStatusPill(status: string, label = humanize(status)): string {
  return `<span class="rw-pill rw-pill--${toneForStatus(status)}">${escapeHtml(label)}</span>`;
}

function renderInlineMetrics(metrics: CockpitMetricViewModel[]): string {
  if (metrics.length === 0) {
    return `<span class="rw-muted">none</span>`;
  }

  return `<span class="rw-chip-list">${metrics
    .map((metric) => `<span>${escapeHtml(metric.label)}: ${escapeHtml(metric.value)}</span>`)
    .join("")}</span>`;
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function toneForStatus(status: string): WebStatusCard["tone"] {
  const normalized = status.toLowerCase();
  if (["allow", "approved", "completed", "granted", "loaded", "passed", "protected", "success"].includes(normalized)) {
    return "success";
  }
  if (["admin", "ask", "pending", "running", "warning"].includes(normalized)) {
    return "warning";
  }
  if (["blocked", "critical", "danger", "denied", "deny", "failed"].includes(normalized)) {
    return "danger";
  }
  return "neutral";
}

function safeHref(uri: string): string | undefined {
  const trimmed = uri.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^(?:https?:|file:|\/|\.\/|\.\.\/|#)/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp));
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderLiveCockpitScript(options: LiveCockpitOptions): string {
  const apiBase = options.apiBase ?? "/";
  const tokenKey = options.authTokenStorageKey ?? "runwitness.operatorToken";
  const pollIntervalMs = options.pollIntervalMs ?? 2500;

  return `<script>
(() => {
  const apiBase = ${JSON.stringify(apiBase)};
  const tokenKey = ${JSON.stringify(tokenKey)};
  const pollIntervalMs = ${JSON.stringify(pollIntervalMs)};
  const main = document.querySelector(".rw-shell");
  if (!main) return;

  const state = {
    selectedRunId: main.getAttribute("data-selected-run") || undefined,
    eventSource: undefined,
    operator: { authenticated: false, authRequired: false, capabilities: {} }
  };

  const token = () => window.localStorage.getItem(tokenKey) || "";
  const headers = () => {
    const value = token();
    return value ? { Authorization: "Bearer " + value } : {};
  };
  const apiBaseUrl = () => new URL(apiBase, window.location.href);
  const endpoint = (path) => new URL(path.replace(/^\\//, ""), apiBaseUrl()).toString();
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
  const statusClass = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (["allow", "approved", "completed", "granted", "loaded", "passed", "protected", "success"].includes(normalized)) return "success";
    if (["admin", "ask", "pending", "running", "warning"].includes(normalized)) return "warning";
    if (["blocked", "critical", "danger", "denied", "deny", "failed"].includes(normalized)) return "danger";
    return "neutral";
  };
  const pill = (status, label = status) => '<span class="rw-pill rw-pill--' + statusClass(status) + '">' + escapeHtml(label) + '</span>';
  const getJson = async (path) => {
    const response = await fetch(endpoint(path), { headers: headers(), cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const safeGetJson = async (path, fallback) => {
    try {
      return await getJson(path);
    } catch {
      return fallback;
    }
  };

  async function refresh() {
    const [runs, approvals, operator] = await Promise.all([
      getJson("/runs?limit=50"),
      getJson("/approvals/pending"),
      safeGetJson("/operator/me", { authenticated: false, authRequired: false, capabilities: {} })
    ]);
    state.operator = normalizeOperator(operator);
    if (!state.selectedRunId && runs.runs && runs.runs[0]) state.selectedRunId = runs.runs[0].id;
    const details = await loadSelectedRunDetails();
    render(runs.runs || [], approvals.approvals || [], details.events, details.receipts, details.policy);
  }

  function applySnapshot(snapshot) {
    if (!state.selectedRunId && snapshot.latestRunId) state.selectedRunId = snapshot.latestRunId;
    void refresh();
  }

  async function loadSelectedRunDetails() {
    if (!state.selectedRunId) {
      return { events: [], receipts: [], policy: createPolicyViewModel([], undefined) };
    }

    const runPath = "/runs/" + encodeURIComponent(state.selectedRunId);
    const [selected, receiptSummary, receiptArtifact] = await Promise.all([
      getJson(runPath + "/timeline"),
      safeGetJson(runPath + "/receipts", { receipts: [], exports: [] }),
      safeGetJson(runPath + "/receipt?format=json", undefined)
    ]);
    const events = selected.events || [];
    return {
      events,
      receipts: receiptItemsFromSummary(receiptSummary),
      policy: createPolicyViewModel(events, receiptArtifact)
    };
  }

  function render(runs, approvals, events, receipts, policy) {
    main.setAttribute("data-selected-run", state.selectedRunId || "");
    renderOperatorSession();
    updateStatusSummary(runs, approvals, events, receipts);
    const runRows = runs.map((run) => '<tr' + (run.id === state.selectedRunId ? ' aria-current="true"' : "") + ' data-run-id="' + escapeHtml(run.id) + '">' +
      '<td data-label="Status">' + pill(run.status) + '</td>' +
      '<td data-label="Run"><button class="rw-run-select" type="button" data-run-id="' + escapeHtml(run.id) + '" aria-label="Select run ' + escapeHtml(run.id) + '"><span class="rw-row__title">' + escapeHtml(run.task) + '</span><span class="rw-muted rw-code">' + escapeHtml(run.id) + '</span></button></td>' +
      '<td data-label="Agent">' + escapeHtml(run.agent) + '</td>' +
      '<td data-label="Workspace" class="rw-code">' + escapeHtml(run.workspace) + '</td>' +
      '<td data-label="Started">' + escapeHtml(run.startedAt) + '</td>' +
      '<td data-label="Signals">' + escapeHtml(run.receipts?.total ?? 0) + ' receipts</td>' +
    '</tr>').join("");
    const approvalRows = approvals.map((approval) => {
      const runId = approval.runId || approval.id || "";
      const label = approval.actionSummary || approval.action || runId || "approval";
      return '<article class="rw-row">' +
      '<div class="rw-row__head"><div class="rw-row__title">' + escapeHtml(approval.action) + '</div>' + pill(approval.policyDecision || "ask") + '</div>' +
      '<div class="rw-row__meta"><span>' + escapeHtml(runId) + '</span><span>' + escapeHtml(approval.requestedAt) + '</span></div>' +
      '<div class="rw-code">' + escapeHtml((approval.reasons || []).join(", ")) + '</div>' +
      '<div class="rw-actions" role="group" aria-label="Approval controls for ' + escapeHtml(label) + '"><button type="button" data-approval-run="' + escapeHtml(runId) + '" data-decision="allow" aria-label="Allow approval ' + escapeHtml(runId) + '">Allow</button><button type="button" data-approval-run="' + escapeHtml(runId) + '" data-decision="deny" aria-label="Deny approval ' + escapeHtml(runId) + '">Deny</button></div>' +
    '</article>';
    }).join("");
    const timelineRows = events.map((event) => '<article class="rw-timeline__item">' +
      '<div class="rw-timeline__sequence">#' + String(event.sequence).padStart(3, "0") + '</div>' +
      '<div><div class="rw-row__head"><div class="rw-row__title">' + escapeHtml(event.label || event.kind) + '</div>' + pill(event.kind) + '</div>' +
      '<div class="rw-row__meta"><span>' + escapeHtml(event.timestamp) + '</span></div>' +
      '<div class="rw-muted rw-code">' + escapeHtml(JSON.stringify(event.payload || {})) + '</div></div>' +
    '</article>').join("");
    const policyRows = renderPolicyBody(policy);
    const receiptRows = renderReceiptsBody(receipts);
    main.querySelector(".rw-table tbody")?.replaceChildren();
    const runBody = main.querySelector(".rw-table tbody");
    if (runBody) runBody.innerHTML = runRows;
    toggleEmpty("runs", runs.length === 0);
    const approvalsBody = panelBody("rw-panel-approvals");
    if (approvalsBody) approvalsBody.innerHTML = approvalRows ? '<div class="rw-stack">' + approvalRows + '</div>' : '<div class="rw-empty">No approvals waiting.</div>';
    const timelineBody = panelBody("rw-panel-timeline");
    if (timelineBody) timelineBody.innerHTML = timelineRows ? '<div class="rw-timeline">' + timelineRows + '</div>' : '<div class="rw-empty">No timeline events.</div>';
    const policyBody = panelBody("rw-panel-policy");
    if (policyBody) policyBody.innerHTML = policyRows;
    const receiptsBody = panelBody("rw-panel-receipts");
    if (receiptsBody) receiptsBody.innerHTML = receiptRows;
  }

  function updateStatusSummary(runs, approvals, events, receipts) {
    const activeRuns = runs.filter((run) => run.active === true || ["pending", "running"].includes(String(run.status || "").toLowerCase())).length;
    const failedRuns = runs.filter((run) => ["blocked", "critical", "danger", "denied", "deny", "failed"].includes(String(run.status || "").toLowerCase())).length;
    const health = failedRuns > 0
      ? { value: "Attention", tone: "danger" }
      : approvals.length > 0
        ? { value: "Review", tone: "warning" }
        : activeRuns > 0
          ? { value: "Running", tone: "warning" }
          : { value: "Ready", tone: "success" };
    setSummary("health", health.value, "System state", health.tone);
    setSummary("runs", runs.length, formatCount(activeRuns, "active run"), activeRuns > 0 ? "warning" : "neutral");
    setSummary("approvals", approvals.length, "Pending approvals", approvals.length > 0 ? "warning" : "success");
    setSummary("receipts", receipts.length, "Receipts captured", receipts.length > 0 ? "success" : "neutral");
    setSummary("events", events.length, "Timeline events", "neutral");
  }

  function setSummary(key, value, label, tone) {
    const card = main.querySelector('[data-summary-card="' + key + '"]');
    const valueNode = main.querySelector('[data-summary-value="' + key + '"]');
    const labelNode = main.querySelector('[data-summary-label="' + key + '"]');
    if (valueNode) valueNode.textContent = String(value);
    if (labelNode) labelNode.textContent = String(label);
    if (card) {
      card.classList.remove("rw-stat--neutral", "rw-stat--success", "rw-stat--warning", "rw-stat--danger");
      card.classList.add("rw-stat--" + tone);
    }
  }

  function toggleEmpty(name, empty) {
    const node = main.querySelector('[data-empty-for="' + name + '"]');
    if (node) node.hidden = !empty;
  }

  function formatCount(value, singular, plural = singular + "s") {
    return String(value) + " " + (value === 1 ? singular : plural);
  }

  function panelBody(id) {
    return document.getElementById(id)?.closest(".rw-panel")?.querySelector(".rw-panel__body");
  }

  function renderOperatorSession() {
    let session = main.querySelector("[data-operator-session]");
    if (!session) {
      const topbar = main.querySelector(".rw-topbar");
      if (!topbar) return;
      session = document.createElement("div");
      session.className = "rw-session";
      session.setAttribute("data-operator-session", "true");
      session.setAttribute("aria-labelledby", "rw-session-title");
      topbar.append(session);
    }

    const operator = state.operator || { authenticated: false, authRequired: false, capabilities: {} };
    const principal = isObject(operator.principal) ? operator.principal : undefined;
    const capabilities = isObject(operator.capabilities) ? operator.capabilities : {};
    const authenticated = operator.authenticated === true;
    const roles = operatorRoles(operator);
    const scopes = operatorScopes(operator);
    const sessionStatus = authenticated ? "authenticated" : operator.authRequired === true ? "token required" : "unauthenticated";
    const sessionTone = authenticated ? "success" : operator.authRequired === true ? "danger" : "neutral";
    const identity = principal?.id ? String(principal.id) : authenticated ? "authenticated operator" : "anonymous operator";
    const roleBadges = roles.length > 0 ? roles.map((role) => pill(roleTone(role), "role:" + role)).join("") : pill("neutral", "role:none");
    const scopeBadges = scopes.length > 0 ? scopes.map((scope) => pill("neutral", scope)).join("") : pill("neutral", "scope:all");
    const capabilityBadges = [
      capabilities.canApprove === true ? pill("success", "approve") : pill("neutral", "read-only approvals"),
      capabilities.canExplainPolicy === true ? pill("success", "policy explain") : pill("neutral", "policy explain off"),
      capabilities.policyWrites ? pill(capabilities.policyWrites === "disabled" ? "warning" : "success", "policy writes:" + String(capabilities.policyWrites)) : pill("warning", "policy writes:disabled")
    ].join("");

    session.innerHTML = '<div class="rw-session__heading"><h2 id="rw-session-title">Operator session</h2>' + pill(sessionTone, sessionStatus) + '</div>' +
      '<div><strong>Operator</strong> <span class="rw-code">' + escapeHtml(identity) + '</span></div>' +
      '<div class="rw-row__meta" aria-label="Operator roles">' + roleBadges + '</div>' +
      '<div class="rw-row__meta" aria-label="Operator scope">' + scopeBadges + '</div>' +
      '<div class="rw-row__meta" aria-label="Operator capabilities">' + capabilityBadges + '</div>';
  }

  function createPolicyViewModel(events, receiptArtifact) {
    const lineage = policyLineageFromReceipt(receiptArtifact) || policyLineageFromEvents(events);
    const rules = [];
    const findings = [];
    if (lineage) {
      if (lineage.digest && lineage.digest.value) {
        rules.push({
          code: "effective-policy",
          label: "Effective policy digest",
          decision: "loaded",
          description: digestText(lineage.digest)
        });
      }
      if (Array.isArray(lineage.precedence) && lineage.precedence.length > 0) {
        rules.push({
          code: "policy-precedence",
          label: "Policy precedence",
          decision: "loaded",
          description: lineage.precedence.map(String).join(" -> ")
        });
      }
      for (const layer of Array.isArray(lineage.layers) ? lineage.layers : []) {
        if (!isObject(layer)) continue;
        const label = String(layer.label || layer.kind || "Policy layer");
        rules.push({
          code: "policy-layer:" + String(layer.kind || label),
          label,
          decision: "loaded",
          description: [digestText(layer.digest), layer.path ? String(layer.path) : ""].filter(Boolean).join(" | ")
        });
      }
      const protectedSourcePaths = Array.isArray(lineage.protectedSourcePaths) ? lineage.protectedSourcePaths : [];
      protectedSourcePaths.forEach((entry, index) => {
        if (!isObject(entry) || !entry.path) return;
        findings.push({
          code: "protected-source:" + String(index + 1),
          label: "Protected policy source",
          decision: "protected",
          description: [String(entry.path), entry.reason ? String(entry.reason) : ""].filter(Boolean).join(" | ")
        });
      });
    }

    const capabilities = isObject(state.operator?.capabilities) ? state.operator.capabilities : {};
    if (state.operator?.authenticated === true && capabilities.canRequestPolicyEdit === true) {
      findings.push({
        code: "policy-admin-audit-placeholder",
        label: "Audited policy edit placeholder",
        decision: "admin",
        description: "Admin operator verified. Policy writes remain disabled while the audited edit workflow is prepared."
      });
    }

    return { rules, findings };
  }

  function policyLineageFromReceipt(receiptArtifact) {
    return isObject(receiptArtifact) && isObject(receiptArtifact.policy) ? receiptArtifact.policy : undefined;
  }

  function policyLineageFromEvents(events) {
    for (const event of [...events].reverse()) {
      if (event && event.kind === "policy_loaded" && isObject(event.payload)) {
        return event.payload;
      }
    }
    return undefined;
  }

  function renderPolicyBody(policy) {
    const findings = policy?.findings || [];
    const rules = policy?.rules || [];
    const editState = renderPolicyEditState();
    const body = [
      editState,
      findings.length > 0 ? '<div class="rw-stack">' + findings.map(renderPolicyRuleRow).join("") + '</div>' : "",
      rules.length > 0 ? '<div class="rw-stack">' + rules.map(renderPolicyRuleRow).join("") + '</div>' : ""
    ].filter(Boolean).join("");
    return body || '<div class="rw-empty">No policy lineage loaded.</div>';
  }

  function renderPolicyEditState() {
    const operator = state.operator || { authenticated: false, authRequired: false, capabilities: {} };
    const capabilities = isObject(operator.capabilities) ? operator.capabilities : {};
    const roles = operatorRoles(operator);
    const isAdmin = roles.includes("admin") || capabilities.canRequestPolicyEdit === true;
    const authenticated = operator.authenticated === true;
    const policyWrites = capabilities.policyWrites ? String(capabilities.policyWrites) : "disabled";
    let label = "Policy edit disabled";
    let decision = "blocked";
    let description = "Policy edit is disabled for this session.";

    if (!authenticated && operator.authRequired === true) {
      description = "Sign in with an admin operator token to request audited policy changes.";
    } else if (!isAdmin) {
      description = "Admin role required before audited policy edit controls are shown.";
    } else {
      label = "Audited policy edit placeholder";
      decision = "admin";
      description = "Admin session verified. Policy writes are " + policyWrites + "; audited edit controls will appear here once validation is wired.";
    }

    return '<article class="rw-row" data-policy-edit-state="' + escapeHtml(decision) + '">' +
      '<div class="rw-row__head"><div class="rw-row__title">' + escapeHtml(label) + '</div>' + pill(decision, decision) + '</div>' +
      '<div class="rw-row__meta"><span class="rw-code">policy-edit</span><span>' + escapeHtml(policyWrites) + '</span></div>' +
      '<div class="rw-muted">' + escapeHtml(description) + '</div>' +
      '<div class="rw-actions"><button type="button" disabled aria-disabled="true">Policy edit unavailable</button></div>' +
    '</article>';
  }

  function renderPolicyRuleRow(rule) {
    return '<article class="rw-row">' +
      '<div class="rw-row__head"><div class="rw-row__title">' + escapeHtml(rule.label) + '</div>' + pill(rule.decision || "info") + '</div>' +
      '<div class="rw-row__meta"><span class="rw-code">' + escapeHtml(rule.code) + '</span></div>' +
      (rule.description ? '<div class="rw-muted rw-code">' + escapeHtml(rule.description) + '</div>' : "") +
    '</article>';
  }

  function receiptItemsFromSummary(summary) {
    const receiptRows = Array.isArray(summary?.receipts) ? summary.receipts.map(normalizeReceiptItem) : [];
    const exportRows = [];
    for (const exported of Array.isArray(summary?.exports) ? summary.exports : []) {
      if (!isObject(exported)) continue;
      if (exported.jsonPath) {
        exportRows.push(normalizeReceiptItem({
          id: "export-json-" + String(exported.sequence || exportRows.length + 1),
          label: "Receipt JSON export",
          kind: "artifact",
          status: "passed",
          capturedAt: exported.timestamp,
          uri: exported.jsonPath,
          mimeType: "application/json"
        }));
      }
      if (exported.markdownPath) {
        exportRows.push(normalizeReceiptItem({
          id: "export-markdown-" + String(exported.sequence || exportRows.length + 1),
          label: "Receipt Markdown export",
          kind: "artifact",
          status: "passed",
          capturedAt: exported.timestamp,
          uri: exported.markdownPath,
          mimeType: "text/markdown"
        }));
      }
    }
    return receiptRows.concat(exportRows);
  }

  function normalizeReceiptItem(receipt) {
    const item = isObject(receipt) ? receipt : {};
    return {
      id: String(item.id || "receipt"),
      label: String(item.label || item.id || "Receipt"),
      kind: String(item.kind || "artifact"),
      status: String(item.status || "info"),
      capturedAt: String(item.capturedAt || item.timestamp || ""),
      uri: item.uri ? String(item.uri) : undefined,
      digest: item.digest ? String(item.digest) : undefined,
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : undefined,
      mimeType: item.mimeType ? String(item.mimeType) : undefined
    };
  }

  function renderReceiptsBody(receipts) {
    if (!receipts || receipts.length === 0) return '<div class="rw-empty">No receipts captured.</div>';
    return '<div class="rw-stack">' + receipts.map(renderReceiptRow).join("") + '</div>';
  }

  function renderReceiptRow(receipt) {
    return '<article class="rw-row">' +
      '<div class="rw-row__head"><div class="rw-row__title">' + escapeHtml(receipt.label) + '</div>' + pill(receipt.status || "info") + '</div>' +
      '<div class="rw-row__meta"><span>' + escapeHtml(receipt.kind) + '</span><span>' + escapeHtml(receipt.capturedAt) + '</span>' +
      (receipt.mimeType ? '<span>' + escapeHtml(receipt.mimeType) + '</span>' : "") +
      (receipt.sizeBytes === undefined ? "" : '<span>' + escapeHtml(formatBytes(receipt.sizeBytes)) + '</span>') +
      '</div>' +
      (receipt.uri ? '<div class="rw-muted rw-code">' + escapeHtml(receipt.uri) + '</div>' : "") +
      (receipt.digest ? '<div class="rw-muted rw-code">' + escapeHtml(receipt.digest) + '</div>' : "") +
    '</article>';
  }

  function digestText(digest) {
    if (!isObject(digest) || !digest.value) return "";
    return (digest.algorithm ? String(digest.algorithm) + ":" : "") + String(digest.value);
  }

  function formatBytes(value) {
    if (!Number.isFinite(value)) return String(value);
    if (value < 1024) return String(value) + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }

  function normalizeOperator(value) {
    if (!isObject(value)) return { authenticated: false, authRequired: false, capabilities: {} };
    return {
      authenticated: value.authenticated === true,
      authRequired: value.authRequired === true,
      principal: isObject(value.principal) ? value.principal : undefined,
      capabilities: isObject(value.capabilities) ? value.capabilities : {}
    };
  }

  function operatorRoles(operator) {
    const principal = isObject(operator?.principal) ? operator.principal : undefined;
    return stringList(principal?.roles);
  }

  function operatorScopes(operator) {
    const principal = isObject(operator?.principal) ? operator.principal : undefined;
    if (!principal) return [];
    return [
      ...stringList(principal.allowedWorkspaces).map((workspace) => "workspace:" + workspace),
      ...stringList(principal.allowedUsers).map((user) => "user:" + user)
    ];
  }

  function roleTone(role) {
    if (role === "admin") return "success";
    if (role === "approver") return "warning";
    return "neutral";
  }

  function stringList(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry)).filter((entry) => entry.length > 0) : [];
  }

  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const refreshButton = target.closest("[data-refresh-cockpit]");
    if (refreshButton) {
      await refresh();
      return;
    }
    const runRow = target.closest("[data-run-id]");
    if (runRow) {
      state.selectedRunId = runRow.getAttribute("data-run-id") || state.selectedRunId;
      await refresh();
      return;
    }
    const approvalButton = target.closest("[data-approval-run][data-decision]");
    if (approvalButton) {
      const approvalRunId = approvalButton.getAttribute("data-approval-run");
      if (!approvalRunId) return;
      await fetch(endpoint("/runs/" + encodeURIComponent(approvalRunId) + "/approvals"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ decision: approvalButton.getAttribute("data-decision"), rationale: "Operator cockpit action." })
      });
      await refresh();
    }
  });

  if (typeof EventSource !== "undefined") {
    try {
      const eventsUrl = new URL(endpoint("/events"));
      if (token()) eventsUrl.searchParams.set("token", token());
      state.eventSource = new EventSource(eventsUrl.toString());
      state.eventSource.addEventListener("snapshot", (event) => {
        try {
          applySnapshot(JSON.parse(event.data));
        } catch {
          void refresh();
        }
      });
      state.eventSource.addEventListener("message", () => { void refresh(); });
    } catch {}
  }
  void refresh();
  window.setInterval(() => { void refresh(); }, pollIntervalMs);
})();
</script>`;
}
