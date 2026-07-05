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
    eventSource: undefined
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

  async function refresh() {
    const [runs, approvals] = await Promise.all([
      getJson("/runs?limit=50"),
      getJson("/approvals/pending")
    ]);
    if (!state.selectedRunId && runs.runs && runs.runs[0]) state.selectedRunId = runs.runs[0].id;
    const selected = state.selectedRunId ? await getJson("/runs/" + encodeURIComponent(state.selectedRunId) + "/timeline") : { events: [] };
    render(runs.runs || [], approvals.approvals || [], selected.events || []);
  }

  function applySnapshot(snapshot) {
    if (!state.selectedRunId && snapshot.latestRunId) state.selectedRunId = snapshot.latestRunId;
    render(snapshot.runs || [], snapshot.approvals || [], snapshot.latestEvents || []);
  }

  function render(runs, approvals, events) {
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
    main.querySelector(".rw-table tbody")?.replaceChildren();
    const runBody = main.querySelector(".rw-table tbody");
    if (runBody) runBody.innerHTML = runRows;
    const approvalsBody = main.querySelector('aside .rw-panel:nth-child(1) .rw-panel__body');
    if (approvalsBody) approvalsBody.innerHTML = approvalRows ? '<div class="rw-stack">' + approvalRows + '</div>' : '<div class="rw-empty">No approvals waiting.</div>';
    const timelineBody = main.querySelector('.rw-column .rw-panel:nth-child(2) .rw-panel__body');
    if (timelineBody) timelineBody.innerHTML = timelineRows ? '<div class="rw-timeline">' + timelineRows + '</div>' : '<div class="rw-empty">No timeline events.</div>';
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
