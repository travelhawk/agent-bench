import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BenchmarkSuiteRecord, BenchmarkTaskRecord } from "../types";

const DEFAULT_SUITES: BenchmarkSuiteRecord[] = [
  {
    key: "core-engineering",
    title: "Core Engineering",
    description: "Baseline suite for deterministic coding, debugging, and API design tasks.",
    tasks: [
      {
        key: "fix-react-bug",
        title: "Fix React Bug",
        description: "Repair a failing React component behavior in an isolated repo.",
        expectedOutcome: "Return a patch and tests that make the component deterministic and pass all checks."
      },
      {
        key: "sql-refactor",
        title: "SQL Refactor",
        description: "Improve correctness and performance of an existing SQL query.",
        expectedOutcome: "Return corrected SQL plus rationale and measurable performance improvements."
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
    ""
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
    ""
  ].join("\n");
}

function parseSuiteMarkdown(content: string, fallbackKey: string): { key: string; title: string; description: string } {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const keyMatch = content.match(/^Key:\s*(.+)$/m);
  const descriptionMatch = content.match(/## Description\s*([\s\S]*)$/m);

  return {
    key: normalizeKey(keyMatch?.[1]?.trim() || fallbackKey),
    title: titleMatch?.[1]?.trim() || fallbackKey,
    description: descriptionMatch?.[1]?.trim() || ""
  };
}

function parseTaskMarkdown(content: string, fallbackKey: string): BenchmarkTaskRecord {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const keyMatch = content.match(/^Key:\s*(.+)$/m);
  const taskMatch = content.match(/## Task\s*([\s\S]*?)\s*## Expected Outcome/m);
  const outcomeMatch = content.match(/## Expected Outcome\s*([\s\S]*)$/m);

  const key = normalizeKey(keyMatch?.[1]?.trim() || fallbackKey);
  return {
    key,
    title: titleMatch?.[1]?.trim() || key,
    description: taskMatch?.[1]?.trim() || "",
    expectedOutcome: outcomeMatch?.[1]?.trim() || ""
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
      : suiteToMarkdown({ key: suiteKey, title: suiteKey, description: "", tasks: [] });
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
      tasks
    };
  });
}

export function createBenchmarkSuiteFile(benchmarksDir: string, input: {
  key: string;
  title: string;
  description: string;
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
    expectedOutcome: input.expectedOutcome.trim()
  };
  writeFileSync(filePath, taskToMarkdown(task), "utf8");
  return task;
}
