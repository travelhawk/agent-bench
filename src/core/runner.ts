import { randomUUID } from "node:crypto";
import { RunInput, RuntimeEvaluationRequest } from "../types";
import { evaluate } from "../runtime/evaluator";

export function newRunKey(): string {
  return `run-${randomUUID()}`;
}

export async function runEvaluationInRuntime(input: RuntimeEvaluationRequest): Promise<RunInput> {
  return evaluate(input);
}
