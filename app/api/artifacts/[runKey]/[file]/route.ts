import { NextResponse } from "next/server";
import { readArtifact } from "../../../../../src/server/service";
import { handleRouteError } from "../../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ runKey: string; file: string }> }) {
  try {
    const { runKey, file } = await context.params;
    const artifact = await readArtifact(runKey, file);

    return new NextResponse(new Uint8Array(artifact.body), {
      headers: {
        "Content-Type": artifact.contentType
      }
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
