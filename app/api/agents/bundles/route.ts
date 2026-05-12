import { NextResponse } from "next/server";
import { createAgentBundle } from "../../../../src/server/service";
import { handleRouteError, readJsonBody } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{
      name?: string;
      baseAgentPath?: string;
      agentMarkdown?: string;
      files?: Array<{
        path?: string;
        content?: string;
      }>;
      skills?: Array<{
        source?: string;
        skillName?: string;
        registryUrl?: string;
        installs?: number;
        title?: string;
      }>;
    }>(request);

    return NextResponse.json({
      agent: await createAgentBundle(body)
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
