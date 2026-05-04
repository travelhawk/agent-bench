const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../src/app.js");

async function startServer() {
  const app = createApp([
    { name: "Mina", message: "Love the faster search and cleaner layout." }
  ]);
  const server = app.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    app,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

test("GET / returns the landing HTML with the seeded entry", async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Pulse Feedback/);
    assert.match(html, /Love the faster search and cleaner layout\./);
    assert.match(html, /<form/i);
  } finally {
    server.close();
  }
});

test("POST /feedback validates input and stores a new entry", async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        name: "Iris",
        message: "The mobile layout feels much clearer after the refresh."
      })
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/");

    const home = await fetch(`${baseUrl}/`);
    const html = await home.text();
    assert.match(html, /Iris/);
    assert.match(html, /mobile layout feels much clearer/i);
  } finally {
    server.close();
  }
});

test("GET /health returns JSON with the current count", async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      ok: true,
      count: 1
    });
  } finally {
    server.close();
  }
});

test("invalid feedback submission returns 400", async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        name: "A",
        message: "short"
      })
    });

    const text = await response.text();
    assert.equal(response.status, 400);
    assert.match(text, /invalid feedback/i);
  } finally {
    server.close();
  }
});

