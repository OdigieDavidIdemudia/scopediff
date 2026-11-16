import type { FeedFilters, Platform } from "../types";
import { cn, impactLabel, platformLabel } from "../lib/format";
import { ShieldIcon } from "./Icons";

const platforms: Array<Platform | "all"> = ["all", "bugcrowd", "hackerone", "intigriti", "sandbox"];
const impacts = ["all", "risk", "opportunity", "mixed", "neutral"] as const;
const confidences = ["all", "high", "low"] as const;

export function FilterPanel({
  filters,
  onChange,
  onClear,
  platformCounts,
  impactCounts,
  confidenceCounts,
  watchedCount,
  testingCount,
  open,
}: {
  filters: FeedFilters;
  onChange: (patch: Partial<FeedFilters>) => void;
  onClear: () => void;
  platformCounts: Record<string, number>;
  impactCounts: Record<string, number>;
  confidenceCounts: Record<string, number>;
  watchedCount: number;
  testingCount: number;
  open: boolean;
}) {
  return (
    <aside className={cn("filter-panel", open && "is-open")} aria-label="Feed filters">
      <div className="filter-panel__head">
        <span className="filter-panel__title">Filters</span>
        <button type="button" className="link-button" onClick={onClear}>
          Clear all
        </button>
      </div>

      <div className="filter-group">
        <div className="filter-group__label">Platform</div>
        <div className="filter-options">
          {platforms.map((platform) => (
            <button
              key={platform}
              type="button"
              className="filter-option"
              aria-pressed={filters.platform === platform}
              onClick={() => onChange({ platform })}
            >
              <span>{platform === "all" ? "All platforms" : platformLabel(platform)}</span>
              <span className="filter-option__count">{platformCounts[platform] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <div className="filter-group__label">Impact</div>
        <div className="filter-options">
          {impacts.map((impact) => (
            <button
              key={impact}
              type="button"
              className="filter-option"
              aria-pressed={filters.impact === impact}
              onClick={() => onChange({ impact })}
            >
              <span>{impact === "all" ? "Any impact" : impactLabel(impact)}</span>
              <span className="filter-option__count">{impactCounts[impact] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <div className="filter-group__label">Confidence</div>
        <div className="filter-options">
          {confidences.map((confidence) => (
            <button
              key={confidence}
              type="button"
              className="filter-option"
              aria-pressed={filters.confidence === confidence}
              onClick={() => onChange({ confidence })}
            >
              <span>{confidence === "all" ? "Any confidence" : confidence === "high" ? "High" : "Low"}</span>
              <span className="filter-option__count">{confidenceCounts[confidence] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <div className="filter-group__label">Personal</div>
        <div className="filter-options">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={filters.watchedOnly}
              onChange={(event) => onChange({ watchedOnly: event.target.checked })}
            />
            <span>
              Watched changes <span className="subtle">({watchedCount})</span>
            </span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={filters.testingOnly}
              onChange={(event) => onChange({ testingOnly: event.target.checked })}
            />
            <span>
              Touching my targets <span className="subtle">({testingCount})</span>
            </span>
          </label>
        </div>
      </div>

      <div className="filter-panel__foot">
        <ShieldIcon size={12} /> ScopeDiff compares published revisions. It never touches a
        target.
      </div>
    </aside>
  );
}
