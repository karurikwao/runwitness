export interface TimelineItemViewModel {
  sequence: number;
  label: string;
  timestamp: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}
