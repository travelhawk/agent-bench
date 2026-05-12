import assert from "node:assert/strict";
import test from "node:test";
import { readJsonBody } from "../app/api/_helpers";

test("readJsonBody rejects non-json content types", async () => {
  const request = new Request("http://localhost/api/run", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}"
  });

  await assert.rejects(() => readJsonBody(request), /request body must be json/i);
});

test("readJsonBody rejects invalid json payloads", async () => {
  const request = new Request("http://localhost/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  });

  await assert.rejects(() => readJsonBody(request), /invalid json body/i);
});

test("readJsonBody rejects json arrays", async () => {
  const request = new Request("http://localhost/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[]"
  });

  await assert.rejects(() => readJsonBody(request), /json object/i);
});
