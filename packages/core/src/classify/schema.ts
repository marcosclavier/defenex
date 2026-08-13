import { z } from "zod";
import { Confidence, FindingCategory } from "@defenex/shared";

export const ClassificationItem = z.object({
  index: z.number().int().min(0),
  category: FindingCategory,
  confidence: Confidence,
  evidenceQuote: z.string(),
  reasoning: z.string(),
});

export const ClassificationResponse = z.object({
  results: z.array(ClassificationItem),
});

export type ClassificationItem = z.infer<typeof ClassificationItem>;

/** JSON Schema handed to Gemini so it returns parseable output by construction. */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          category: { type: "string", enum: FindingCategory.options },
          confidence: { type: "string", enum: Confidence.options },
          evidenceQuote: {
            type: "string",
            description: "Verbatim span copied from that page's SOURCE TEXT.",
          },
          reasoning: { type: "string" },
        },
        required: ["index", "category", "confidence", "evidenceQuote", "reasoning"],
      },
    },
  },
  required: ["results"],
} as const;
