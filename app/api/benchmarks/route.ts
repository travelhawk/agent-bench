import { NextResponse } from "next/server";
import { createBenchmark } from "../../../src/server/service";
import { handleRouteError } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      key?: string;
      title?: string;
      description?: string;
      expectedOutcome?: string;
      benchmarkKey?: string;
      type?: "suite" | "task";
    };

    if (!body.key?.trim() || !body.title?.trim() || !body.description?.trim()) {
      return NextResponse.json({ error: "key, title, and description are required." }, { status: 400 });
    }

    return NextResponse.json(await createBenchmark({
      key: body.key.trim(),
      title: body.title.trim(),
      description: body.description.trim(),
      expectedOutcome: body.expectedOutcome?.trim(),
      benchmarkKey: body.benchmarkKey?.trim(),
      type: body.type === "task" ? "task" : "suite"
    }), { status: 201 });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
