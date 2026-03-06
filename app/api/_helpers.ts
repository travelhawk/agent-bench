import { NextResponse } from "next/server";

function statusFromMessage(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists/i.test(message)) return 409;
  if (/required|select|provide|unknown|must|failed/i.test(message)) return 400;
  return 500;
}

export function handleRouteError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: statusFromMessage(message) });
}
