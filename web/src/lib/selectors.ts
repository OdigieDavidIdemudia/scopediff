import type { Change, ChangeItem, DemoData, Program, Snapshot, Version } from "../types";
import { itemMatchesTarget } from "./matching";

export function visibleChanges(data: DemoData): Change[] {
  return data.changes
    .filter((change) => !change.hidden && !change.is_baseline)
    .slice()
    .sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at));
}

export function itemsForChange(data: DemoData, change: Change): ChangeItem[] {
  const rows = data.items.filter((item) => item.change_id === change.id);
  if (rows.length) {
    return rows.slice().sort((a, b) => b.materiality_score - a.materiality_score);
  }
  if (change.items?.length) {
    return change.items.slice().sort((a, b) => b.materiality_score - a.materiality_score);
  }
  return change.items_preview.slice().sort((a, b) => b.materiality_score - a.materiality_score);
}

export function matchedTargetsForChange(
  data: DemoData,
  change: Change,
  testing: string[],
): string[] {
  if (!testing.length) return [];
  const items = itemsForChange(data, change);
  return testing.filter((target) => items.some((item) => itemMatchesTarget(item, target)));
}

export function changeTouchesTesting(
  data: DemoData,
  change: Change,
  testing: string[],
): boolean {
  return matchedTargetsForChange(data, change, testing).length > 0;
}

export function findProgram(data: DemoData, programId: string): Program | null {
  return data.programs.find((program) => program.id === programId) ?? null;
}

export function currentSnapshot(data: DemoData, program: Program): Snapshot | null {
  return (
    data.snapshots.find(
      (snapshot) =>
        snapshot.program_id === program.id && snapshot.version === program.current_version,
    ) ?? null
  );
}

export function versionsFor(data: DemoData, programId: string): Version[] {
  return data.versions
    .filter((version) => version.program_id === programId)
    .slice()
    .sort((a, b) => b.version - a.version);
}

export function changesFor(data: DemoData, programId: string): Change[] {
  return visibleChanges(data).filter((change) => change.program_id === programId);
}

export function latestChangeFor(data: DemoData, programId: string): Change | null {
  return changesFor(data, programId)[0] ?? null;
}

export function countMatchedTestingTargets(data: DemoData, testing: string[]): number {
  const matched = new Set<string>();
  for (const change of visibleChanges(data)) {
    for (const target of matchedTargetsForChange(data, change, testing)) {
      matched.add(target);
    }
  }
  return matched.size;
}

export function runStatusTone(status: string): "ok" | "warn" | "error" | "unknown" {
  if (status === "ok") return "ok";
  if (status === "warn" || status === "running") return "warn";
  if (status === "error") return "error";
  return "unknown";
}

export function scopeTone(kind: string): "green" | "red" | "yellow" {
  if (kind === "in") return "green";
  if (kind === "out") return "red";
  return "yellow";
}

export function queryMatchesChange(
  data: DemoData,
  change: Change,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const items = itemsForChange(data, change);
  const haystack = [
    change.program_name,
    change.platform,
    change.id,
    change.impact,
    change.magnitude,
    ...change.reasons,
    ...items.flatMap((item) => [
      item.display,
      item.target,
      item.after?.target,
      item.after?.canonical,
      item.before?.target,
      item.before?.canonical,
      ...item.reasons,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
