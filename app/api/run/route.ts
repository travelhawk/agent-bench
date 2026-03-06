import { NextResponse } from "next/server";
import { runSingle } from "../../../src/server/service";
import { handleRouteError } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      benchmarkKey?: string;
      taskKey?: string;
      agentPath?: string;
      agentMarkdown?: string;
      model?: string;
      providerApiKey?: string;
    };

    return NextResponse.json(await runSingle(body));
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
