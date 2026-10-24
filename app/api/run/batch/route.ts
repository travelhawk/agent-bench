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
      judgeModel?: string;
      providerApiKey?: string;
      review?: "auto" | "off";
      runMode?: "single-task" | "benchmark-cycle";
      agents?: string[];
      setups?: Array<{
        agentPath?: string;
        model?: string | null;
        label?: string | null;
        review?: "auto" | "off" | null;
      }>;
      jobs?: Array<{
        benchmarkKey?: string;
        taskKey?: string;
        agentPath?: string;
        model?: string | null;
        setupKey?: string | null;
        review?: "auto" | "off" | null;
      }>;
    }>(request);

    return NextResponse.json(await runBatch({
      benchmarkKey: body.benchmarkKey,
      taskKey: body.taskKey,
      model: body.model,
      judgeModel: body.judgeModel,
      providerApiKey: body.providerApiKey,
      review: body.review,
      runMode: body.runMode,
      agents: Array.isArray(body.agents) ? body.agents : [],
      setups: Array.isArray(body.setups) ? body.setups : undefined,
      jobs: Array.isArray(body.jobs) ? body.jobs : undefined
    }));
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
