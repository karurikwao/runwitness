export type CockpitTone = "neutral" | "success" | "warning" | "danger";

export interface TimelineItemViewModel {
  sequence: number;
  label: string;
  timestamp: string;
  tone: CockpitTone;
  kind?: string;
  stepId?: string;
  detail?: string;
}

export interface CockpitMetricViewModel {
  label: string;
  value: string | number;
  tone?: CockpitTone;
}

export interface RunListItemViewModel {
  id: string;
  task: string;
  agent: string;
  workspace: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  active?: boolean;
  metrics?: CockpitMetricViewModel[];
}

export interface ApprovalItemViewModel {
  id: string;
  action: string;
  actionType: string;
  decision: string;
  requestedAt: string;
  actionSummary?: string;
  policyDecision?: string;
  mode?: string;
  requestedBy?: string;
  decidedAt?: string;
  decidedBy?: string;
  rationale?: string;
  reasons?: string[];
}

export interface PolicyRuleViewModel {
  code: string;
  label: string;
  decision: string;
  severity?: string;
  description?: string;
}

export interface PolicyPanelViewModel {
  defaultDecision?: string;
  rules: PolicyRuleViewModel[];
  findings?: PolicyRuleViewModel[];
}

export interface ReceiptItemViewModel {
  id: string;
  label: string;
  kind: string;
  status: string;
  capturedAt: string;
  uri?: string;
  digest?: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface OperatorCockpitViewModel {
  title: string;
  generatedAt: string;
  runs: RunListItemViewModel[];
  approvals: ApprovalItemViewModel[];
  policy: PolicyPanelViewModel;
  receipts: ReceiptItemViewModel[];
  timeline: TimelineItemViewModel[];
  selectedRunId?: string;
  metrics?: CockpitMetricViewModel[];
}

export const cockpitStyles = `
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.45;
  background: #f6f7f9;
  color: #1d252f;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f6f7f9;
}

.rw-shell {
  min-height: 100vh;
  background: #f6f7f9;
}

.rw-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid #d8dde6;
  background: #ffffff;
}

.rw-title h1 {
  margin: 0;
  font-size: 1.35rem;
  line-height: 1.2;
  letter-spacing: 0;
}

.rw-title p,
.rw-meta,
.rw-muted {
  margin: 4px 0 0;
  color: #566171;
  font-size: 0.875rem;
}

.rw-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.85fr);
  gap: 16px;
  padding: 16px;
}

.rw-column {
  display: grid;
  gap: 16px;
  align-content: start;
}

.rw-panel {
  overflow: hidden;
  border: 1px solid #d8dde6;
  border-radius: 8px;
  background: #ffffff;
}

.rw-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid #e6e9ef;
}

.rw-panel__header h2 {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.25;
  letter-spacing: 0;
}

.rw-panel__body {
  padding: 0;
}

.rw-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
  padding: 12px 14px;
}

.rw-metric {
  min-width: 0;
  padding: 10px;
  border: 1px solid #e1e5ec;
  border-radius: 8px;
  background: #fbfcfe;
}

.rw-metric__value {
  display: block;
  overflow-wrap: anywhere;
  font-size: 1.2rem;
  font-weight: 700;
}

.rw-metric__label {
  display: block;
  margin-top: 2px;
  color: #647083;
  font-size: 0.78rem;
}

.rw-table-wrap {
  overflow-x: auto;
}

.rw-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.rw-table th,
.rw-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #e8ebf0;
  text-align: left;
  vertical-align: top;
}

.rw-table th {
  color: #5d6878;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.rw-table tr[aria-current="true"] {
  background: #f0f6ff;
}

.rw-stack {
  display: grid;
}

.rw-row {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #e8ebf0;
}

.rw-row:last-child {
  border-bottom: 0;
}

.rw-row__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.rw-row__title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 700;
}

.rw-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  color: #5d6878;
  font-size: 0.8rem;
}

.rw-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid #d8dde6;
  border-radius: 999px;
  background: #f5f7fa;
  color: #344052;
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
}

.rw-pill--success,
.rw-metric--success {
  border-color: #b8dec7;
  background: #edf9f1;
  color: #176033;
}

.rw-pill--warning,
.rw-metric--warning {
  border-color: #edd58e;
  background: #fff8df;
  color: #76520b;
}

.rw-pill--danger,
.rw-metric--danger {
  border-color: #efb6b2;
  background: #fff0ef;
  color: #8b2c27;
}

.rw-pill--neutral,
.rw-metric--neutral {
  border-color: #d8dde6;
  background: #f5f7fa;
  color: #344052;
}

.rw-code {
  overflow-wrap: anywhere;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
}

.rw-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rw-actions button {
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid #c9d1de;
  border-radius: 6px;
  background: #ffffff;
  color: #1d252f;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.rw-actions button:hover {
  border-color: #8ea5c4;
  background: #f0f6ff;
}

.rw-timeline {
  display: grid;
}

.rw-timeline__item {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid #e8ebf0;
}

.rw-timeline__item:last-child {
  border-bottom: 0;
}

.rw-timeline__sequence {
  color: #647083;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.75rem;
}

.rw-empty {
  padding: 18px 14px;
  color: #647083;
  font-size: 0.875rem;
}

a {
  color: #245ea8;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

@media (max-width: 860px) {
  .rw-topbar {
    display: grid;
  }

  .rw-grid {
    grid-template-columns: 1fr;
  }
}
`;

export function renderOperatorCockpit(view: OperatorCockpitViewModel): string {
  return `
<main class="rw-shell">
  <header class="rw-topbar">
    <div class="rw-title">
      <h1>${escapeHtml(view.title)}</h1>
      <p>${formatCount(view.runs.length, "run")} tracked</p>
    </div>
    <div class="rw-meta">Generated ${escapeHtml(formatTimestamp(view.generatedAt))}</div>
  </header>
  ${renderMetricStrip(view.metrics ?? summarizeCockpitMetrics(view))}
  <div class="rw-grid">
    <div class="rw-column">
      ${renderRunTable(view.runs, view.selectedRunId)}
      ${renderTimelinePanel(view.timeline)}
    </div>
    <aside class="rw-column" aria-label="Run controls">
      ${renderApprovalsPanel(view.approvals)}
      ${renderPolicyPanel(view.policy)}
      ${renderReceiptsPanel(view.receipts)}
    </aside>
  </div>
</main>`;
}

export function renderRunTable(runs: RunListItemViewModel[], selectedRunId?: string): string {
  const rows = runs.map((run) => {
    const isSelected = selectedRunId === run.id || run.active === true;
    return `<tr${isSelected ? ' aria-current="true"' : ""}>
      <td>${renderStatusPill(run.status)}</td>
      <td><div class="rw-row__title">${escapeHtml(run.task)}</div><div class="rw-muted rw-code">${escapeHtml(run.id)}</div></td>
      <td>${escapeHtml(run.agent)}</td>
      <td class="rw-code">${escapeHtml(run.workspace)}</td>
      <td>${escapeHtml(formatTimestamp(run.startedAt))}</td>
      <td>${renderInlineMetrics(run.metrics ?? [])}</td>
    </tr>`;
  });

  return renderPanel(
    "Runs",
    runs.length === 0
      ? `<div class="rw-empty">No runs recorded.</div>`
      : `<div class="rw-table-wrap">
          <table class="rw-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Run</th>
                <th>Agent</th>
                <th>Workspace</th>
                <th>Started</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>${rows.join("")}</tbody>
          </table>
        </div>`,
  );
}

export function renderApprovalsPanel(approvals: ApprovalItemViewModel[]): string {
  const body =
    approvals.length === 0
      ? `<div class="rw-empty">No approvals waiting.</div>`
      : `<div class="rw-stack">${approvals.map(renderApprovalRow).join("")}</div>`;

  return renderPanel("Approvals", body, formatCount(approvals.length, "item"));
}

export function renderPolicyPanel(policy: PolicyPanelViewModel): string {
  const findings = policy.findings ?? [];
  const rules = policy.rules;
  const summary = policy.defaultDecision ? `Default ${humanize(policy.defaultDecision)}` : undefined;
  const body = [
    findings.length > 0 ? renderPolicyGroup("Active Findings", findings) : "",
    renderPolicyGroup("Loaded Rules", rules),
  ]
    .filter(Boolean)
    .join("");

  return renderPanel("Policy", body || `<div class="rw-empty">No policy rules loaded.</div>`, summary);
}

export function renderReceiptsPanel(receipts: ReceiptItemViewModel[]): string {
  const body =
    receipts.length === 0
      ? `<div class="rw-empty">No receipts captured.</div>`
      : `<div class="rw-stack">${receipts.map(renderReceiptRow).join("")}</div>`;

  return renderPanel("Receipts", body, formatCount(receipts.length, "receipt"));
}

export function renderTimelinePanel(items: TimelineItemViewModel[]): string {
  const rows = items.map(
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
  );

  return renderPanel(
    "Timeline",
    rows.length === 0 ? `<div class="rw-empty">No timeline events.</div>` : `<div class="rw-timeline">${rows.join("")}</div>`,
    formatCount(items.length, "event"),
  );
}

export function renderStatusPill(status: string, label = humanize(status)): string {
  const tone = toneForStatus(status);
  return `<span class="rw-pill rw-pill--${tone}">${escapeHtml(label)}</span>`;
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function renderMetricStrip(metrics: CockpitMetricViewModel[]): string {
  if (metrics.length === 0) {
    return "";
  }

  return `<section class="rw-metrics" aria-label="Run summary">${metrics
    .map(
      (metric) => `<div class="rw-metric rw-metric--${metric.tone ?? "neutral"}">
        <span class="rw-metric__value">${escapeHtml(metric.value)}</span>
        <span class="rw-metric__label">${escapeHtml(metric.label)}</span>
      </div>`,
    )
    .join("")}</section>`;
}

function renderPanel(title: string, body: string, summary?: string): string {
  return `<section class="rw-panel" aria-labelledby="${panelId(title)}">
    <header class="rw-panel__header">
      <h2 id="${panelId(title)}">${escapeHtml(title)}</h2>
      ${summary ? `<span class="rw-muted">${escapeHtml(summary)}</span>` : ""}
    </header>
    <div class="rw-panel__body">${body}</div>
  </section>`;
}

function renderApprovalRow(approval: ApprovalItemViewModel): string {
  const reasons = approval.reasons ?? [];
  return `<article class="rw-row">
    <div class="rw-row__head">
      <div class="rw-row__title">${escapeHtml(approval.actionSummary ?? approval.action)}</div>
      ${renderStatusPill(approval.decision)}
    </div>
    <div class="rw-row__meta">
      <span>${escapeHtml(approval.actionType)}</span>
      <span>${escapeHtml(formatTimestamp(approval.requestedAt))}</span>
      ${approval.policyDecision ? `<span>Policy ${escapeHtml(humanize(approval.policyDecision))}</span>` : ""}
      ${approval.mode ? `<span>${escapeHtml(humanize(approval.mode))}</span>` : ""}
    </div>
    <div class="rw-code">${escapeHtml(approval.action)}</div>
    ${reasons.length > 0 ? `<div class="rw-muted">${escapeHtml(reasons.join(", "))}</div>` : ""}
    ${approval.rationale ? `<div class="rw-muted">${escapeHtml(approval.rationale)}</div>` : ""}
  </article>`;
}

function renderPolicyGroup(title: string, rules: PolicyRuleViewModel[]): string {
  if (rules.length === 0) {
    return "";
  }

  return `<div class="rw-stack" aria-label="${escapeHtml(title)}">${rules.map(renderPolicyRuleRow).join("")}</div>`;
}

function renderPolicyRuleRow(rule: PolicyRuleViewModel): string {
  return `<article class="rw-row">
    <div class="rw-row__head">
      <div class="rw-row__title">${escapeHtml(rule.label)}</div>
      ${renderStatusPill(rule.decision)}
    </div>
    <div class="rw-row__meta">
      <span class="rw-code">${escapeHtml(rule.code)}</span>
      ${rule.severity ? `<span>${escapeHtml(humanize(rule.severity))}</span>` : ""}
    </div>
    ${rule.description ? `<div class="rw-muted">${escapeHtml(rule.description)}</div>` : ""}
  </article>`;
}

function renderReceiptRow(receipt: ReceiptItemViewModel): string {
  const target = renderReceiptTarget(receipt);
  return `<article class="rw-row">
    <div class="rw-row__head">
      <div class="rw-row__title">${target}</div>
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

function renderReceiptTarget(receipt: ReceiptItemViewModel): string {
  if (!receipt.uri) {
    return escapeHtml(receipt.label);
  }

  const href = safeHref(receipt.uri);
  if (!href) {
    return `${escapeHtml(receipt.label)} <span class="rw-muted rw-code">${escapeHtml(receipt.uri)}</span>`;
  }

  return `<a href="${escapeHtml(href)}">${escapeHtml(receipt.label)}</a>`;
}

function renderInlineMetrics(metrics: CockpitMetricViewModel[]): string {
  if (metrics.length === 0) {
    return `<span class="rw-muted">none</span>`;
  }

  return metrics.map((metric) => `${escapeHtml(metric.label)}: ${escapeHtml(metric.value)}`).join("<br>");
}

function summarizeCockpitMetrics(view: OperatorCockpitViewModel): CockpitMetricViewModel[] {
  return [
    { label: "Runs", value: view.runs.length },
    { label: "Approvals", value: view.approvals.length, tone: view.approvals.length > 0 ? "warning" : "success" },
    { label: "Receipts", value: view.receipts.length, tone: view.receipts.length > 0 ? "success" : "neutral" },
    { label: "Events", value: view.timeline.length },
  ];
}

function toneForStatus(status: string): CockpitTone {
  const normalized = status.toLowerCase();
  if (["allow", "approved", "completed", "granted", "passed", "success"].includes(normalized)) {
    return "success";
  }
  if (["ask", "pending", "running", "warning"].includes(normalized)) {
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

function panelId(title: string): string {
  return `rw-panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
