import { GoogleGenAI } from "@google/genai";
import type { Classification, EnrichedResult, FindingCategory, ScanInput } from "@defenex/shared";
import { buildSystemPrompt, buildUserPrompt, sourceTextFor } from "./prompt.js";
import { ClassificationItem, ClassificationResponse, RESPONSE_JSON_SCHEMA } from "./schema.js";
import { verifyEvidence } from "./verify.js";
import { silentLogger, type Logger } from "../ports.js";

/** Verified as of 2026-08: current stable balanced text model. */
export const DEFAULT_CLASSIFIER_MODEL = "gemini-3.6-flash";

/**
 * What became of one page we asked about.
 *
 * `byIndex` only ever held the pages that came back clean, so everything else
 * was absent for one of three quite different reasons and the caller could not
 * tell which. It matters most for `batch_failed`: that one is not a verdict at
 * all, it is up to `batchSize` candidates lost to an API error, and reading it
 * as "nothing found here" understates a scan by a quarter without saying so.
 */
export type ClassifyOutcome =
  | { status: "classified"; classification: Classification }
  | { status: "evidence_rejected"; category: FindingCategory; reason: string }
  | { status: "model_omitted" }
  | { status: "batch_failed"; error: string };

export interface ClassifierResult {
  /** Index into the batch passed in; entries the model skipped are absent. */
  byIndex: Map<number, Classification>;
  /** One entry for every item passed in, whatever happened to it. */
  outcomes: Map<number, ClassifyOutcome>;
  /**
   * Findings lost because their quote could not be verified. Counts accusations
   * only — a LEGITIMATE verdict with an unusable quote costs nothing, and is
   * recorded in `outcomes` rather than here.
   */
  rejectedForBadEvidence: number;
}

/** Swappable so the model is never load-bearing on the rest of the engine. */
export interface Classifier {
  classify(items: EnrichedResult[], input: ScanInput): Promise<ClassifierResult>;
}

/** One model round-trip, returning raw JSON text. A seam for tests. */
export type ModelCall = (batch: EnrichedResult[], input: ScanInput) => Promise<string | undefined>;

export interface GeminiClassifierOptions {
  apiKey: string;
  model?: string;
  batchSize?: number;
  logger?: Logger;
  /** Replaces the API call. Production leaves this unset. */
  modelCall?: ModelCall;
}

type BatchAttempt =
  | { ok: true; results: ClassificationItem[] }
  | { ok: false; error: string };

export class GeminiClassifier implements Classifier {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly log: Logger;
  private readonly modelCall: ModelCall;

  constructor(opts: GeminiClassifierOptions) {
    if (!opts.apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_CLASSIFIER_MODEL;
    this.batchSize = opts.batchSize ?? 10;
    this.log = opts.logger ?? silentLogger;
    this.modelCall = opts.modelCall ?? ((batch, input) => this.callModel(batch, input));
  }

  async classify(items: EnrichedResult[], input: ScanInput): Promise<ClassifierResult> {
    const byIndex = new Map<number, Classification>();
    const outcomes = new Map<number, ClassifyOutcome>();
    let rejected = 0;

    for (let offset = 0; offset < items.length; offset += this.batchSize) {
      const batch = items.slice(offset, offset + this.batchSize);
      const attempt = await this.classifyBatch(batch, input);

      if (!attempt.ok) {
        // Every page in the batch is lost, and says so. The batches around it
        // are unaffected, which is the point of failing per batch rather than
        // per scan.
        for (let i = 0; i < batch.length; i++) {
          outcomes.set(offset + i, { status: "batch_failed", error: attempt.error });
        }
        continue;
      }

      // The default for a page the model never mentions. Overwritten below by
      // whatever it did say.
      for (let i = 0; i < batch.length; i++) outcomes.set(offset + i, { status: "model_omitted" });

      for (const entry of attempt.results) {
        const item = batch[entry.index];
        if (!item) {
          // Leaves that slot omitted, which is what it is: no usable verdict.
          this.log.warn("classifier returned out-of-range index", { index: entry.index });
          continue;
        }

        // Verify the quote actually exists before the finding is allowed to exist.
        const check = verifyEvidence(entry.evidenceQuote, sourceTextFor(item), {
          brand: input.brand,
          aliases: input.aliases,
        });
        if (!check.ok) {
          outcomes.set(offset + entry.index, {
            status: "evidence_rejected",
            category: entry.category,
            reason: check.reason ?? "unverifiable",
          });
          if (entry.category !== "LEGITIMATE") {
            rejected += 1;
            this.log.warn("finding rejected: unverifiable evidence", {
              url: item.url,
              category: entry.category,
              reason: check.reason,
            });
          }
          continue;
        }

        const classification: Classification = {
          category: entry.category,
          confidence: entry.confidence,
          evidenceQuote: entry.evidenceQuote,
          reasoning: entry.reasoning,
        };
        byIndex.set(offset + entry.index, classification);
        outcomes.set(offset + entry.index, { status: "classified", classification });
      }
    }

    return { byIndex, outcomes, rejectedForBadEvidence: rejected };
  }

  /**
   * One retry: structured output makes malformed responses rare but not
   * impossible. Both attempts failing returns the last error rather than an
   * empty result set — the two look identical to the caller otherwise, and one
   * of them means ten pages went unjudged.
   */
  private async classifyBatch(batch: EnrichedResult[], input: ScanInput): Promise<BatchAttempt> {
    let error = "unknown error";

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await this.modelCall(batch, input);
        if (!text) throw new Error("empty response from model");

        const parsed = ClassificationResponse.safeParse(JSON.parse(text));
        if (!parsed.success) {
          throw new Error(`schema mismatch: ${parsed.error.message.slice(0, 200)}`);
        }
        return { ok: true, results: parsed.data.results };
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        this.log.warn("classifier attempt failed", { attempt, error });
      }
    }

    this.log.error("classifier batch dropped", { size: batch.length, error });
    return { ok: false, error };
  }

  private async callModel(batch: EnrichedResult[], input: ScanInput): Promise<string | undefined> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: buildUserPrompt(batch, input),
      config: {
        systemInstruction: buildSystemPrompt(),
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        temperature: 0,
      },
    });
    return response.text;
  }
}
