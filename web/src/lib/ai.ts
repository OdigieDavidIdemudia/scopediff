import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
} from "firebase/ai";
import type { Change, ChangeItem } from "../types";
import { getFirebaseApp } from "./firebase";

export interface DiffInsight {
  summary: string;
  why_it_matters: string;
  review_first: string[];
  caveats: string[];
  inferenceSource: "ON_DEVICE" | "IN_CLOUD" | "UNKNOWN";
  latencyMs: number;
}

const schema = Schema.object({
  properties: {
    summary: Schema.string(),
    why_it_matters: Schema.string(),
    review_first: Schema.array({ items: Schema.string() }),
    caveats: Schema.array({ items: Schema.string() }),
  },
});

const systemInstruction = [
  "You are a bug bounty scope analyst.",
  "Use only the supplied public scope-diff facts.",
  "Do not invent targets, rewards or instructions.",
  "Do not tell the user to scan, fuzz, brute-force or exploit anything.",
  "Use neutral review language: inspect, verify, review and confirm authorization.",
  "Summarise what changed, why it matters to a hunter, and a short review focus.",
  "If a fact is missing, say so in caveats.",
].join(" ");

let modelPromise: ReturnType<typeof getGenerativeModel> | null = null;
let deviceInitPromise: Promise<void> | null = null;

async function getModel() {
  if (!modelPromise) {
    const app = await getFirebaseApp();
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    modelPromise = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      systemInstruction,
      inCloudParams: {
        model: "gemini-3.5-flash-lite",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          maxOutputTokens: 900,
        },
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [
            {
              role: "system",
              content: [{ type: "text", value: systemInstruction }],
            },
          ],
        },
        promptOptions: {
          responseConstraint: schema,
        },
      },
    });
  }
  return modelPromise;
}

/**
 * Chrome requires on-device model initialization to happen on or after a user
 * interaction. This is called from the AI button handler through analyzeDiff.
 * We deliberately do not await the model download: PREFER_ON_DEVICE falls back
 * to cloud while the download is still in progress, and later clicks use the
 * local model once it is ready.
 */
function startOnDeviceInit(model: ReturnType<typeof getGenerativeModel>): Promise<void> {
  if (!deviceInitPromise) {
    deviceInitPromise = model.initializeDeviceModel().catch(() => undefined);
  }
  return deviceInitPromise;
}

function short(value: unknown, max = 180): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function buildPrompt(change: Change, items: ChangeItem[]): string {
  const lines: string[] = [
    `Program: ${short(change.program_name, 80)} (${change.platform})`,
    `Versions: v${change.from_version} to v${change.to_version}`,
    `Impact: ${change.impact}; magnitude: ${change.magnitude}; confidence: ${change.confidence}`,
    `Materiality: ${change.materiality_score}/100`,
    `Counts: ${change.counts.added} added, ${change.counts.removed} removed, ${change.counts.modified} changed, ${change.counts.reintroduced} returned`,
    `Reasons: ${change.reasons.map((reason) => short(reason, 80)).join("; ")}`,
    "Changed targets:",
  ];
  for (const item of items.slice(0, 8)) {
    const before = item.before;
    const after = item.after;
    const tier =
      before && after && before.bounty_tier !== after.bounty_tier
        ? `; tier ${before.bounty_tier || "none"} -> ${after.bounty_tier || "none"}`
        : after?.bounty_tier
          ? `; tier ${after.bounty_tier}`
          : "";
    const bounty =
      before && after && before.max_bounty !== after.max_bounty
        ? `; max bounty ${before.max_bounty ?? "none"} -> ${after.max_bounty ?? "none"}`
        : after?.max_bounty
          ? `; max bounty ${after.max_bounty}`
          : "";
    lines.push(
      `- ${item.kind}: ${short(item.display || item.target, 90)} (${short(
        after?.canonical || before?.canonical || item.target,
        120,
      )})${tier}${bounty}; reasons: ${item.reasons
        .slice(0, 3)
        .map((reason) => short(reason, 70))
        .join(", ")}`,
    );
  }
  lines.push(
    "Return JSON with summary, why_it_matters, review_first (3-5 short strings), and caveats (0-3 short strings). Use review language only.",
  );
  return lines.join("\n");
}

function parseInsight(text: string): Omit<DiffInsight, "inferenceSource" | "latencyMs"> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as {
    summary?: unknown;
    why_it_matters?: unknown;
    review_first?: unknown;
    caveats?: unknown;
  };
  return {
    summary: short(parsed.summary, 500) || "The scope revision changed.",
    why_it_matters: short(parsed.why_it_matters, 500) || "Review the exact diff before testing.",
    review_first: Array.isArray(parsed.review_first)
      ? parsed.review_first.map((row) => short(row, 180)).filter(Boolean).slice(0, 5)
      : [],
    caveats: Array.isArray(parsed.caveats)
      ? parsed.caveats.map((row) => short(row, 180)).filter(Boolean).slice(0, 3)
      : [],
  };
}

export async function analyzeDiff(change: Change, items: ChangeItem[]): Promise<DiffInsight> {
  const started = performance.now();
  const model = await getModel();
  void startOnDeviceInit(model);
  const result = await model.generateContent(buildPrompt(change, items));
  const inference = String(result.response.inferenceSource || "unknown").toLowerCase();
  const inferenceSource =
    inference === "on_device" || inference === "on-device"
      ? "ON_DEVICE"
      : inference === "in_cloud" || inference === "in-cloud"
        ? "IN_CLOUD"
        : "UNKNOWN";
  return {
    ...parseInsight(result.response.text()),
    inferenceSource,
    latencyMs: Math.round(performance.now() - started),
  };
}

export async function onDeviceAvailability(): Promise<string> {
  if (typeof window === "undefined") return "unavailable";
  const LanguageModel = (window as unknown as { LanguageModel?: { availability?: () => Promise<string> } })
    .LanguageModel;
  if (!LanguageModel?.availability) return "unavailable";
  try {
    return await LanguageModel.availability();
  } catch {
    return "unavailable";
  }
}
