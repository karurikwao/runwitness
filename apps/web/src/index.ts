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
</body>
</html>`;
}

export function renderWebCockpitBody(view: WebCockpitViewModel): string {
  return renderOperatorCockpit(view);
}
