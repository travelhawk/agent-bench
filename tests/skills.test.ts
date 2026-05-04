import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createManagedAgentBundle } from "../src/agents/bundles";
import { parseSkillsSearchOutput } from "../src/agents/skills";

test("parseSkillsSearchOutput extracts skills.sh search results", () => {
  const output = [
    "Install with npx skills add <owner/repo@skill>",
    "",
    "vercel-labs/agent-skills@web-design-guidelines 12.4K installs",
    "└ https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
    "",
    "github/awesome-copilot@typescript-mcp-server-generator 9.6K installs",
    "└ https://skills.sh/github/awesome-copilot/typescript-mcp-server-generator"
  ].join("\n");

  const results = parseSkillsSearchOutput(output);

  assert.deepEqual(results, [
    {
      source: "vercel-labs/agent-skills",
      skillName: "web-design-guidelines",
      installSpec: "vercel-labs/agent-skills@web-design-guidelines",
      registryUrl: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
      installs: 12400,
      title: "web-design-guidelines"
    },
    {
      source: "github/awesome-copilot",
      skillName: "typescript-mcp-server-generator",
      installSpec: "github/awesome-copilot@typescript-mcp-server-generator",
      registryUrl: "https://skills.sh/github/awesome-copilot/typescript-mcp-server-generator",
      installs: 9600,
      title: "typescript-mcp-server-generator"
    }
  ]);
});

test("createManagedAgentBundle builds a managed bundle with uploaded files and installed skills", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-managed-"));

  try {
    const baseAgentDir = path.join(workspace, "agents", "sandbox-agent");
    mkdirSync(baseAgentDir, { recursive: true });
    writeFileSync(path.join(baseAgentDir, "agent.md"), "# Sandbox Agent\nRunner: node ./runner.js\n");
    writeFileSync(path.join(baseAgentDir, "runner.js"), "console.log('runner');\n");

    const agent = createManagedAgentBundle(workspace, {
      name: "Workflow System",
      baseAgentPath: "./agents/sandbox-agent/agent.md",
      files: [
        {
          path: ".agents/workflows/review.md",
          content: "# Review Workflow\nFollow the review path.\n"
        }
      ],
      skills: [
        {
          source: "vercel-labs/agent-skills",
          skillName: "web-design-guidelines",
          registryUrl: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
          installs: 12000,
          title: "web-design-guidelines"
        }
      ]
    }, {
      installSkills: (bundleRoot, skills) => {
        const skillDir = path.join(bundleRoot, ".agents", "skills", skills[0].skillName);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(path.join(skillDir, "SKILL.md"), "# Web Design Guidelines\n");
        return [{
          source: skills[0].source,
          skillName: skills[0].skillName,
          installSpec: `${skills[0].source}@${skills[0].skillName}`,
          registryUrl: skills[0].registryUrl,
          installs: skills[0].installs,
          title: skills[0].title,
          origin: "skills.sh"
        }];
      }
    });

    const bundleRoot = path.resolve(workspace, path.dirname(agent.path));

    assert.equal(agent.source, "managed");
    assert.equal(agent.system.bundleMode, "bundle");
    assert.equal(agent.system.skillCount, 1);
    assert.ok(agent.system.assetFileCount >= 3);
    assert.ok(existsSync(path.join(bundleRoot, "runner.js")));
    assert.ok(existsSync(path.join(bundleRoot, ".agents", "workflows", "review.md")));
    assert.ok(existsSync(path.join(bundleRoot, ".agents", "skills", "web-design-guidelines", "SKILL.md")));

    const manifest = JSON.parse(readFileSync(path.join(bundleRoot, "agent-bench.bundle.json"), "utf8")) as {
      entryFile?: string;
      skills?: Array<{ installSpec?: string }>;
    };
    assert.equal(manifest.entryFile, "agent.md");
    assert.equal(manifest.skills?.[0]?.installSpec, "vercel-labs/agent-skills@web-design-guidelines");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
