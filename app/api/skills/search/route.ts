import { NextResponse } from "next/server";
import { searchSkills } from "../../../../src/server/service";
import { handleRouteError, readJsonBody } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ query?: string }>(request);
    if (!body.query?.trim()) {
      return NextResponse.json({ error: "query is required." }, { status: 400 });
    }

    return NextResponse.json({
      results: await searchSkills(body.query)
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
