import type { Asset, ChangeItem } from "../types";

export function normalizeTarget(value: string): string {
  let out = value.trim().toLowerCase();
  out = out.replace(/^https?:\/\//i, "");
  out = out.replace(/\/+$/, "");
  return out;
}

export function hostPart(value: string): string {
  return normalizeTarget(value).split("/")[0].split("?")[0];
}

function wildcardMatches(wildcard: string, host: string): boolean {
  const value = normalizeTarget(wildcard);
  if (!value.startsWith("*.")) return false;
  const bare = value.slice(2);
  const candidate = hostPart(host);
  return candidate === bare || candidate.endsWith(`.${bare}`);
}

export function matchesOne(itemValue: string, testingValue: string): boolean {
  const item = normalizeTarget(itemValue);
  const test = normalizeTarget(testingValue);
  if (!item || !test) return false;
  if (item === test) return true;

  const itemHost = hostPart(item);
  const testHost = hostPart(test);

  if (item.startsWith("*.") && wildcardMatches(item, test)) return true;
  if (test.startsWith("*.") && wildcardMatches(test, item)) return true;

  if (itemHost === testHost) return true;

  // A bare domain on the testing list covers subdomains in scope.
  if (!test.includes("/") && itemHost.endsWith(`.${testHost}`)) return true;
  if (!item.includes("/") && testHost.endsWith(`.${itemHost}`)) return true;

  return false;
}

export function itemMatchesTarget(item: ChangeItem, target: string): boolean {
  const candidates = [
    item.target,
    item.display,
    item.after?.canonical,
    item.after?.target,
    item.before?.canonical,
    item.before?.target,
  ].filter((value): value is string => Boolean(value));
  return candidates.some((value) => matchesOne(value, target));
}

export function assetMatchesTarget(asset: Asset, target: string): boolean {
  return matchesOne(asset.target, target) || matchesOne(asset.display, target);
}

export function matchedTestingTargets(items: ChangeItem[], testing: string[]): string[] {
  return testing.filter((target) => items.some((item) => itemMatchesTarget(item, target)));
}

export function isCoveredByTesting(item: ChangeItem, testing: string[]): boolean {
  return testing.some((target) => itemMatchesTarget(item, target));
}
