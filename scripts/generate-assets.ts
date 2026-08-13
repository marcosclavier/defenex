/**
 * Generates brand imagery with Gemini. Run once at design time:
 *   pnpm assets
 *
 * Output is committed to apps/web/public/. Generating at request time would add
 * cost, latency and nondeterminism to every page load for artwork that never
 * changes.
 *
 * Art direction is deliberately narrow. No people, no product photography, no
 * text inside the image: for a product whose whole claim is verifiable evidence,
 * recognisably AI-generated imagery undermines the thing being sold. Type is
 * rendered as real type, over the texture, not baked into pixels.
 */
import { writeFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import { chromium } from "playwright";
import sharp from "sharp";

process.loadEnvFile(new URL("../.env", import.meta.url).pathname);

const MODEL = process.env.IMAGE_MODEL ?? "gemini-3-pro-image";

const ASSETS = [
  {
    file: "og-texture.jpg",
    aspectRatio: "16:9",
    imageSize: "2K",
    prompt: [
      "Abstract dark technical texture for a security product's social card.",
      "Near-black background, hex #0A0B0D, filling the frame.",
      "A faint topographic contour field and thin interference lines in dark",
      "slate grey, like a signal trace or a survey map, concentrated toward the",
      "lower right and fading to plain black across the left two thirds.",
      "Extremely low contrast and subtle, as though barely lit.",
      "No text, no letters, no numbers, no logos, no people, no products.",
      "Flat, matte, no gloss, no lens flare, no gradients toward blue or purple.",
    ].join(" "),
  },
];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });

  for (const asset of ASSETS) {
    process.stdout.write(`generating ${asset.file} … `);
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: asset.prompt,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: asset.aspectRatio, imageSize: asset.imageSize },
      },
    });

    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!image?.data) {
      console.log("FAILED — no image in response");
      console.log(JSON.stringify(res, null, 1).slice(0, 600));
      continue;
    }

    // Compress on the way in. The model returns multi-megabyte PNGs; the card
    // renders at 1200x630, so anything larger is bytes nobody ever sees.
    const raw = Buffer.from(image.data, "base64");
    const jpg = await sharp(raw)
      .resize(1200, 630, { fit: "cover" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    await writeFile(new URL(`../apps/web/public/${asset.file}`, import.meta.url), jpg);
    console.log(`${(raw.length / 1024).toFixed(0)} KB -> ${(jpg.length / 1024).toFixed(0)} KB`);
  }

  await buildSocialCard();
}

/**
 * Composes the social card: generated texture as ground, real IBM Plex type on
 * top. Type is rendered by a browser rather than baked into the generated
 * image, so it stays sharp, correct and editable without another model call.
 */
async function buildSocialCard() {
  process.stdout.write("composing og.jpg … ");

  const css = await fetch(
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@600&family=IBM+Plex+Mono:wght@400&display=swap",
    { headers: { "user-agent": "Mozilla/5.0 Chrome/120 Safari/537.36" } },
  ).then((r) => r.text());

  const [monoUrl, sansUrl] = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]!);
  const [mono, sans] = await Promise.all(
    [monoUrl, sansUrl].map(async (u) =>
      Buffer.from(await (await fetch(u!)).arrayBuffer()).toString("base64"),
    ),
  );

  const texture = (
    await sharp(new URL("../apps/web/public/og-texture.jpg", import.meta.url).pathname).toBuffer()
  ).toString("base64");

  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:'PS';src:url(data:font/ttf;base64,${sans}) format('truetype');font-weight:600}
    @font-face{font-family:'PM';src:url(data:font/ttf;base64,${mono}) format('truetype')}
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1200px;height:630px;background:#0a0b0d url(data:image/jpeg;base64,${texture}) center/cover no-repeat;
         display:flex;flex-direction:column;justify-content:space-between;padding:72px;color:#e8eaed}
    .mark{font-family:'PM';font-size:20px;letter-spacing:.24em;text-transform:uppercase;display:flex;align-items:center;gap:14px}
    .dot{width:11px;height:11px;background:#f2efe9}
    h1{font-family:'PS';font-weight:600;font-size:74px;line-height:1.03;letter-spacing:-.03em;max-width:15ch}
    .foot{font-family:'PM';font-size:19px;color:#9ba1a8}
    .rule{width:64px;height:2px;background:#f2efe9;margin-bottom:26px}
  </style>
  <div class="mark"><span class="dot"></span>Defenex</div>
  <div><div class="rule"></div><h1>Find who is faking your brand.</h1></div>
  <div class="foot">Counterfeits · lookalike domains · phishing · impersonation</div>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: "png" });
    const jpg = await sharp(png).resize(1200, 630).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    await writeFile(new URL("../apps/web/public/og.jpg", import.meta.url), jpg);
    console.log(`${(jpg.length / 1024).toFixed(0)} KB`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
