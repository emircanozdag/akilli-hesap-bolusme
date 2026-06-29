#!/usr/bin/env node
/**
 * Gemini Nano Banana ile splash + icon üretir.
 * Kullanım: node scripts/generate-brand-assets.mjs
 * GEMINI_API_KEY: packages/server/.env veya ortam değişkeni
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, "..", "assets");
const serverEnv = path.join(__dirname, "..", "..", "server", ".env");

function loadApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (!fs.existsSync(serverEnv)) {
    throw new Error("GEMINI_API_KEY bulunamadı (ortam veya packages/server/.env)");
  }
  const line = fs
    .readFileSync(serverEnv, "utf8")
    .split("\n")
    .find((l) => l.startsWith("GEMINI_API_KEY="));
  if (!line) throw new Error("packages/server/.env içinde GEMINI_API_KEY yok");
  const key = line.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!key || key.includes("buraya")) {
    throw new Error("Geçerli GEMINI_API_KEY ayarlayın");
  }
  return key;
}

const MODELS = ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"];

async function generateImage(apiKey, { prompt, aspectRatio, imageSize, outFile }) {
  let lastError;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio, imageSize },
      },
    };

    console.log(`→ ${path.basename(outFile)} (${aspectRatio}, ${model})…`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      lastError = new Error(`${model} HTTP ${res.status}: ${detail.slice(0, 400)}`);
      console.warn(`  ⚠ ${lastError.message}`);
      continue;
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart) {
      lastError = new Error(`${model}: görsel parçası yok`);
      console.warn(`  ⚠ ${lastError.message}`);
      continue;
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, Buffer.from(imagePart.inlineData.data, "base64"));
    console.log(`  ✓ kaydedildi: ${outFile}`);
    return outFile;
  }
  throw lastError ?? new Error("Görsel üretilemedi");
}

const SPLASH_FORMAT = `Format: portrait mobile splash, 9:16 aspect ratio, full-bleed edge-to-edge. Background gradient must extend to all four edges with NO letterboxing, NO borders, NO empty margins. Hero illustration centered in the safe middle third.`;

const SPLASH_PROMPT_A = `Premium mobile app splash artwork, perfectly matching the app icon style.

${SPLASH_FORMAT}

Background: seamless premium deep indigo-navy (#0b0e1a) to vivid violet gradient filling the entire canvas.

Concept: A dynamic, expanded view of the app's core action. Two stylized, modern 3D hands (soft claymorphism) hold a sleek smartphone in the center, scanning a long white restaurant receipt that floats below. From the glowing phone screen, luminous neon purple and cyan paths branch outward into three floating 3D avatar spheres, beautifully illustrating the "scan and split" magic. 

Style: modern 3D illustration, soft tactile claymorphism mixed with glassmorphism UI elements, ultra clean, premium fintech aesthetic, vibrant glowing lighting.

Constraints: NO text, NO letters, NO numbers, NO logos, NO watermarks, NO photorealism. Keep important details in the vertical center safe zone.`;

const SPLASH_PROMPT_B = `Premium mobile app splash artwork, matching a highly creative portal-splitting theme.

${SPLASH_FORMAT}

Background: seamless premium deep indigo-navy (#0b0e1a) to vivid violet gradient filling the entire canvas.

Concept: A beautiful, futuristic 3D glassmorphic portal ring floats at the center. A long, elegant white receipt flows gracefully down through this glowing portal ring. As the receipt passes through the ring, it magically transforms and splits into a flowing stream of colorful semi-transparent glass cards, glowing coins, and vibrant floating avatar nodes connected by neon threads, illustrating the instant, smart splitting of a bill.

Style: modern 3D illustration, glassmorphism, glowing neon lights, soft reflections, high-end fintech aesthetic.

Constraints: NO text, NO letters, NO numbers, NO logos, NO watermarks, NO photorealism. Keep important details in the vertical center safe zone.`;

const SPLASH_PROMPT_C = `Premium mobile app splash artwork, ultra-minimalist and geometric theme.

${SPLASH_FORMAT}

Background: solid premium deep navy (#0b0e1a) with a very soft, subtle radial glow in the center, filling the entire canvas edge-to-edge.

Concept: A beautifully clean, minimalist 3D white receipt floats at an angle. The receipt is elegantly sliced into three perfectly aligned, clean geometric sections. From each section, a single thin, glowing neon line (one purple, one teal, one amber) extends outward to a simple, elegant circular node. Extremely clean, modern, and uncluttered.

Style: flat-to-soft 3D, geometric precision, minimalist fintech.

Constraints: NO text, NO letters, NO numbers, NO logos, NO watermarks, NO photorealism, NO clutter. Keep important details in the vertical center safe zone.`;

const ICON_PROMPT_A = `World-class original mobile app icon about RECEIPT SCANNING. Award-winning, iOS App Store featured quality.

Format: perfect square 1:1, full-bleed edge-to-edge, NO rounded corners.

Background: smooth premium deep indigo-navy (#0b0e1a) to vivid violet gradient.

Single hero concept, perfectly centered: Two stylized, modern 3D hands holding a sleek smartphone, taking a photo of a white restaurant receipt. The phone screen brightly displays the receipt being scanned with a glowing neon purple/cyan effect. The hands are abstract, smooth, and tactile (soft 3D/claymorphism style). The physical receipt is visible just below the phone.

Style: modern 3D illustration, ultra clean, premium fintech, vibrant but readable at small sizes.

Constraints: NO text, NO letters, NO numbers, NO photorealism (use stylized 3D), NO watermark, NO border frame.`;

const ICON_PROMPT_B = `World-class original mobile app icon about RECEIPT SCANNING + smart bill splitting. Award-winning, iOS App Store featured quality.

Format: perfect square 1:1, full-bleed edge-to-edge, NO rounded corners.

Background: smooth premium deep indigo-navy (#0b0e1a) to vivid violet gradient.

Single original hero symbol, perfectly centered: A futuristic, glowing 3D glassmorphic portal ring. A clean, stylized white receipt enters the ring from the top, and as it passes through, it emerges from the bottom split perfectly into three colorful, semi-transparent glassmorphic cards (purple, teal, amber) floating downwards. Conveys "scan a receipt, split it magically" in one iconic shape.

Style: modern 3D illustration, glassmorphism, glowing neon lights, soft reflections, high-end fintech aesthetic.

Constraints: ONE central concept (a receipt splitting through a portal), NO extra text, NO letters, NO numbers, NO camera brackets, NO laser line, NO human faces, NO clutter, NO photorealism, NO watermark, NO border frame.`;

const ICON_PROMPT_C = `World-class minimalist mobile app icon for a smart bill-splitting app. Award-winning, iOS App Store featured quality.

Format: perfect square 1:1, full-bleed edge-to-edge, NO rounded corners.

Background: solid premium deep navy (#0b0e1a) with a very soft, subtle radial glow behind the center.

Single hero symbol, perfectly centered: A clean, flat-to-soft 3D white receipt slip with a jagged bottom edge. On the face of the receipt, a single, bold glowing neon division sign (÷) is beautifully printed in a vibrant purple-to-teal gradient. Extremely simple, iconic, and recognizable even at 40px.

Style: minimalist, geometric precision, flat-to-soft 3D, ultra-clean, generous negative space.

Constraints: ONE central symbol only (receipt with ÷), NO text, NO letters, NO numbers besides the ÷ glyph, NO camera brackets, NO laser line, NO human faces, NO clutter, NO photorealism, NO watermark, NO border frame.`;

async function main() {
  const apiKey = loadApiKey();
  // "--icon" → app-icon, "--splash" → splash, "--v2" → portal, "--v3" → minimalist, yoksa ikisi.
  const arg = process.argv[2];

  if (arg === "--v2") {
    console.log("=== V2 (Portal Temalı) Görseller Üretiliyor ===");
    await generateImage(apiKey, {
      prompt: SPLASH_PROMPT_B,
      aspectRatio: "9:16",
      imageSize: "2K",
      outFile: path.join(assetsDir, "splash-v2.png"),
    });
    await generateImage(apiKey, {
      prompt: ICON_PROMPT_B,
      aspectRatio: "1:1",
      imageSize: "1K",
      outFile: path.join(assetsDir, "app-icon-v2.png"),
    });
    console.log("\nV2 Tamamlandı. Beğenirseniz bunları splash.png ve app-icon.png olarak kopyalayabilirsiniz.");
    return;
  }

  if (arg === "--v3") {
    console.log("=== V3 (Minimalist Geometrik) Görseller Üretiliyor ===");
    await generateImage(apiKey, {
      prompt: SPLASH_PROMPT_C,
      aspectRatio: "9:16",
      imageSize: "2K",
      outFile: path.join(assetsDir, "splash-v3.png"),
    });
    await generateImage(apiKey, {
      prompt: ICON_PROMPT_C,
      aspectRatio: "1:1",
      imageSize: "1K",
      outFile: path.join(assetsDir, "app-icon-v3.png"),
    });
    console.log("\nV3 Tamamlandı. Beğenirseniz bunları splash.png ve app-icon.png olarak kopyalayabilirsiniz.");
    return;
  }

  const wantSplash = !arg || arg === "--splash";
  const wantIcon = !arg || arg === "--icon";

  if (wantSplash) {
    await generateImage(apiKey, {
      prompt: SPLASH_PROMPT_A,
      aspectRatio: "9:16",
      imageSize: "2K",
      outFile: path.join(assetsDir, "splash.png"),
    });
  }
  if (wantIcon) {
    await generateImage(apiKey, {
      prompt: ICON_PROMPT_A,
      aspectRatio: "1:1",
      imageSize: "1K",
      outFile: path.join(assetsDir, "app-icon.png"),
    });
  }
  console.log("\nTamamlandı.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
