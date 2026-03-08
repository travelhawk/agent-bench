import { NextResponse } from "next/server";
import { createBenchmark } from "../../../src/server/service";
import { handleRouteError, readJsonBody } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{
      key?: string;
      title?: string;
      description?: string;
      expectedOutcome?: string;
      whyThisTask?: string;
      inputs?: string;
      deliverableFormat?: string;
      successChecks?: string[];
      failureModes?: string[];
      benchmarkKey?: string;
      resolution?: string;
      interaction?: string;
      evaluator?: string;
      difficulty?: string;
      domain?: string;
      tags?: string[] | string;
      requiresIsolation?: boolean;
      requiresNetwork?: boolean;
      type?: "suite" | "task";
    }>(request);

    if (!body.key?.trim() || !body.title?.trim() || !body.description?.trim()) {
      return NextResponse.json({ error: "key, title, and description are required." }, { status: 400 });
    }

    return NextResponse.json(await createBenchmark({
      key: body.key.trim(),
      title: body.title.trim(),
      description: body.description.trim(),
      expectedOutcome: body.expectedOutcome?.trim(),
      whyThisTask: body.whyThisTask?.trim(),
      inputs: body.inputs?.trim(),
      deliverableFormat: body.deliverableFormat?.trim(),
      successChecks: body.successChecks,
      failureModes: body.failureModes,
      benchmarkKey: body.benchmarkKey?.trim(),
      resolution: body.resolution,
      interaction: body.interaction,
      evaluator: body.evaluator,
      difficulty: body.difficulty,
      domain: body.domain?.trim(),
      tags: body.tags,
      requiresIsolation: body.requiresIsolation,
      requiresNetwork: body.requiresNetwork,
      type: body.type === "task" ? "task" : "suite"
    }), { status: 201 });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
