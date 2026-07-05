import { cockpitStyles, escapeHtml, renderOperatorCockpit } from "@runwitness/ui";
import type {
  ApprovalItemViewModel,
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
  const styles = options.includeStyles === false ? "" : `<style>${cockpitStyles}</style>`;

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
  return renderOperatorCockpit(view);
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
    operator: { authenticated: false, capabilities: {} }
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
    if (["allow", "approved", "completed", "granted", "passed", "success"].includes(normalized)) return "success";
    if (["ask", "pending", "running", "warning"].includes(normalized)) return "warning";
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
      safeGetJson("/operator/me", { authenticated: false, capabilities: {} })
    ]);
    state.operator = operator || { authenticated: false, capabilities: {} };
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
    const runRows = runs.map((run) => '<tr' + (run.id === state.selectedRunId ? ' aria-current="true"' : "") + ' data-run-id="' + escapeHtml(run.id) + '">' +
      '<td>' + pill(run.status) + '</td>' +
      '<td><div class="rw-row__title">' + escapeHtml(run.task) + '</div><div class="rw-muted rw-code">' + escapeHtml(run.id) + '</div></td>' +
      '<td>' + escapeHtml(run.agent) + '</td>' +
      '<td class="rw-code">' + escapeHtml(run.workspace) + '</td>' +
      '<td>' + escapeHtml(run.startedAt) + '</td>' +
      '<td>' + escapeHtml(run.receipts?.total ?? 0) + ' receipts</td>' +
    '</tr>').join("");
    const approvalRows = approvals.map((approval) => '<article class="rw-row">' +
      '<div class="rw-row__head"><div class="rw-row__title">' + escapeHtml(approval.action) + '</div>' + pill(approval.policyDecision || "ask") + '</div>' +
      '<div class="rw-row__meta"><span>' + escapeHtml(approval.runId) + '</span><span>' + escapeHtml(approval.requestedAt) + '</span></div>' +
      '<div class="rw-code">' + escapeHtml((approval.reasons || []).join(", ")) + '</div>' +
      '<div class="rw-actions"><button type="button" data-approval-run="' + escapeHtml(approval.runId) + '" data-decision="allow">Allow</button><button type="button" data-approval-run="' + escapeHtml(approval.runId) + '" data-decision="deny">Deny</button></div>' +
    '</article>').join("");
    const timelineRows = events.map((event) => '<article class="rw-timeline__item">' +
      '<div class="rw-timeline__sequence">#' + String(event.sequence).padStart(3, "0") + '</div>' +
      '<div><div class="rw-row__head"><div class="rw-row__title">' + escapeHtml(event.kind) + '</div>' + pill(event.kind) + '</div>' +
      '<div class="rw-row__meta"><span>' + escapeHtml(event.timestamp) + '</span></div>' +
      '<div class="rw-muted rw-code">' + escapeHtml(JSON.stringify(event.payload || {})) + '</div></div>' +
    '</article>').join("");
    const policyRows = renderPolicyBody(policy);
    const receiptRows = renderReceiptsBody(receipts);
    main.querySelector(".rw-table tbody")?.replaceChildren();
    const runBody = main.querySelector(".rw-table tbody");
    if (runBody) runBody.innerHTML = runRows;
    const approvalsBody = panelBody("rw-panel-approvals");
    if (approvalsBody) approvalsBody.innerHTML = approvalRows ? '<div class="rw-stack">' + approvalRows + '</div>' : '<div class="rw-empty">No approvals waiting.</div>';
    const timelineBody = panelBody("rw-panel-timeline");
    if (timelineBody) timelineBody.innerHTML = timelineRows ? '<div class="rw-timeline">' + timelineRows + '</div>' : '<div class="rw-empty">No timeline events.</div>';
    const policyBody = panelBody("rw-panel-policy");
    if (policyBody) policyBody.innerHTML = policyRows;
    const receiptsBody = panelBody("rw-panel-receipts");
    if (receiptsBody) receiptsBody.innerHTML = receiptRows;
  }

  function panelBody(id) {
    return document.getElementById(id)?.closest(".rw-panel")?.querySelector(".rw-panel__body");
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
        code: "policy-admin-placeholder",
        label: "Policy explain/edit placeholder",
        decision: "admin",
        description: "Authenticated admin-capable operator detected. Policy writes remain disabled until audited validation is available."
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
    const body = [
      findings.length > 0 ? '<div class="rw-stack">' + findings.map(renderPolicyRuleRow).join("") + '</div>' : "",
      rules.length > 0 ? '<div class="rw-stack">' + rules.map(renderPolicyRuleRow).join("") + '</div>' : ""
    ].filter(Boolean).join("");
    return body || '<div class="rw-empty">No policy lineage loaded.</div>';
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

  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const runRow = target.closest("[data-run-id]");
    if (runRow) {
      state.selectedRunId = runRow.getAttribute("data-run-id") || state.selectedRunId;
      await refresh();
      return;
    }
    const approvalButton = target.closest("[data-approval-run][data-decision]");
    if (approvalButton) {
      await fetch(endpoint("/runs/" + encodeURIComponent(approvalButton.getAttribute("data-approval-run")) + "/approvals"), {
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
