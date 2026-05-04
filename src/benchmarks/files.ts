import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeSuiteMetadataInput,
  normalizeTaskMetadataInput,
  parseSuiteMetadata,
  parseTaskMetadata,
  suiteMetadataToMarkdown,
  taskMetadataToMarkdown
} from "./metadata";
import { BenchmarkSandboxProvider, BenchmarkSuiteRecord, BenchmarkTaskRecord } from "../types";

const DEFAULT_SANDBOX_TIMEOUT_MS = 120000;
const EMPTY_TASK_TEXT = "";
const EMPTY_TASK_LIST: string[] = [];

const DEFAULT_SUITES: BenchmarkSuiteRecord[] = [
  {
    key: "repo-maintenance",
    title: "Repo Maintenance",
    description: "Fast, deterministic tasks on seeded repositories where agents must either repair a regression or identify a concrete security issue.",
    metadata: {
      resolution: "atomic",
      domain: "software-engineering",
      tags: ["repo", "maintenance", "deterministic"]
    },
    tasks: [
      {
        key: "fix-react-bug",
        title: "Fix React Bug",
        description: "Repair a seeded regression in a tiny React-like component repo and leave the workspace in a passing state.",
        expectedOutcome: "Modify the fixture repository so the failing behavior becomes deterministic and the verifier passes.",
        whyThisTask: "This is the baseline coding regression task. It is cheap to run, easy to compare across agents, and impossible to pass by only describing a fix.",
        inputs: "Use only the copied fixture repository inside the sandbox workspace.",
        deliverableFormat: "Edit the repo in place. The final workspace must satisfy the verifier command without manual follow-up.",
        successChecks: [
          "The runner exits successfully.",
          "The verifier command passes.",
          "The component behavior is deterministic after the fix."
        ],
        failureModes: [
          "The tests still fail.",
          "The patch relies on brittle behavior.",
          "The agent edits files outside the workspace."
        ],
        metadata: {
          resolution: "atomic",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "low",
          reliability: "high",
          tags: ["bugfix", "react", "tests", "repo"],
          requiresIsolation: true,
          requiresNetwork: false,
          timeBudgetMs: 60000,
          costBudgetUsd: 0.6,
          defaultTrials: 1
        },
        sandbox: {
          fixtureDir: "fixtures/fix-react-bug",
          verifyCommand: "node --test tests/*.test.js",
          timeoutMs: 120000
        }
      },
      {
        key: "security-audit-report",
        title: "Security Audit Report",
        description: "Inspect a seeded mini service repo, identify the single highest-severity vulnerability, and write a structured audit finding.",
        expectedOutcome: "Produce `audit-findings.json` in the workspace root with the required finding schema and the correct highest-severity issue.",
        whyThisTask: "This gives you a fast, comparable security task that can be checked deterministically without requiring the agent to fix the code.",
        inputs: "Use only the copied fixture repository. The repo contains one intentionally seeded high-severity issue that should be reported.",
        deliverableFormat: "Write `audit-findings.json` with exactly one finding containing id, severity, file, line, title, evidence, impact, and remediation.",
        successChecks: [
          "The report file exists in the expected path.",
          "The finding matches the seeded vulnerability.",
          "The report does not include extra false-positive findings."
        ],
        failureModes: [
          "The report misses the seeded issue.",
          "The report contains multiple speculative findings.",
          "The JSON schema is malformed."
        ],
        metadata: {
          resolution: "atomic",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "medium",
          reliability: "high",
          tags: ["security", "audit", "report", "repo"],
          requiresIsolation: true,
          requiresNetwork: false,
          timeBudgetMs: 60000,
          costBudgetUsd: 0.75,
          defaultTrials: 1
        },
        sandbox: {
          fixtureDir: "fixtures/security-audit-report",
          verifyCommand: "node verify.js",
          timeoutMs: 120000
        }
      }
    ]
  },
  {
    key: "product-builds",
    title: "Product Builds",
    description: "Small greenfield implementation tasks with deterministic checks for a simple web app and a CLI tool.",
    metadata: {
      resolution: "workflow",
      domain: "product-engineering",
      tags: ["build", "web-app", "cli"]
    },
    tasks: [
      {
        key: "simple-feedback-web-app",
        title: "Simple Feedback Web App",
        description: "Complete a tiny Node web app that serves HTML, accepts feedback submissions, and exposes a health endpoint.",
        expectedOutcome: "Edit the fixture app until the test suite passes and the delivered HTML/HTTP behavior matches the task brief.",
        whyThisTask: "This gives you a real app-building task without the latency and variance of a full framework or browser-heavy stack.",
        inputs: "Use the copied fixture repository only. No external packages are required.",
        deliverableFormat: "Implement the app directly in the workspace and leave it in a passing state for the verifier.",
        successChecks: [
          "The test suite passes.",
          "HTML output includes the required content and form.",
          "POST and health behaviors match the spec."
        ],
        failureModes: [
          "Routes are missing or malformed.",
          "Validation behavior is incorrect.",
          "The app passes one path but breaks another."
        ],
        metadata: {
          resolution: "workflow",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "medium",
          reliability: "high",
          tags: ["web-app", "node", "http", "product"],
          requiresIsolation: true,
          requiresNetwork: false,
          timeBudgetMs: 90000,
          costBudgetUsd: 1,
          defaultTrials: 1
        },
        sandbox: {
          fixtureDir: "fixtures/simple-feedback-web-app",
          verifyCommand: "node --test tests/*.test.js",
          timeoutMs: 120000
        }
      },
      {
        key: "release-notes-cli",
        title: "Release Notes CLI",
        description: "Implement a tiny CLI that reads a JSON change log and prints a deterministic Markdown release summary.",
        expectedOutcome: "Complete the CLI so the seeded tests pass and the output format is stable across runs.",
        whyThisTask: "CLI tasks are cheap, highly comparable, and sensitive to instruction-quality changes without needing a large runtime budget.",
        inputs: "Use the copied fixture repository and the seeded sample input files only.",
        deliverableFormat: "Implement the CLI and supporting helpers in place so the verifier passes.",
        successChecks: [
          "The test suite passes.",
          "Markdown output matches the required structure.",
          "Entries are grouped and ordered exactly as specified."
        ],
        failureModes: [
          "The CLI ignores invalid input handling.",
          "Output structure is unstable or incomplete.",
          "Sorting and grouping rules are wrong."
        ],
        metadata: {
          resolution: "atomic",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "low",
          reliability: "high",
          tags: ["cli", "node", "formatting", "product"],
          requiresIsolation: true,
          requiresNetwork: false,
          timeBudgetMs: 45000,
          costBudgetUsd: 0.4,
          defaultTrials: 1
        },
        sandbox: {
          fixtureDir: "fixtures/release-notes-cli",
          verifyCommand: "node --test tests/*.test.js",
          timeoutMs: 120000
        }
      }
    ]
  },
  {
    key: "creative-frontend",
    title: "Creative Frontend",
    description: "A bounded landing-page task with explicit copy and layout requirements plus lightweight automated checks and easy human review.",
    metadata: {
      resolution: "workflow",
      domain: "frontend-design",
      tags: ["landing-page", "copy", "visual"]
    },
    tasks: [
      {
        key: "landing-page-refresh",
        title: "Landing Page Refresh",
        description: "Turn a flat starter page into a polished landing page for a fictional product using the supplied brand and copy constraints.",
        expectedOutcome: "Produce a visually coherent landing page that satisfies the required sections, uses the supplied positioning, and passes the structural verifier.",
        whyThisTask: "This is the one intentionally subjective task. Humans can compare the page visually, while the verifier and task contract keep the work bounded enough for LLM review and regression tracking.",
        inputs: "Use the copied static-site fixture. The brief defines the audience, product promise, tone, required sections, forbidden claims, and CTA.",
        deliverableFormat: "Edit `index.html` and `styles.css` in place. Leave the workspace ready for manual inspection and the automated verifier.",
        successChecks: [
          "The required sections are present and non-placeholder.",
          "The verifier passes.",
          "The page is visually easy to compare by a human reviewer."
        ],
        failureModes: [
          "Required sections or CTA are missing.",
          "Copy contains forbidden placeholder text or unsupported claims.",
          "The page remains structurally valid but visually unchanged."
        ],
        metadata: {
          resolution: "workflow",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "medium",
          reliability: "medium",
          tags: ["landing-page", "copywriting", "design", "frontend"],
          requiresIsolation: true,
          requiresNetwork: false,
          timeBudgetMs: 90000,
          costBudgetUsd: 0.8,
          defaultTrials: 1
        },
        sandbox: {
          fixtureDir: "fixtures/landing-page-refresh",
          verifyCommand: "node verify.js",
          timeoutMs: 120000
        }
      }
    ]
  }
];

function normalizeKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function suiteDir(benchmarksDir: string, suiteKey: string): string {
  return path.join(benchmarksDir, suiteKey);
}

function suiteMetaPath(benchmarksDir: string, suiteKey: string): string {
  return path.join(suiteDir(benchmarksDir, suiteKey), "benchmark.md");
}

function taskPath(benchmarksDir: string, suiteKey: string, taskKey: string): string {
  return path.join(suiteDir(benchmarksDir, suiteKey), "tasks", `${taskKey}.md`);
}

function parseTaskSandbox(section: string): BenchmarkTaskRecord["sandbox"] {
  if (!section.trim()) return null;

  const lines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const map = new Map<string, string>();

  lines.forEach((line) => {
    const index = line.indexOf(":");
    if (index === -1) return;
    map.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  });

  const timeoutRaw = Number(map.get("timeout ms") ?? DEFAULT_SANDBOX_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.round(timeoutRaw) : DEFAULT_SANDBOX_TIMEOUT_MS;
  const fixtureDirRaw = map.get("fixture dir")?.trim();
  const verifyCommandRaw = map.get("verify command")?.trim();
  const providerRaw = map.get("provider")?.trim().toLowerCase();
  const fixtureDir = fixtureDirRaw && fixtureDirRaw.toLowerCase() !== "none" ? fixtureDirRaw : undefined;
  const verifyCommand = verifyCommandRaw && verifyCommandRaw.toLowerCase() !== "none" ? verifyCommandRaw : undefined;
  const provider = providerRaw && ["auto", "process", "macos-seatbelt", "docker"].includes(providerRaw)
    ? providerRaw as BenchmarkSandboxProvider
    : undefined;

  if (!fixtureDir && !verifyCommand) return null;
  return {
    fixtureDir: fixtureDir || undefined,
    verifyCommand: verifyCommand || undefined,
    provider,
    timeoutMs
  };
}

function sandboxToMarkdown(sandbox: BenchmarkTaskRecord["sandbox"]): string[] {
  if (!sandbox) return [];
  return [
    "## Sandbox",
    `Fixture Dir: ${sandbox.fixtureDir ?? "none"}`,
    `Verify Command: ${sandbox.verifyCommand ?? "none"}`,
    `Provider: ${sandbox.provider ?? "auto"}`,
    `Timeout Ms: ${sandbox.timeoutMs}`,
    ""
  ];
}

function listSectionToMarkdown(heading: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return [
    `## ${heading}`,
    ...items.map((item) => `- ${item}`),
    ""
  ];
}

function textSectionToMarkdown(heading: string, value: string): string[] {
  if (!value.trim()) return [];
  return [
    `## ${heading}`,
    value.trim(),
    ""
  ];
}

function suiteToMarkdown(suite: BenchmarkSuiteRecord): string {
  return [
    `# ${suite.title}`,
    "",
    `Key: ${suite.key}`,
    "",
    "## Description",
    suite.description.trim(),
    "",
    ...suiteMetadataToMarkdown(normalizeSuiteMetadataInput(suite.metadata))
  ].join("\n");
}

function taskToMarkdown(task: BenchmarkTaskRecord): string {
  return [
    `# ${task.title}`,
    "",
    `Key: ${task.key}`,
    "",
    "## Task",
    task.description.trim(),
    "",
    "## Expected Outcome",
    task.expectedOutcome.trim(),
    "",
    ...textSectionToMarkdown("Why This Task", task.whyThisTask),
    ...textSectionToMarkdown("Inputs", task.inputs),
    ...textSectionToMarkdown("Deliverable Format", task.deliverableFormat),
    ...listSectionToMarkdown("Success Checks", task.successChecks),
    ...listSectionToMarkdown("Failure Modes", task.failureModes),
    ...sandboxToMarkdown(task.sandbox),
    ...taskMetadataToMarkdown(normalizeTaskMetadataInput(task.metadata))
  ].join("\n");
}

function extractSection(content: string, heading: string): string {
  const expression = new RegExp(`## ${heading}\\s*([\\s\\S]*?)(?=\\r?\\n##\\s+|\\s*$)`);
  return content.match(expression)?.[1]?.trim() || "";
}

function parseListSection(section: string): string[] {
  if (!section.trim()) return [];
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function parseSuiteMarkdown(content: string, fallbackKey: string): { key: string; title: string; description: string; metadata: BenchmarkSuiteRecord["metadata"] } {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const keyMatch = content.match(/^Key:\s*(.+)$/m);
  const description = extractSection(content, "Description");
  const metadata = parseSuiteMetadata(extractSection(content, "Metadata"));

  return {
    key: normalizeKey(keyMatch?.[1]?.trim() || fallbackKey),
    title: titleMatch?.[1]?.trim() || fallbackKey,
    description,
    metadata
  };
}

function parseTaskMarkdown(content: string, fallbackKey: string): BenchmarkTaskRecord {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const keyMatch = content.match(/^Key:\s*(.+)$/m);
  const description = extractSection(content, "Task");
  const expectedOutcome = extractSection(content, "Expected Outcome");
  const whyThisTask = extractSection(content, "Why This Task");
  const inputs = extractSection(content, "Inputs");
  const deliverableFormat = extractSection(content, "Deliverable Format");
  const successChecks = parseListSection(extractSection(content, "Success Checks"));
  const failureModes = parseListSection(extractSection(content, "Failure Modes"));
  const sandbox = parseTaskSandbox(extractSection(content, "Sandbox"));
  const metadata = parseTaskMetadata(extractSection(content, "Metadata"));

  const key = normalizeKey(keyMatch?.[1]?.trim() || fallbackKey);
  return {
    key,
    title: titleMatch?.[1]?.trim() || key,
    description,
    expectedOutcome,
    whyThisTask,
    inputs,
    deliverableFormat,
    successChecks,
    failureModes,
    metadata,
    sandbox
  };
}

function ensureSuiteFiles(benchmarksDir: string, suite: BenchmarkSuiteRecord): void {
  const baseDir = suiteDir(benchmarksDir, suite.key);
  mkdirSync(path.join(baseDir, "tasks"), { recursive: true });
  if (!existsSync(suiteMetaPath(benchmarksDir, suite.key))) {
    writeFileSync(suiteMetaPath(benchmarksDir, suite.key), suiteToMarkdown(suite), "utf8");
  }
  suite.tasks.forEach((task) => {
    const filePath = taskPath(benchmarksDir, suite.key, task.key);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, taskToMarkdown(task), "utf8");
    }
  });
}

function migrateLegacyFlatBenchmarkFiles(benchmarksDir: string): void {
  const topLevelFiles = readdirSync(benchmarksDir).filter((name) => name.endsWith(".md"));
  if (topLevelFiles.length === 0) return;

  const legacySuiteKey = "legacy-imported";
  const legacySuiteDir = suiteDir(benchmarksDir, legacySuiteKey);
  mkdirSync(path.join(legacySuiteDir, "tasks"), { recursive: true });
  if (!existsSync(suiteMetaPath(benchmarksDir, legacySuiteKey))) {
    writeFileSync(suiteMetaPath(benchmarksDir, legacySuiteKey), suiteToMarkdown({
      key: legacySuiteKey,
      title: "Legacy Imported",
      description: "Auto-imported benchmark tasks from the previous flat benchmark format.",
        metadata: {
          resolution: "atomic",
          domain: "legacy-import",
          tags: ["imported", "legacy"]
        },
      tasks: []
    }), "utf8");
  }

  topLevelFiles.forEach((fileName) => {
    const sourcePath = path.join(benchmarksDir, fileName);
    const taskKey = normalizeKey(fileName.replace(/\.md$/i, ""));
    const targetPath = taskPath(benchmarksDir, legacySuiteKey, taskKey);
    if (!existsSync(targetPath)) {
      renameSync(sourcePath, targetPath);
    }
  });
}

export function ensureBenchmarkFiles(benchmarksDir: string): void {
  mkdirSync(benchmarksDir, { recursive: true });
  migrateLegacyFlatBenchmarkFiles(benchmarksDir);

  const entries = readdirSync(benchmarksDir, { withFileTypes: true });
  const hasSuiteDir = entries.some((entry) => entry.isDirectory());
  if (!hasSuiteDir) {
    DEFAULT_SUITES.forEach((suite) => ensureSuiteFiles(benchmarksDir, suite));
  }
}

export function listBenchmarkSuitesFromFiles(benchmarksDir: string): BenchmarkSuiteRecord[] {
  ensureBenchmarkFiles(benchmarksDir);
  const suiteDirs = readdirSync(benchmarksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return suiteDirs.map((suiteKeyRaw) => {
    const suiteKey = normalizeKey(suiteKeyRaw);
    const metaPath = suiteMetaPath(benchmarksDir, suiteKeyRaw);
    const metaContent = existsSync(metaPath)
      ? readFileSync(metaPath, "utf8")
      : suiteToMarkdown({
        key: suiteKey,
        title: suiteKey,
        description: "",
        metadata: normalizeSuiteMetadataInput(),
        tasks: []
      });
    const parsedSuite = parseSuiteMarkdown(metaContent, suiteKey);
    const tasksDir = path.join(suiteDir(benchmarksDir, suiteKeyRaw), "tasks");
    const tasks = existsSync(tasksDir)
      ? readdirSync(tasksDir)
        .filter((name) => name.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b))
        .map((name) => {
          const filePath = path.join(tasksDir, name);
          const content = readFileSync(filePath, "utf8");
          const fallbackTaskKey = normalizeKey(name.replace(/\.md$/i, ""));
          return parseTaskMarkdown(content, fallbackTaskKey);
        })
      : [];

    return {
      key: parsedSuite.key,
      title: parsedSuite.title,
      description: parsedSuite.description,
      metadata: parsedSuite.metadata,
      tasks
    };
  });
}

export function createBenchmarkSuiteFile(benchmarksDir: string, input: {
  key: string;
  title: string;
  description: string;
  metadata?: Partial<BenchmarkSuiteRecord["metadata"]>;
}): BenchmarkSuiteRecord {
  ensureBenchmarkFiles(benchmarksDir);
  const key = normalizeKey(input.key);
  if (!key) {
    throw new Error("Benchmark key must contain letters or numbers.");
  }
  const baseDir = suiteDir(benchmarksDir, key);
  if (existsSync(baseDir)) {
    throw new Error(`Benchmark key already exists: ${key}`);
  }
  mkdirSync(path.join(baseDir, "tasks"), { recursive: true });
  const suite: BenchmarkSuiteRecord = {
    key,
      title: input.title.trim(),
      description: input.description.trim(),
      metadata: normalizeSuiteMetadataInput(input.metadata),
      tasks: []
  };
  writeFileSync(suiteMetaPath(benchmarksDir, key), suiteToMarkdown(suite), "utf8");
  return suite;
}

export function createBenchmarkTaskFile(benchmarksDir: string, input: {
  benchmarkKey: string;
  key: string;
  title: string;
  description: string;
  expectedOutcome: string;
  whyThisTask?: string;
  inputs?: string;
  deliverableFormat?: string;
  successChecks?: string[];
  failureModes?: string[];
  metadata?: Partial<BenchmarkTaskRecord["metadata"]>;
  sandbox?: BenchmarkTaskRecord["sandbox"];
}): BenchmarkTaskRecord {
  ensureBenchmarkFiles(benchmarksDir);
  const benchmarkKey = normalizeKey(input.benchmarkKey);
  const suiteBase = suiteDir(benchmarksDir, benchmarkKey);
  if (!existsSync(suiteBase)) {
    throw new Error(`Benchmark does not exist: ${benchmarkKey}`);
  }

  const key = normalizeKey(input.key);
  if (!key) {
    throw new Error("Task key must contain letters or numbers.");
  }

  const filePath = taskPath(benchmarksDir, benchmarkKey, key);
  if (existsSync(filePath)) {
    throw new Error(`Task key already exists in benchmark ${benchmarkKey}: ${key}`);
  }

  const task: BenchmarkTaskRecord = {
    key,
    title: input.title.trim(),
    description: input.description.trim(),
    expectedOutcome: input.expectedOutcome.trim(),
    whyThisTask: input.whyThisTask?.trim() ?? EMPTY_TASK_TEXT,
    inputs: input.inputs?.trim() ?? EMPTY_TASK_TEXT,
    deliverableFormat: input.deliverableFormat?.trim() ?? EMPTY_TASK_TEXT,
    successChecks: input.successChecks?.map((entry) => entry.trim()).filter(Boolean) ?? EMPTY_TASK_LIST,
    failureModes: input.failureModes?.map((entry) => entry.trim()).filter(Boolean) ?? EMPTY_TASK_LIST,
    metadata: normalizeTaskMetadataInput(input.metadata),
    sandbox: input.sandbox ?? null
  };
  writeFileSync(filePath, taskToMarkdown(task), "utf8");
  return task;
}
