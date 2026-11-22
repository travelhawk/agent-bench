import { NextResponse } from "next/server";
import { getComparisonMatrix } from "../../../src/server/service";
import { handleRouteError } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/comparison?benchmark=<key>&task=<key>&setups=<a,b,c>&limit=<n> */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await getComparisonMatrix({
      benchmarkKey: url.searchParams.get("benchmark") ?? undefined,
      taskKey: url.searchParams.get("task") ?? undefined,
      setupKeys: url.searchParams.get("setups") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined
    }));
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
