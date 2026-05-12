import { NextResponse } from "next/server";
import { getWorkbenchSnapshot } from "../../../src/server/service";
import { handleRouteError } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getWorkbenchSnapshot());
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
