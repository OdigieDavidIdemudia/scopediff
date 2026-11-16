import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Asset, Change, ChangeItem } from "../types";
import {
  changeKindGlyph,
  changeKindLabel,
  cn,
  familyLabel,
  formatBounty,
  formatNumber,
} from "../lib/format";
import { ScopeChip } from "./ui";
import { SearchIcon } from "./Icons";

type KindFilter = "all" | "in" | "out";

export function ScopeTable({
  assets,
  latestChange,
  latestItems,
}: {
  assets: Asset[];
  latestChange: Change | null;
  latestItems: ChangeItem[];
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [family, setFamily] = useState("all");

  const families = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.family))).sort(),
    [assets],
  );

  const changedByKey = useMemo(() => {
    const map = new Map<string, ChangeItem>();
    for (const item of latestItems) map.set(item.asset_key, item);
    return map;
  }, [latestItems]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets
      .filter((asset) => (kind === "all" ? true : asset.kind === kind))
      .filter((asset) => (family === "all" ? true : asset.family === family))
      .filter((asset) => {
        if (!needle) return true;
        const haystack = [
          asset.display,
          asset.target,
          ...asset.groups.map((group) => group.name),
          ...asset.source_ids,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .slice()
      .sort((a, b) => {
        const aChanged = changedByKey.has(a.key) ? 0 : 1;
        const bChanged = changedByKey.has(b.key) ? 0 : 1;
        if (aChanged !== bChanged) return aChanged - bChanged;
        const order = { in: 0, conflict: 1, out: 2 };
        const diff = order[a.kind] - order[b.kind];
        if (diff !== 0) return diff;
        return a.display.localeCompare(b.display);
      });
  }, [assets, changedByKey, family, kind, query]);

  const inScope = assets.filter((asset) => asset.kind === "in").length;
  const outScope = assets.filter((asset) => asset.kind === "out").length;

  return (
    <div>
      <div className="scope-toolbar">
        <div className="search">
          <span className="search__icon">
            <SearchIcon size={14} />
          </span>
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search targets, groups or IDs…"
            aria-label="Search scope targets"
          />
        </div>
        <div className="segmented" role="group" aria-label="Scope kind">
          <button
            type="button"
            aria-pressed={kind === "all"}
            onClick={() => setKind("all")}
          >
            All ({assets.length})
          </button>
          <button type="button" aria-pressed={kind === "in"} onClick={() => setKind("in")}>
            In ({inScope})
          </button>
          <button type="button" aria-pressed={kind === "out"} onClick={() => setKind("out")}>
            Out ({outScope})
          </button>
        </div>
        <select
          className="select"
          style={{ width: "auto" }}
          value={family}
          onChange={(event) => setFamily(event.target.value)}
          aria-label="Filter by asset type"
        >
          <option value="all">All types</option>
          {families.map((value) => (
            <option key={value} value={value}>
              {familyLabel(value)}
            </option>
          ))}
        </select>
        <span className="table-count">
          {rows.length} of {assets.length}
        </span>
      </div>

      <div className="table-wrap">
        <table className="scope-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Reward tier</th>
              <th>Max bounty</th>
              <th>Severity</th>
              <th>Latest</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center" }}>
                  <span className="muted">No targets match those filters.</span>
                </td>
              </tr>
            )}
            {rows.map((asset) => {
              const changed = changedByKey.get(asset.key);
              return (
                <tr
                  key={asset.key}
                  className={cn(
                    asset.kind === "out" && "scope-row--out",
                    asset.kind === "conflict" && "scope-row--conflict",
                  )}
                >
                  <td>
                    <div className="scope-target">
                      <span className="scope-target__name">{asset.display}</span>
                      <span className="scope-target__canonical">{asset.target}</span>
                      {asset.groups.length > 0 && (
                        <span className="scope-group">
                          {asset.groups.map((group) => group.name).join(" · ")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="mini-badge">{familyLabel(asset.family)}</span>
                  </td>
                  <td>
                    <ScopeChip kind={asset.kind} />
                  </td>
                  <td>
                    {asset.attrs.bounty_tier ? (
                      <span className="mono" style={{ fontSize: 10 }}>
                        {asset.attrs.bounty_tier}
                      </span>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td>
                    {asset.attrs.bounty_eligible ? (
                      <span className="mono" style={{ fontSize: 10 }}>
                        {formatBounty(asset.attrs.max_bounty, asset.attrs.currency)}
                      </span>
                    ) : (
                      <span className="subtle">Not eligible</span>
                    )}
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 10 }}>
                      {asset.attrs.max_severity || "—"}
                    </span>
                  </td>
                  <td>
                    {changed && latestChange ? (
                      <Link
                        to={`/changes/${latestChange.id}#${changed.id}`}
                        className={cn("chip", changed.impact === "risk" ? "chip--red" : "chip--green")}
                        title={changed.reasons.join(" · ")}
                      >
                        {changeKindGlyph(changed.kind)} {changeKindLabel(changed.kind)}
                      </Link>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-count" style={{ marginTop: 6 }}>
        {formatNumber(assets.length)} published targets · latest revision v
        {latestChange?.to_version ?? "—"}
      </div>
    </div>
  );
}
