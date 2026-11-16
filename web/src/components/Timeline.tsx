import { Link } from "react-router-dom";
import type { Version } from "../types";
import { cn, formatDateTime, timeAgo } from "../lib/format";
import { AlertTriangleIcon } from "./Icons";

export function VersionTimeline({
  versions,
  currentVersion,
}: {
  versions: Version[];
  currentVersion: number;
}) {
  if (!versions.length) {
    return <p className="side-empty">No versions captured yet.</p>;
  }
  return (
    <ol className="timeline">
      {versions.map((version) => {
        const current = version.version === currentVersion;
        return (
          <li
            key={version.version}
            className={cn("timeline__item", current && "timeline__item--current")}
          >
            <span className="timeline__marker" aria-hidden="true" />
            <div className="timeline__top">
              <span className="timeline__version">v{version.version}</span>
              {current && <span className="mini-badge mini-badge--accent">current</span>}
              {version.is_baseline && <span className="mini-badge">baseline</span>}
              {version.confidence === "low" && (
                <span className="mini-badge" title="Incomplete revision">
                  <AlertTriangleIcon size={8} /> partial
                </span>
              )}
            </div>
            <div className="timeline__meta">
              {version.counts.in_scope} in scope · {version.counts.bounty_eligible} bounty ·{" "}
              <span title={formatDateTime(version.captured_at)}>{timeAgo(version.captured_at)}</span>
            </div>
            {version.change_id ? (
              <Link className="timeline__link" to={`/changes/${version.change_id}`}>
                View diff v{version.version - 1} → v{version.version}
              </Link>
            ) : (
              <span className="timeline__note">Baseline snapshot</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
