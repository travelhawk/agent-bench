import path from "node:path";
import express from "express";
import { createDb } from "../db/schema";
import { getDashboardSummary, listBenchmarks, listRuns } from "../db/store";

export function startUi(dbPath: string, port: number): void {
  const app = express();
  const db = createDb(dbPath);

  app.use(express.static(path.join(process.cwd(), "src", "ui", "public")));

  app.get("/api/summary", (_req, res) => {
    res.json(getDashboardSummary(db));
  });

  app.get("/api/runs", (req, res) => {
    const limitRaw = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 10;
    res.json(listRuns(db, limit));
  });

  app.get("/api/benchmarks", (_req, res) => {
    res.json(listBenchmarks(db));
  });

  app.get("/api/logs/latest", (_req, res) => {
    const latest = listRuns(db, 1)[0];
    res.type("text/plain").send(latest?.logText ?? "No runs yet. Execute `agent-bench run` first.");
  });

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`agent-bench ui started at http://localhost:${port}`);
  });
}