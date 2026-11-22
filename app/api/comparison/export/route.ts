import { exportComparison } from "../../../../src/server/service";
import { handleRouteError } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shareable comparison export.
 *
 * GET /api/comparison/export?format=md|csv|json|html&benchmark=<key>&task=<key>
 *   &setups=<a,b,c>&limit=<n>&download=1
 *
 * The response is the rendered report itself, so it can be piped straight to a
 * file, pasted into a PR, or opened in a browser.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const download = url.searchParams.get("download") !== "0";
    const result = await exportComparison({
      format: url.searchParams.get("format") ?? undefined,
      benchmarkKey: url.searchParams.get("benchmark") ?? undefined,
      taskKey: url.searchParams.get("task") ?? undefined,
      setupKeys: url.searchParams.get("setups") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      title: url.searchParams.get("title") ?? undefined,
      shareUrl: url.searchParams.get("shareUrl") ?? undefined
    });

    return new Response(result.body, {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${result.fileName}"`,
        "cache-control": "no-store",
        "x-agent-bench-setups": String(result.setupCount),
        "x-agent-bench-runs": String(result.runCount)
      }
    });
  } catch (error: unknown) {
    return handleRouteError(error);
  }
}
