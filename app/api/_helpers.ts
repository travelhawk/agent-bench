function statusFromMessage(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists/i.test(message)) return 409;
  if (/required|select|provide|unknown|must|failed|invalid json|json object|request body/i.test(message)) return 400;
  return 500;
}

export async function readJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Request body must be JSON.");
  }

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Request body must be a JSON object.");
    }
    return body as T;
  } catch (error: unknown) {
    if (error instanceof Error && /json object/i.test(error.message)) {
      throw error;
    }
    throw new Error("Invalid JSON body.");
  }
}

export function handleRouteError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status: statusFromMessage(message) });
}
