import type {
  AssetFamily,
  Change,
  ChangeCounts,
  Confidence,
  Impact,
  Magnitude,
  Platform,
} from "../types";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : pluralForm || `${singular}s`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${day} · ${time} UTC`;
}

export function formatBounty(value: number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency || "$"}${value.toLocaleString("en-US")}`;
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  bugcrowd: "Bugcrowd",
  hackerone: "HackerOne",
  intigriti: "Intigriti",
  sandbox: "Sandbox",
};

export const PLATFORM_SHORT: Record<Platform, string> = {
  bugcrowd: "BC",
  hackerone: "H1",
  intigriti: "IGT",
  sandbox: "SBX",
};

export function platformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform] || platform;
}

export function impactLabel(impact: Impact): string {
  return impact === "risk"
    ? "Risk"
    : impact === "opportunity"
      ? "Opportunity"
      : impact === "mixed"
        ? "Mixed"
        : "Neutral";
}

export function magnitudeLabel(magnitude: Magnitude): string {
  return magnitude.toUpperCase();
}

export function confidenceLabel(confidence: Confidence): string {
  return confidence === "high" ? "High confidence" : "Low confidence";
}

export function familyLabel(family: AssetFamily | string): string {
  const labels: Record<string, string> = {
    web: "Web",
    api: "API",
    wildcard: "Wildcard",
    ip: "IP",
    cidr: "CIDR",
    mobile_android: "Android",
    mobile_ios: "iOS",
    source_code: "Source",
    hardware: "Hardware",
    other: "Other",
  };
  return labels[family] || family;
}

export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function scoreBand(score: number): Magnitude {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function countsSummary(counts: ChangeCounts): string {
  const parts: string[] = [];
  if (counts.added) parts.push(`+${counts.added} added`);
  if (counts.removed) parts.push(`−${counts.removed} removed`);
  if (counts.reintroduced) parts.push(`↺${counts.reintroduced} returned`);
  if (counts.modified) parts.push(`~${counts.modified} changed`);
  if (counts.moved_in) parts.push(`+${counts.moved_in} moved in`);
  if (counts.moved_out) parts.push(`−${counts.moved_out} moved out`);
  return parts.join(" · ") || "No target changes";
}

export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "max_bounty" && typeof value === "number") return formatBounty(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value
      .map((row) => {
        if (typeof row === "string") return row;
        if (row && typeof row === "object") {
          const record = row as Record<string, unknown>;
          if ("name" in record) {
            const scope = record.in_scope === false ? "out" : "in";
            return `${record.name} (${scope}${record.tier ? `, ${record.tier}` : ""})`;
          }
          return JSON.stringify(row);
        }
        return String(row);
      })
      .join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function stripScheme(value: string): string {
  return value.replace(/^https?:\/\//i, "");
}

export function looksLikeTarget(value: string): boolean {
  if (!value || value.includes(" ")) return false;
  return /[.:*]/.test(value) || value.includes("/");
}

export function changeTitle(change: Change): string {
  if (change.counts.total === 0) return "Scope snapshot";
  return `${change.counts.total} ${plural(change.counts.total, "target")} changed`;
}

export function changeHeadline(change: Change): string {
  const { added, removed, reintroduced, modified, moved_in, moved_out, total } = change.counts;
  const addedCount = added + moved_in;
  const removedCount = removed + moved_out;
  const parts: string[] = [];

  if (addedCount) parts.push(`${addedCount} added`);
  if (removedCount) parts.push(`${removedCount} removed`);
  if (reintroduced) parts.push(`${reintroduced} returned`);
  if (modified) parts.push(`${modified} changed`);

  if (parts.length) return parts.join(", ");
  if (total === 0) return "Snapshot published";
  return `${total} ${plural(total, "target")} changed`;
}

export function changeKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    added: "Added",
    removed: "Removed",
    reintroduced: "Returned",
    modified: "Changed",
    moved_in: "Moved in",
    moved_out: "Moved out",
  };
  return labels[kind] || kind;
}

export function changeKindGlyph(kind: string): string {
  const glyphs: Record<string, string> = {
    added: "+",
    removed: "−",
    reintroduced: "↺",
    modified: "~",
    moved_in: "→",
    moved_out: "←",
  };
  return glyphs[kind] || "·";
}

export function impactTone(impact: Impact): "risk" | "opportunity" | "mixed" | "neutral" {
  return impact;
}

export function scopeLabel(kind: string): string {
  if (kind === "in") return "In scope";
  if (kind === "out") return "Out of scope";
  return "Conflict";
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
