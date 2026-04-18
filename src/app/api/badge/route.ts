import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Revalidate badges every 5 minutes
export const revalidate = 300;

function scoreColor(score: number): string {
  if (score >= 80) return "#10b981"; // emerald
  if (score >= 65) return "#14b8a6"; // teal
  if (score >= 50) return "#f59e0b"; // amber
  if (score >= 35) return "#f97316"; // orange
  return "#ef4444";                  // red
}

function scoreLabel(score: number): string {
  if (score >= 80) return "excellent";
  if (score >= 65) return "good";
  if (score >= 50) return "fair";
  if (score >= 35) return "poor";
  return "critical";
}

function buildSvg(label: string, score: number, style: "flat" | "flat-square" | "for-the-badge"): string {
  const color = scoreColor(score);
  const valueText = `${score}/100`;
  const labelText = label;

  if (style === "for-the-badge") {
    const lw = labelText.length * 7.5 + 16;
    const vw = valueText.length * 8.5 + 16;
    const w = lw + vw;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" role="img" aria-label="${labelText}: ${valueText}">
  <title>${labelText}: ${valueText}</title>
  <rect width="${lw}" height="28" fill="#555"/>
  <rect x="${lw}" width="${vw}" height="28" fill="${color}"/>
  <text x="${lw / 2}" y="18" fill="#fff" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11" font-weight="bold" text-anchor="middle" letter-spacing="1">${labelText.toUpperCase()}</text>
  <text x="${lw + vw / 2}" y="18" fill="#fff" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11" font-weight="bold" text-anchor="middle">${valueText}</text>
</svg>`;
  }

  if (style === "flat-square") {
    const lw = labelText.length * 6 + 10;
    const vw = valueText.length * 6.5 + 10;
    const w = lw + vw;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${labelText}: ${valueText}">
  <title>${labelText}: ${valueText}</title>
  <rect width="${lw}" height="20" fill="#555"/>
  <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
  <text x="${lw / 2}" y="14" fill="#fff" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11" text-anchor="middle">${labelText}</text>
  <text x="${lw + vw / 2}" y="14" fill="#fff" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11" font-weight="bold" text-anchor="middle">${valueText}</text>
</svg>`;
  }

  // flat (default) — with subtle gradient + rounded cap feel via linearGradient
  const lw = labelText.length * 6 + 10;
  const vw = valueText.length * 6.5 + 12;
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${labelText}: ${valueText}">
  <title>${labelText}: ${valueText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text x="${(lw / 2 + 1) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(lw - 10) * 10}" lengthAdjust="spacing">${labelText}</text>
    <text x="${(lw / 2) * 10}" y="140" transform="scale(.1)" textLength="${(lw - 10) * 10}" lengthAdjust="spacing">${labelText}</text>
    <text x="${(lw + vw / 2 + 1) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(vw - 10) * 10}" lengthAdjust="spacing">${valueText}</text>
    <text x="${(lw + vw / 2) * 10}" y="140" transform="scale(.1)" textLength="${(vw - 10) * 10}" lengthAdjust="spacing">${valueText}</text>
  </g>
</svg>`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const repo  = searchParams.get("repo");   // owner/name
  const style = (searchParams.get("style") ?? "flat") as "flat" | "flat-square" | "for-the-badge";
  const metric = searchParams.get("metric") ?? "health"; // health | security | quality

  if (!repo || !repo.includes("/")) {
    return new NextResponse("Missing repo parameter (owner/name)", { status: 400 });
  }

  // Pull the most recent scan for this repo (public badge — no auth required)
  const latest = await prisma.repoScanHistory.findFirst({
    where: { repo },
    orderBy: { createdAt: "desc" },
    select: { healthScore: true, securityScore: true, qualityScore: true },
  }).catch(() => null);

  let score: number;
  let label: string;

  if (!latest) {
    // No scan found — render a "not scanned" badge
    const w = 130;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img">
  <title>gitscope: not scanned</title>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="68" height="20" fill="#555"/>
    <rect x="68" width="${w - 68}" height="20" fill="#9ca3af"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11">
    <text x="34" y="14">gitscope</text>
    <text x="${68 + (w - 68) / 2}" y="14">not scanned</text>
  </g>
</svg>`;
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache, max-age=0",
      },
    });
  }

  if (metric === "security") {
    score = latest.securityScore;
    label = "security";
  } else if (metric === "quality") {
    score = latest.qualityScore;
    label = "code quality";
  } else {
    score = latest.healthScore;
    label = "gitscope";
  }

  const validStyles = ["flat", "flat-square", "for-the-badge"];
  const safeStyle = validStyles.includes(style) ? style : "flat";
  const svg = buildSvg(label, score, safeStyle as "flat" | "flat-square" | "for-the-badge");

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": `public, max-age=300, s-maxage=300`,
      "X-Score": String(score),
      "X-Label": scoreLabel(score),
    },
  });
}
