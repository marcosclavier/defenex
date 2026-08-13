import { GoogleGenAI } from "@google/genai";
import type { Classification, EnrichedResult, ScanInput } from "@defenex/shared";
import { buildSystemPrompt, buildUserPrompt, sourceTextFor } from "./prompt.js";
import { ClassificationResponse, RESPONSE_JSON_SCHEMA } from "./schema.js";
import { verifyEvidence } from "./verify.js";
import { silentLogger, type Logger } from "../ports.js";

/** Verified as of 2026-08: current stable balanced text model. */
export const DEFAULT_CLASSIFIER_MODEL = "gemini-3.6-flash";

export interface ClassifierResult {
  /** Index into the batch passed in; entries the model skipped are absent. */
  byIndex: Map<number, Classification>;
  rejectedForBadEvidence: number;
}

/** Swappable so the model is never load-bearing on the rest of the engine. */
export interface Classifier {
  classify(items: EnrichedResult[], input: ScanInput): Promise<ClassifierResult>;
}

export interface GeminiClassifierOptions {
  apiKey: string;
  model?: string;
  batchSize?: number;
  logger?: Logger;
}

export class GeminiClassifier implements Classifier {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly log: Logger;

  constructor(opts: GeminiClassifierOptions) {
    if (!opts.apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_CLASSIFIER_MODEL;
    this.batchSize = opts.batchSize ?? 10;
    this.log = opts.logger ?? silentLogger;
  }

  async classify(items: EnrichedResult[], input: ScanInput): Promise<ClassifierResult> {
    const byIndex = new Map<number, Classification>();
    let rejected = 0;

    for (let offset = 0; offset < items.length; offset += this.batchSize) {
      const batch = items.slice(offset, offset + this.batchSize);
      const parsed = await this.classifyBatch(batch, input);

      for (const entry of parsed) {
        const item = batch[entry.index];
        if (!item) {
          this.log.warn("classifier returned out-of-range index", { index: entry.index });
          continue;
        }

        // Verify the quote actually exists before the finding is allowed to exist.
        const check = verifyEvidence(entry.evidenceQuote, sourceTextFor(item));
        if (!check.ok) {
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

        byIndex.set(offset + entry.index, {
          category: entry.category,
          confidence: entry.confidence,
          evidenceQuote: entry.evidenceQuote,
          reasoning: entry.reasoning,
        });
      }
    }

    return { byIndex, rejectedForBadEvidence: rejected };
  }

  private async classifyBatch(batch: EnrichedResult[], input: ScanInput) {
    const contents = buildUserPrompt(batch, input);

    // One retry: structured output makes malformed responses rare but not impossible.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents,
          config: {
            systemInstruction: buildSystemPrompt(),
            responseMimeType: "application/json",
            responseJsonSchema: RESPONSE_JSON_SCHEMA,
            temperature: 0,
          },
        });

        const text = response.text;
        if (!text) throw new Error("empty response from model");

        const parsed = ClassificationResponse.safeParse(JSON.parse(text));
        if (!parsed.success) {
          throw new Error(`schema mismatch: ${parsed.error.message.slice(0, 200)}`);
        }
        return parsed.data.results;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log.warn("classifier attempt failed", { attempt, error: message });
        if (attempt === 1) {
          this.log.error("classifier batch dropped", { size: batch.length, error: message });
          return [];
        }
      }
    }
    return [];
  }
}
