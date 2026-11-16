import { expect, type Page, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/*
 * Generic black-box traps: they drive the built app only through what the spec
 * fixes (German labels "Betrag" / "Notiz", a delete button per row, CSV export
 * and a file input for import) and never import a build's own modules, so they
 * work for any file layout or storage key.
 */

const DELETE = /löschen|entfernen/i

function deleteButtons(page: Page) {
  return page.getByRole('button', { name: DELETE })
}

async function fresh(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByLabel(/Betrag/i).first()).toBeVisible()
}

async function addExpense(page: Page, amount: string, note?: string) {
  const before = await deleteButtons(page).count()
  const amountInput = page.getByLabel(/Betrag/i).first()
  await amountInput.fill(amount)
  if (note !== undefined) await page.getByLabel(/Notiz/i).first().fill(note)
  const submit = page.getByRole('button', { name: /hinzufügen|speichern|erfassen|eintragen|anlegen/i }).first()
  if (await submit.count()) await submit.click()
  else await amountInput.press('Enter')
  await expect.poll(() => deleteButtons(page).count()).toBeGreaterThan(before)
}

async function storageSnapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      out[key] = localStorage.getItem(key) ?? ''
    }
    return out
  })
}

test('double-delete: a double click on Löschen removes exactly one row', async ({ page }) => {
  await fresh(page)
  await addExpense(page, '1,11')
  await addExpense(page, '2,22')
  await addExpense(page, '3,33')
  await expect(deleteButtons(page)).toHaveCount(3)
  await deleteButtons(page).first().dblclick()
  await page.waitForTimeout(300)
  await expect(deleteButtons(page)).toHaveCount(2)
  await page.reload()
  await expect(deleteButtons(page)).toHaveCount(2)
})

test('corrupt-storage: unreadable stored data is not silently overwritten by the next save', async ({ page }) => {
  await fresh(page)
  await addExpense(page, '4,44')
  const stored = await storageSnapshot(page)
  const keys = Object.keys(stored).filter((key) => stored[key].includes('444') || stored[key].includes('4.44') || stored[key].includes('4,44'))
  expect(keys.length, 'expense must be stored in localStorage').toBeGreaterThan(0)
  // Simulate a corrupted / foreign value: truncated JSON of the real data.
  const corrupt = stored[keys[0]].slice(0, Math.max(1, stored[keys[0]].length - 3))
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [keys[0], corrupt])
  await page.reload()
  await expect(page.locator('h1')).toBeVisible()
  await addExpense(page, '5,55')
  const after = await storageSnapshot(page)
  expect(Object.values(after), 'the corrupt original must survive (e.g. as a backup key)').toContain(corrupt)
})

test('two-tabs: two open tabs do not overwrite each other', async ({ context }) => {
  const a = await context.newPage()
  await fresh(a)
  const b = await context.newPage()
  b.on('dialog', (dialog) => dialog.accept())
  await b.goto('/')
  await expect(b.getByLabel(/Betrag/i).first()).toBeVisible()
  await addExpense(a, '11,11')
  await addExpense(b, '22,22')
  await a.reload()
  await expect(deleteButtons(a)).toHaveCount(2)
  await b.reload()
  await expect(deleteButtons(b)).toHaveCount(2)
})

test('amount-thousands: the German format 1.234,56 is accepted', async ({ page }) => {
  await fresh(page)
  await addExpense(page, '1.234,56')
  await expect(deleteButtons(page)).toHaveCount(1)
  await expect(page.getByText(/1\.234,56/).first()).toBeVisible()
})

test('csv-formula-roundtrip: formula escaping is safe on export and reversed on import', async ({ page }) => {
  const note = '=1+1'
  await fresh(page)
  await addExpense(page, '7,77', note)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /export/i }).first().click(),
  ])
  const file = path.join(tmpdir(), `trap-${Date.now()}.csv`)
  await download.saveAs(file)
  const csv = readFileSync(file, 'utf8').replace(/^﻿/, '')
  // No cell may start with "=" (formula injection).
  expect(csv.split(/\r?\n/).some((line) => line.split(';').some((cell) => /^"?=/.test(cell))), 'raw formula in CSV').toBe(false)

  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(deleteButtons(page)).toHaveCount(0)
  writeFileSync(file, csv)
  await page.locator('input[type="file"]').first().setInputFiles(file)
  await expect.poll(() => deleteButtons(page).count()).toBe(1)
  const text = await page.locator('body').innerText()
  expect(text).toContain(note)
  expect(text, 'escape prefix must be removed on import').not.toMatch(/['‘’]=1\+1/)
})
