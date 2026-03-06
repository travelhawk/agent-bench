const test = require("node:test");
const assert = require("node:assert/strict");
const { incrementByTwo } = require("../Counter");

test("incrementByTwo adds two in one step", () => {
  assert.equal(incrementByTwo(0), 2);
  assert.equal(incrementByTwo(2), 4);
});
