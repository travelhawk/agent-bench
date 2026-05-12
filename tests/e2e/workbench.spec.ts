import { expect, test } from "playwright/test";

test("core workbench UI flows render and navigate", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Agent Test Lab" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Load Agents" })).toBeVisible();

  const runMode = page.getByRole("combobox", { name: "Run mode" });
  const challenge = page.getByRole("combobox", { name: "Challenge" });

  await expect(runMode).toHaveValue("benchmark-cycle");
  await expect(challenge).toBeDisabled();

  await runMode.selectOption("single-task");
  await expect(challenge).toBeEnabled();

  await expect(page.getByRole("button", { name: "Run selected agents" })).toBeVisible();

  await page.getByRole("button", { name: "Run History" }).click();
  await expect(page.getByRole("heading", { name: "Run History" })).toBeVisible();

  await page.getByRole("button", { name: "Benchmark Library" }).click();
  await expect(page.getByRole("heading", { name: "Benchmark Library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add benchmark" })).toBeVisible();

  await page.getByRole("button", { name: "Test Lab" }).click();
  await expect(page.getByRole("heading", { name: "Launch Batch" })).toBeVisible();
});
