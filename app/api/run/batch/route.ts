import { NextResponse } from "next/server";
import { runBatch } from "../../../../src/server/service";
import { handleRouteError, readJsonBody } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{
      benchmarkKey?: string;
      taskKey?: string;
      model?: string;
      providerApiKey?: string;
      runMode?: "single-task" | "benchmark-cycle";
      agents?: string[];
    }>(request);

    return NextResponse.json(await runBatch({
      benchmarkKey: body.benchmarkKey,
      taskKey: body.taskKey,
      model: body.model,
      providerApiKey: body.providerApiKey,
      runMode: body.runMode,
      agents: Array.isArray(body.agents) ? body.agents : []
    }));
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
