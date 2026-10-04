// Generates a 16:9 hero image for a blog article with Gemini.
// Usage: node scripts/gen-article-image.mjs <out.jpg> "<subject description>"
import { writeFile } from "node:fs/promises";

const [out, subject] = process.argv.slice(2);
if (!out || !subject) {
  console.error('usage: gen-article-image.mjs <out.jpg> "<subject>"');
  process.exit(1);
}
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY is not set");
const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";

// One house style for every article so the blog reads as a set.
const STYLE =
  "Editorial illustration for a brand-protection company's blog. " +
  "Near-black background (#0a0b0d), off-white/paper tones (#f2efe9), a single warm accent " +
  "of signal red (#f0575b) or amber (#e08a3c). Minimal, precise, slightly technical; " +
  "flat shapes with fine line work and subtle grain, generous negative space. " +
  "No text, no letters, no words, no logos, no real brand names, no watermarks. 16:9 composition.";

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${STYLE}\n\nSubject: ${subject}` }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
      },
    }),
  },
);
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const json = await res.json();
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
if (!part) throw new Error(`no image returned: ${JSON.stringify(json).slice(0, 500)}`);
await writeFile(out, Buffer.from(part.inlineData.data, "base64"));
console.log(`wrote ${out}`);
