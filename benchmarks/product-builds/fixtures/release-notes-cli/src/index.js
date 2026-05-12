const fs = require("node:fs");
const path = require("node:path");

const ORDER = ["added", "fixed", "docs", "removed"];
const LABELS = {
  added: "Added",
  fixed: "Fixed",
  docs: "Docs",
  removed: "Removed"
};

function groupChanges(changes) {
  void changes;
  return {};
}

function renderReleaseNotes(data) {
  void data;
  return "TODO";
}

function main(argv = process.argv.slice(2)) {
  const inputPath = argv[0];
  if (!inputPath) {
    console.error("Usage: node src/index.js <changes.json>");
    return 1;
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  process.stdout.write(`${renderReleaseNotes(payload)}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  ORDER,
  LABELS,
  groupChanges,
  renderReleaseNotes,
  main
};

