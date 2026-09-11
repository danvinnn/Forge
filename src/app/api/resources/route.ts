import { NextResponse } from "next/server";
import { clientKey, getDeploymentMode, RateLimiter } from "../../../lib/retrieval";

export const runtime = "nodejs";
export const maxDuration = 60;
const limiter = new RateLimiter(30, 60_000);

export async function GET(request: Request) {
  if (getDeploymentMode() === "air-gapped") return NextResponse.json({ resources: [] });
  const limit = await limiter.check(clientKey(request));
  if (!limit.allowed) return NextResponse.json({ error: "Too many resource searches. Try again shortly." }, { status: 429 });
  const query = new URL(request.url).searchParams;
  const partNumber = (query.get("partNumber") ?? "").trim();
  const manufacturer = (query.get("manufacturer") ?? "").trim();
  const packageType = (query.get("packageType") ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._+\-/ ]{0,79}$/.test(partNumber) || manufacturer.length < 2 || manufacturer.length > 120) {
    return NextResponse.json({ error: "A valid part number and manufacturer are required." }, { status: 400 });
  }
  try {
    const { discoverOfficialResources } = await import("../../../lib/retrieval/resolvers/resources");
    return NextResponse.json({ resources: await discoverOfficialResources(partNumber, manufacturer, packageType || undefined) });
  } catch {
    // Discovery is an automatic recovery attempt, never a reason to fail the job.
    return NextResponse.json({ resources: [] });
  }
}

export async function POST(request: Request) {
  if (getDeploymentMode() === "air-gapped") return NextResponse.json({ error: "Automatic vendor import is unavailable in air-gapped mode." }, { status: 409 });
  const limit = await limiter.check(clientKey(request));
  if (!limit.allowed) return NextResponse.json({ error: "Too many resource imports. Try again shortly." }, { status: 429 });
  const payload = await request.json().catch(() => null) as { url?: unknown; manufacturer?: unknown } | null;
  if (!payload || typeof payload.url !== "string" || typeof payload.manufacturer !== "string" || payload.url.length > 2_000 || payload.manufacturer.length > 120) {
    return NextResponse.json({ error: "A valid official resource and manufacturer are required." }, { status: 400 });
  }
  try {
    const { importOfficialResource } = await import("../../../lib/retrieval/resolvers/resources");
    return NextResponse.json({ files: await importOfficialResource(payload.url, payload.manufacturer) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The official resource could not be imported." }, { status: 422 });
  }
}
