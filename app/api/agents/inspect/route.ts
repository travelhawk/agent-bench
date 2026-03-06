import { NextResponse } from "next/server";
import { inspectAgent } from "../../../../src/server/service";
import { handleRouteError, readJsonBody } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ agentPath?: string }>(request);
    if (!body.agentPath?.trim()) {
      return NextResponse.json({ error: "agentPath is required." }, { status: 400 });
    }

    return NextResponse.json({
      agent: await inspectAgent(body.agentPath)
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
