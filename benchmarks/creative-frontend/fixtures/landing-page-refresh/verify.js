const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(process.cwd(), "index.html");
const cssPath = path.join(process.cwd(), "styles.css");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(htmlPath) || !fs.existsSync(cssPath)) {
  fail("Expected index.html and styles.css in the workspace root.");
}

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

["hero", "proof", "features", "pricing", "faq", "cta"].forEach((id) => {
  if (!new RegExp(`id=["']${id}["']`, "i").test(html)) {
    fail(`Missing required section with id=${id}.`);
  }
});

["Fluxa", "weekly snapshot", "status", "ownership"].forEach((term) => {
  if (!html.toLowerCase().includes(term.toLowerCase())) {
    fail(`Expected landing page copy to mention "${term}".`);
  }
});

["todo", "lorem ipsum", "coming soon"].forEach((term) => {
  if (html.toLowerCase().includes(term)) {
    fail(`Landing page still contains placeholder copy: ${term}`);
  }
});

["guaranteed revenue", "soc 2", "autonomous ai"].forEach((term) => {
  if (html.toLowerCase().includes(term)) {
    fail(`Landing page includes a forbidden claim: ${term}`);
  }
});

if (css.length < 500) {
  fail("styles.css is too small to represent a meaningful redesign.");
}

if (!css.includes(":root")) {
  fail("styles.css must define design tokens in :root.");
}

if (!/@media\s*\(/i.test(css)) {
  fail("styles.css must include at least one responsive media query.");
}

console.log("landing page verifier passed");
