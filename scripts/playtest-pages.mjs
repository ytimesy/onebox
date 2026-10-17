import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import {
  fixedPath,
  publicOrigin,
  publicPracticeId,
  publicMetadata,
} from "../packages/game-core/public-route.ts";

export async function writePlaytestPages(root, source, options = {}) {
  // Generic branding only: neither a board nor a puzzle solution is rendered.
  const browser = await chromium.launch();
  let png;
  try {
    const page = await browser.newPage();
    const base64 = await page.evaluate((label) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      const c = canvas.getContext("2d");
      if (!c) throw Error("Canvas unavailable");
      c.fillStyle = "#f4f1e9";
      c.fillRect(0, 0, 1200, 630);
      ["#19342f", "#c66c45", "#dfb859", "#6c8277"].forEach((color, i) => {
        c.fillStyle = color;
        c.fillRect(80 + i * 90, 80, 64, 64);
      });
      c.fillStyle = "#19342f";
      c.font = "bold 112px sans-serif";
      c.fillText("ONEBOX", 80, 310);
      c.font = "42px sans-serif";
      c.fillText("Four pieces. One perfect fit.", 80, 410);
      c.font = "30px sans-serif";
      c.fillText(label, 80, 530);
      return canvas.toDataURL("image/png").split(",")[1];
    }, options.label ?? "Fixed puzzle / Playtest");
    png = Buffer.from(base64, "base64");
  } finally {
    await browser.close();
  }
  const image = `onebox-cover-${createHash("sha256").update(png).digest("hex").slice(0, 12)}.png`;
  await writeFile(`${root}/assets/${image}`, png, { flag: "wx" });
  for (const locale of ["ja", "en"]) {
    const ja = locale === "ja",
      { title, description } = publicMetadata(locale);
    for (const fixed of [false, true]) {
      const path = fixed ? fixedPath(locale) : `/${locale}/`,
        canonical = publicOrigin + path;
      const alternate = (lang) =>
        publicOrigin + (fixed ? fixedPath(lang) : `/${lang}/`);
      let html = source
        .replace('<html lang="ja">', `<html lang="${locale}">`)
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(
          /<meta name="description"[^>]*>/,
          `<meta name="description" content="${description}"/>`,
        );
      html = html.replace(
        "</head>",
        `<meta name="robots" content="noindex,nofollow,noarchive"/><link rel="canonical" href="${canonical}"/><link rel="alternate" hreflang="ja" href="${alternate("ja")}"/><link rel="alternate" hreflang="en" href="${alternate("en")}"/><link rel="alternate" hreflang="x-default" href="${alternate("ja")}"/><meta property="og:type" content="website"/><meta property="og:title" content="${title}"/><meta property="og:description" content="${description}"/><meta property="og:url" content="${canonical}"/><meta property="og:image" content="${publicOrigin}/assets/${image}"/><meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/></head>`,
      );
      const directory = `${root}/${locale}${fixed ? `/p/${publicPracticeId}` : ""}`;
      await mkdir(directory, { recursive: true });
      await writeFile(`${directory}/index.html`, html);
      if (ja && !fixed) await writeFile(`${root}/index.html`, html);
    }
  }
}
