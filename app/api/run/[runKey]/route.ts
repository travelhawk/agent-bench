import { NextResponse } from "next/server";
import { deleteRun } from "../../../../src/server/service";
import { handleRouteError } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ runKey: string }> }) {
  try {
    const { runKey } = await context.params;
    return NextResponse.json(await deleteRun(runKey));
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
