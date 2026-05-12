import { NextResponse } from "next/server";
import {
  installProjectSkillsSelection,
  listProjectSkills,
  removeProjectSkillsSelection,
  updateProjectSkillsSelection
} from "../../../src/server/service";
import { handleRouteError, readJsonBody } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      skills: await listProjectSkills()
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{
      skills?: Array<{
        source?: string;
        skillName?: string;
        registryUrl?: string;
        installs?: number;
        title?: string;
      }>;
    }>(request);

    return NextResponse.json({
      skills: await installProjectSkillsSelection(body)
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJsonBody<{ names?: string[] }>(request);
    return NextResponse.json({
      skills: await updateProjectSkillsSelection(body)
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJsonBody<{ names?: string[] }>(request);
    return NextResponse.json({
      skills: await removeProjectSkillsSelection(body)
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
