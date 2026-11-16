import { Link } from "react-router-dom";
import type { Change } from "../types";
import {
  changeHeadline,
  changeKindGlyph,
  cn,
  formatDateTime,
  timeAgo,
} from "../lib/format";
import { itemsForChange, matchedTargetsForChange } from "../lib/selectors";
import { useApp } from "../state/AppStore";
import { CountsRow, MaterialityBar, PlatformChip, TimeStamp } from "./ui";
import { ArrowRightIcon, StarIcon } from "./Icons";

export function ChangeCard({ change, fresh = false }: { change: Change; fresh?: boolean }) {
  const { data, testing, watchlist, toggleWatch } = useApp();
  const items = itemsForChange(data, change);
  const preview = items.slice(0, 3);
  const matched = matchedTargetsForChange(data, change, testing);
  const watched = watchlist.includes(change.program_id);
  const reasons = change.reasons.slice(0, 4);

  return (
    <article
      className={cn(
        "change-card",
        `change-card--${change.impact}`,
        fresh && "change-card--fresh",
      )}
    >
      <div className="change-card__top">
        <div className="change-card__identity">
          <PlatformChip platform={change.platform} />
          <Link className="change-card__program" to={`/programs/${change.program_id}`}>
            {change.program_name}
          </Link>
          {change.is_simulation && <span className="chip chip--accent">Simulated</span>}
          {change.is_baseline && <span className="chip">Baseline</span>}
          {change.confidence === "low" && <span className="chip chip--yellow">Partial revision</span>}
        </div>
        <div className="change-card__meta">
          {fresh && <span className="mini-badge mini-badge--new">New</span>}
          <TimeStamp iso={change.detected_at} />
        </div>
      </div>

      <div className="version-pair" title={formatDateTime(change.detected_at)}>
        v{change.from_version} → v{change.to_version}
        <span className="subtle"> · detected {timeAgo(change.detected_at)}</span>
      </div>

      <h2 className="change-card__headline">
        <Link to={`/changes/${change.id}`}>{changeHeadline(change)}</Link>
      </h2>

      {reasons.length > 0 && (
        <div className="change-card__reasons">
          {reasons.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      )}

      <CountsRow counts={change.counts} />

      {preview.length > 0 && (
        <ul className="item-preview">
          {preview.map((item) => {
            const target =
              item.after?.canonical || item.before?.canonical || item.target || item.display;
            return (
              <li key={item.id}>
                <Link
                  className="item-preview__row"
                  to={`/changes/${change.id}#${item.id}`}
                  title={`${item.display} · ${target}`}
                >
                  <span className={cn("item-preview__glyph", `glyph--${item.kind}`)}>
                    {changeKindGlyph(item.kind)}
                  </span>
                  <span className="item-preview__target">{target}</span>
                  <span className="item-preview__reason">
                    {item.reasons[0] || item.display}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {matched.length > 0 && (
        <div className="personal-callout">
          <StarIcon size={12} />
          <span>
            <strong>
              {matched.length} of your testing {matched.length === 1 ? "target is" : "targets are"} affected:
            </strong>{" "}
            {matched.join(", ")}
          </span>
        </div>
      )}

      <div className="change-card__footer">
        <MaterialityBar score={change.materiality_score} />
        <div className="card-actions">
          <button
            type="button"
            className={cn("button button--sm", watched ? "button--primary" : "button--ghost")}
            onClick={() => toggleWatch(change.program_id)}
            aria-pressed={watched}
            title={watched ? "Stop watching this program" : "Watch this program"}
          >
            <StarIcon size={12} fill={watched ? "currentColor" : "none"} />
            {watched ? "Watching" : "Watch"}
          </button>
          <Link className="button button--sm" to={`/changes/${change.id}`}>
            View diff
            <ArrowRightIcon size={12} />
          </Link>
        </div>
      </div>
    </article>
  );
}
