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
    key: "core-engineering",
    title: "Core Engineering",
    description: "Baseline suite for deterministic coding, debugging, and API design tasks.",
    metadata: {
      resolution: "atomic",
      domain: "software-engineering",
      tags: ["coding", "deterministic", "regression"]
    },
    tasks: [
      {
        key: "design-rest-api",
        title: "Design REST API",
        description: "Design a deterministic REST API for a support ticket service using the provided entity model and policy constraints.",
        expectedOutcome: "Deliver a complete API proposal with routes, schemas, validation rules, idempotency behavior, and error handling aligned to the supplied constraints.",
        whyThisTask: "This checks whether an agent can turn a bounded product brief into a production-credible contract instead of returning generic CRUD boilerplate.",
        inputs: "Use the task brief as the fixed input set: tickets, comments, assignees, SLA policy, and audit-log requirements. Do not invent extra resources unless you justify them explicitly.",
        deliverableFormat: "Return sections for Endpoints, Request Schemas, Response Schemas, Validation Rules, Error Model, and Open Questions.",
        successChecks: [
          "Every endpoint is tied to the provided entities and workflows.",
          "Schemas define required fields, identifiers, and validation behavior.",
          "Error handling covers auth, validation, missing resources, and conflicts."
        ],
        failureModes: [
          "Generic CRUD routes that ignore workflow constraints.",
          "Missing schema details or error behavior.",
          "Invented features that were not motivated by the brief."
        ],
        metadata: {
          resolution: "atomic",
          interaction: "artifact",
          evaluator: "artifact",
          difficulty: "medium",
          tags: ["api", "schemas", "contracts"],
          requiresIsolation: true,
          requiresNetwork: false
        },
        sandbox: null
      },
      {
        key: "fix-react-bug",
        title: "Fix React Bug",
        description: "Repair a failing React component behavior in an isolated repo.",
        expectedOutcome: "Return a patch and tests that make the component deterministic and pass all checks.",
        whyThisTask: "This is the baseline deterministic engineering task. It should distinguish agents that can edit code safely from agents that only describe a fix.",
        inputs: "Use only the fixture repository copied into the sandbox workspace.",
        deliverableFormat: "Modify the fixture code and leave the workspace in a passing state for the verifier command.",
        successChecks: [
          "The runner exits successfully.",
          "The verifier command passes.",
          "The resulting component behavior is deterministic."
        ],
        failureModes: [
          "The code still fails tests.",
          "The fix relies on brittle behavior or leaves the repo inconsistent.",
          "The runner edits files outside the allowed workspace."
        ],
        metadata: {
          resolution: "atomic",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "medium",
          tags: ["react", "bugfix", "tests"],
          requiresIsolation: true,
          requiresNetwork: false
        },
        sandbox: {
          fixtureDir: "fixtures/fix-react-bug",
          verifyCommand: "node --test \"tests/*.test.js\"",
          timeoutMs: 120000
        }
      },
      {
        key: "logic-puzzle",
        title: "Logic Puzzle",
        description: "Solve a deterministic reasoning benchmark with traceable steps.",
        expectedOutcome: "Produce the final answer with concise rationale and internally consistent steps.",
        whyThisTask: "This keeps a low-cost review-only task in the suite for quick reasoning checks when no sandbox is needed.",
        inputs: "Use only the prompt content in the task brief.",
        deliverableFormat: "Return the final answer first, then a short rationale that is internally consistent.",
        successChecks: [
          "The final answer is explicit.",
          "The rationale does not contradict the answer."
        ],
        failureModes: [
          "Ambiguous or missing final answer.",
          "Reasoning contradicts the stated conclusion.",
          "Overly long response that obscures the answer."
        ],
        metadata: {
          resolution: "atomic",
          interaction: "artifact",
          evaluator: "judge",
          difficulty: "low",
          tags: ["reasoning", "consistency"],
          requiresIsolation: false,
          requiresNetwork: false
        },
        sandbox: null
      },
      {
        key: "sql-refactor",
        title: "SQL Refactor",
        description: "Refactor a flawed reporting query against a fixed schema so it becomes correct, maintainable, and measurably cheaper to execute.",
        expectedOutcome: "Return corrected SQL, explain the correctness fix, and describe the expected performance improvements against the supplied query shape.",
        whyThisTask: "This checks whether the agent can reason about correctness and query design instead of only rewriting syntax.",
        inputs: "Use the fixed schema, broken query, and performance symptoms provided in the task brief.",
        deliverableFormat: "Return sections for Corrected Query, Correctness Notes, Performance Notes, and Validation Plan.",
        successChecks: [
          "The corrected query addresses the stated bug.",
          "The explanation names at least one concrete performance improvement.",
          "The output references the supplied schema and constraints."
        ],
        failureModes: [
          "Returns SQL without explaining why it is correct.",
          "Optimizes the query while changing the requested semantics.",
          "Uses unsupported tables or columns."
        ],
        metadata: {
          resolution: "atomic",
          interaction: "artifact",
          evaluator: "artifact",
          difficulty: "medium",
          tags: ["sql", "optimization", "correctness"],
          requiresIsolation: true,
          requiresNetwork: false
        },
        sandbox: null
      }
    ]
  },
  {
    key: "agentic-workflows",
    title: "Agentic Workflows",
    description: "Higher-resolution suites for multi-step workflows, long-horizon operations, and multi-agent handoff patterns.",
    metadata: {
      resolution: "campaign",
      domain: "agent-operations",
      tags: ["workflow", "orchestration", "multi-agent"]
    },
    tasks: [
      {
        key: "research-synthesis-loop",
        title: "Research Synthesis Loop",
        description: "Collect evidence across multiple sources, reconcile conflicts, and deliver a concise research brief with citations and open questions.",
        expectedOutcome: "Return a source-backed brief, a compact evidence table, and explicit uncertainty notes for anything unresolved.",
        whyThisTask: "This evaluates whether the agent can synthesize evidence instead of dumping search results.",
        inputs: "Use at least three current external sources, include publication or access dates, and explicitly reconcile conflicting claims.",
        deliverableFormat: "Return sections for Executive Brief, Evidence Table, Conflicts, Open Questions, and Sources.",
        successChecks: [
          "At least three sources are cited.",
          "Conflicting evidence is reconciled or left explicitly unresolved.",
          "The output includes a compact evidence table."
        ],
        failureModes: [
          "Uncited factual claims.",
          "No conflict handling.",
          "Source list without synthesis."
        ],
        metadata: {
          resolution: "workflow",
          interaction: "tool-use",
          evaluator: "trace",
          difficulty: "medium",
          tags: ["research", "synthesis", "citations"],
          requiresIsolation: false,
          requiresNetwork: true
        },
        sandbox: null
      },
      {
        key: "release-war-room",
        title: "Release War Room",
        description: "Run a bounded release triage using the supplied failing checks, deployment notes, and rollback policy to decide whether the release should ship.",
        expectedOutcome: "Return a release decision record with evidence, blocking issues, remediation plan, and rollback guidance that matches the provided constraints.",
        whyThisTask: "This checks long-horizon operational reasoning under explicit ship-or-hold pressure.",
        inputs: "Use the fixed release notes, failing checks, risk policy, and ownership roster supplied in the task brief.",
        deliverableFormat: "Return sections for Decision, Evidence, Blocking Issues, Immediate Actions, Rollback Plan, and Follow-up Owners.",
        successChecks: [
          "The decision is explicit: ship, hold, or rollback.",
          "Evidence cites the supplied checks and policies.",
          "Rollback or follow-up steps are concrete and assigned."
        ],
        failureModes: [
          "No explicit release decision.",
          "Advice that ignores the stated risk policy.",
          "No rollback path when the release should not continue."
        ],
        metadata: {
          resolution: "campaign",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "high",
          tags: ["release", "debugging", "handoff"],
          requiresIsolation: true,
          requiresNetwork: false
        },
        sandbox: null
      },
      {
        key: "superagent-handoff-mesh",
        title: "Superagent Handoff Mesh",
        description: "Coordinate multiple specialist roles against a fixed project brief, merge their outputs, and resolve contradictory recommendations into one coherent result.",
        expectedOutcome: "Return the merged deliverable, role-by-role handoff notes, explicit conflict resolution, and remaining risks.",
        whyThisTask: "This tests whether the agent can structure delegation and synthesis rather than merely mentioning collaboration.",
        inputs: "Use the fixed project brief, specialist responsibilities, and conflicting sub-findings provided in the task brief.",
        deliverableFormat: "Return sections for Final Deliverable, Specialist Outputs, Conflict Resolution, Remaining Risks, and Handoff Notes.",
        successChecks: [
          "Each specialist role has a bounded responsibility.",
          "Conflicts are resolved explicitly.",
          "The merged output is coherent and does not contradict sub-results."
        ],
        failureModes: [
          "Mentions multiple agents without clear handoffs.",
          "Leaves conflicts unresolved.",
          "Final output contradicts one or more specialist summaries."
        ],
        metadata: {
          resolution: "swarm",
          interaction: "multi-agent",
          evaluator: "trace",
          difficulty: "high",
          tags: ["multi-agent", "delegation", "orchestration"],
          requiresIsolation: true,
          requiresNetwork: false
        },
        sandbox: null
      }
    ]
  },
  {
    key: "interaction-surfaces",
    title: "Interaction Surfaces",
    description: "Cross-surface tasks for browser, computer-use, and mixed-tool workflows where the environment matters as much as the final answer.",
    metadata: {
      resolution: "workflow",
      domain: "operator-systems",
      tags: ["browser", "computer-use", "tooling"]
    },
    tasks: [
      {
        key: "browser-support-escalation",
        title: "Browser Support Escalation",
        description: "Work through a browser-based support console, collect state from multiple screens, update the case, and leave a concise operator note.",
        expectedOutcome: "Return the final case decision, the updated fields, and the note text that explains the escalation outcome.",
        whyThisTask: "This verifies a real browser workflow where state collection and final operator notes both matter.",
        inputs: "Use the seeded browser fixture exactly as loaded by the runner.",
        deliverableFormat: "Update the case through the browser flow and write the expected result artifact for the verifier.",
        successChecks: [
          "The runner completes the browser workflow.",
          "The verifier passes.",
          "The final artifact contains the case decision, field updates, and note text."
        ],
        failureModes: [
          "Incomplete browser traversal.",
          "Missing or malformed result artifact.",
          "Case note does not justify the escalation outcome."
        ],
        metadata: {
          resolution: "workflow",
          interaction: "browser",
          evaluator: "trace",
          difficulty: "medium",
          tags: ["browser", "forms", "state"],
          requiresIsolation: true,
          requiresNetwork: false
        },
        sandbox: {
          fixtureDir: "fixtures/browser-support-escalation",
          verifyCommand: "node verify.js",
          provider: "process",
          timeoutMs: 120000
        }
      },
      {
        key: "computer-use-incident-drill",
        title: "Computer Use Incident Drill",
        description: "Triage a noisy incident from a desktop-style environment, gather evidence from multiple tools, and publish a recovery plan under time pressure.",
        expectedOutcome: "Return the incident decision, the evidence captured from each tool, and a recovery plan with explicit next actions.",
        whyThisTask: "This tests multi-surface evidence gathering and operational decision making under pressure.",
        inputs: "Use the seeded desktop fixture with alerts, terminal output, ticket text, and runbook notes.",
        deliverableFormat: "Produce the expected incident-plan artifact with a decision, evidence, and ordered recovery actions.",
        successChecks: [
          "The runner captures evidence from the provided surfaces.",
          "The verifier passes.",
          "The plan includes explicit next actions."
        ],
        failureModes: [
          "Ignores one or more evidence sources.",
          "Missing incident artifact.",
          "Recovery plan is vague or unordered."
        ],
        metadata: {
          resolution: "campaign",
          interaction: "computer-use",
          evaluator: "trace",
          difficulty: "high",
          tags: ["computer-use", "incident-response", "recovery"],
          requiresIsolation: true,
          requiresNetwork: false
        },
        sandbox: {
          fixtureDir: "fixtures/computer-use-incident-drill",
          verifyCommand: "node verify.js",
          timeoutMs: 120000
        }
      },
      {
        key: "tool-router-triage",
        title: "Tool Router Triage",
        description: "Route a bounded operational request across multiple internal tools using the supplied tool catalog, escalation rules, and target outcome.",
        expectedOutcome: "Return the routing plan, tool-by-tool execution sequence, decision rationale, and final completion summary.",
        whyThisTask: "This checks whether the agent can choose tools intentionally instead of spraying calls across every available surface.",
        inputs: "Use the fixed tool catalog, request brief, and escalation rules from the task brief.",
        deliverableFormat: "Return sections for Routing Decision, Step Sequence, Tool Justification, Risks, and Final Summary.",
        successChecks: [
          "The selected tools are justified against the request.",
          "The sequence is ordered and plausible.",
          "Risks or escalation boundaries are called out."
        ],
        failureModes: [
          "Uses tools without justification.",
          "No ordered execution path.",
          "Ignores escalation boundaries."
        ],
        metadata: {
          resolution: "workflow",
          interaction: "tool-use",
          evaluator: "hybrid",
          difficulty: "medium",
          tags: ["triage", "tool-routing", "ops"],
          requiresIsolation: true,
          requiresNetwork: false
        },
        sandbox: null
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
