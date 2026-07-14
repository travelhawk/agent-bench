const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(process.cwd(), "index.html");
const cssPath = path.join(process.cwd(), "styles.css");

const REQUIRED_SECTIONS = ["hero", "proof", "features", "pricing", "faq", "cta"];
const REQUIRED_TERMS = ["Fluxa", "weekly snapshot", "status", "ownership"];
const PLACEHOLDERS = ["todo", "lorem ipsum", "coming soon"];
const FORBIDDEN_CLAIMS = ["guaranteed revenue", "soc 2", "autonomous ai"];

// total checks: sections + terms + no-placeholder + no-forbidden + css size + :root + media query
const TOTAL_CHECKS = REQUIRED_SECTIONS.length + REQUIRED_TERMS.length + 5;

function reject(message) {
  console.error(message);
  console.log(`AGENT_BENCH_CHECKS: 0/${TOTAL_CHECKS}`);
  process.exit(1);
}

if (!fs.existsSync(htmlPath) || !fs.existsSync(cssPath)) {
  reject("Expected index.html and styles.css in the workspace root.");
}

const html = fs.readFileSync(htmlPath, "utf8");
const htmlLower = html.toLowerCase();
const css = fs.readFileSync(cssPath, "utf8");

const checks = [
  ...REQUIRED_SECTIONS.map((id) => [`section #${id}`, new RegExp(`id=["']${id}["']`, "i").test(html)]),
  ...REQUIRED_TERMS.map((term) => [`copy mentions "${term}"`, htmlLower.includes(term.toLowerCase())]),
  ["no placeholder copy", !PLACEHOLDERS.some((term) => htmlLower.includes(term))],
  ["no forbidden claims", !FORBIDDEN_CLAIMS.some((term) => htmlLower.includes(term))],
  ["css is a meaningful size", css.length >= 500],
  ["css defines :root tokens", css.includes(":root")]
];
// keep TOTAL_CHECKS in sync: sections + terms + no-placeholder + no-forbidden + size + :root + media
checks.push(["css has a responsive media query", /@media\s*\(/i.test(css)]);

const passed = checks.filter(([, ok]) => ok).length;
console.log(`AGENT_BENCH_CHECKS: ${passed}/${checks.length}`);
checks.filter(([, ok]) => !ok).forEach(([label]) => console.error(`missing: ${label}`));

if (passed < checks.length) {
  process.exit(1);
}

console.log("landing page verifier passed");
