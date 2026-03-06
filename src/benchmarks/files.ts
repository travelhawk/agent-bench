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
import { BenchmarkSuiteRecord, BenchmarkTaskRecord } from "../types";

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
        description: "Produce routes and contracts for a small API specification task.",
        expectedOutcome: "Deliver endpoint list, request/response schemas, and error model.",
        metadata: {
          resolution: "atomic",
          interaction: "artifact",
          evaluator: "artifact",
          difficulty: "medium",
          tags: ["api", "schemas", "contracts"],
          requiresIsolation: true,
          requiresNetwork: false
        }
      },
      {
        key: "fix-react-bug",
        title: "Fix React Bug",
        description: "Repair a failing React component behavior in an isolated repo.",
        expectedOutcome: "Return a patch and tests that make the component deterministic and pass all checks.",
        metadata: {
          resolution: "atomic",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "medium",
          tags: ["react", "bugfix", "tests"],
          requiresIsolation: true,
          requiresNetwork: false
        }
      },
      {
        key: "logic-puzzle",
        title: "Logic Puzzle",
        description: "Solve a deterministic reasoning benchmark with traceable steps.",
        expectedOutcome: "Produce the final answer with concise rationale and internally consistent steps.",
        metadata: {
          resolution: "atomic",
          interaction: "artifact",
          evaluator: "judge",
          difficulty: "low",
          tags: ["reasoning", "consistency"],
          requiresIsolation: false,
          requiresNetwork: false
        }
      },
      {
        key: "sql-refactor",
        title: "SQL Refactor",
        description: "Improve correctness and performance of an existing SQL query.",
        expectedOutcome: "Return corrected SQL plus rationale and measurable performance improvements.",
        metadata: {
          resolution: "atomic",
          interaction: "artifact",
          evaluator: "artifact",
          difficulty: "medium",
          tags: ["sql", "optimization", "correctness"],
          requiresIsolation: true,
          requiresNetwork: false
        }
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
        metadata: {
          resolution: "workflow",
          interaction: "tool-use",
          evaluator: "trace",
          difficulty: "medium",
          tags: ["research", "synthesis", "citations"],
          requiresIsolation: false,
          requiresNetwork: true
        }
      },
      {
        key: "release-war-room",
        title: "Release War Room",
        description: "Drive a staged release workflow: assess failures, propose fixes, run checks, and produce a release decision with rollback notes.",
        expectedOutcome: "Return the decision record, evidence from checks, and a rollback or follow-up plan when the release should not proceed.",
        metadata: {
          resolution: "campaign",
          interaction: "terminal",
          evaluator: "hybrid",
          difficulty: "high",
          tags: ["release", "debugging", "handoff"],
          requiresIsolation: true,
          requiresNetwork: false
        }
      },
      {
        key: "superagent-handoff-mesh",
        title: "Superagent Handoff Mesh",
        description: "Coordinate multiple specialist roles to split a large task, merge their outputs, resolve conflicts, and publish one coherent result with delegation notes.",
        expectedOutcome: "Return the merged deliverable, a role-by-role handoff summary, and explicit conflict resolution notes for any contradictory sub-results.",
        metadata: {
          resolution: "swarm",
          interaction: "multi-agent",
          evaluator: "trace",
          difficulty: "high",
          tags: ["multi-agent", "delegation", "orchestration"],
          requiresIsolation: true,
          requiresNetwork: false
        }
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
        metadata: {
          resolution: "workflow",
          interaction: "browser",
          evaluator: "trace",
          difficulty: "medium",
          tags: ["browser", "forms", "state"],
          requiresIsolation: true,
          requiresNetwork: true
        }
      },
      {
        key: "computer-use-incident-drill",
        title: "Computer Use Incident Drill",
        description: "Triage a noisy incident from a desktop-style environment, gather evidence from multiple tools, and publish a recovery plan under time pressure.",
        expectedOutcome: "Return the incident decision, the evidence captured from each tool, and a recovery plan with explicit next actions.",
        metadata: {
          resolution: "campaign",
          interaction: "computer-use",
          evaluator: "trace",
          difficulty: "high",
          tags: ["computer-use", "incident-response", "recovery"],
          requiresIsolation: true,
          requiresNetwork: false
        }
      },
      {
        key: "tool-router-triage",
        title: "Tool Router Triage",
        description: "Choose between multiple internal tools, route the work to the right surface, and justify why each tool call was necessary.",
        expectedOutcome: "Return the routed plan, the tool-by-tool execution log, and a final summary of why the chosen path was correct.",
        metadata: {
          resolution: "workflow",
          interaction: "tool-use",
          evaluator: "hybrid",
          difficulty: "medium",
          tags: ["triage", "tool-routing", "ops"],
          requiresIsolation: true,
          requiresNetwork: false
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
    ...taskMetadataToMarkdown(normalizeTaskMetadataInput(task.metadata))
  ].join("\n");
}

function extractSection(content: string, heading: string): string {
  const expression = new RegExp(`## ${heading}\\s*([\\s\\S]*?)(?=\\r?\\n##\\s+|\\s*$)`);
  return content.match(expression)?.[1]?.trim() || "";
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
  const metadata = parseTaskMetadata(extractSection(content, "Metadata"));

  const key = normalizeKey(keyMatch?.[1]?.trim() || fallbackKey);
  return {
    key,
    title: titleMatch?.[1]?.trim() || key,
    description,
    expectedOutcome,
    metadata
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
  metadata?: Partial<BenchmarkTaskRecord["metadata"]>;
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
    metadata: normalizeTaskMetadataInput(input.metadata)
  };
  writeFileSync(filePath, taskToMarkdown(task), "utf8");
  return task;
}
