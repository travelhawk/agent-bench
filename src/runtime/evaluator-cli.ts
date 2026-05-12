import { readFileSync, writeFileSync } from "node:fs";
import { evaluate } from "./evaluator";
import { RuntimeEvaluationRequest } from "../types";

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const resultPath = process.argv[3];
  if (!requestPath || !resultPath) {
    throw new Error("Usage: node evaluator-cli.js <request.json> <result.json>");
  }

  const input = JSON.parse(readFileSync(requestPath, "utf8")) as RuntimeEvaluationRequest;
  const result = await evaluate(input);
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
