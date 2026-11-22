import test from "node:test";
import assert from "node:assert/strict";
import { checkNodeVersion, DoctorCheck, summarizeDoctorChecks } from "../src/server/doctor";

test("checkNodeVersion fails below the node:sqlite cutoff", () => {
  const check = checkNodeVersion("v22.4.1");
  assert.equal(check.status, "fail");
  assert.match(check.fix ?? "", /22\.13/);
});

/**
 * node:sqlite exists from 22.5.0 but needed `--experimental-sqlite` until
 * 22.13.0, so the store cannot be opened on 22.5 to 22.12 either. The floor
 * used to be 22.5, which would have published a supported range the CLI cannot
 * start in.
 */
test("checkNodeVersion fails while node:sqlite still needed a flag", () => {
  assert.equal(checkNodeVersion("v22.5.0").status, "fail");
  assert.equal(checkNodeVersion("v22.12.0").status, "fail");
});

test("checkNodeVersion warns while node:sqlite is experimental", () => {
  assert.equal(checkNodeVersion("v22.13.0").status, "warn");
  assert.equal(checkNodeVersion("v23.1.0").status, "warn");
});

test("checkNodeVersion passes on Node 24 and newer", () => {
  assert.equal(checkNodeVersion("v24.0.0").status, "pass");
  assert.equal(checkNodeVersion("v26.2.0").status, "pass");
});

function check(status: DoctorCheck["status"]): DoctorCheck {
  return { name: status, status, detail: status };
}

test("summarizeDoctorChecks only blocks on a fail", () => {
  assert.equal(summarizeDoctorChecks([check("pass"), check("pass")]).ok, true);
  // A missing gateway key is a warning, so the tool stays usable without one.
  assert.equal(summarizeDoctorChecks([check("pass"), check("warn")]).ok, true);
  assert.equal(summarizeDoctorChecks([check("warn"), check("fail")]).ok, false);
});

test("summarizeDoctorChecks counts warnings and names the next command", () => {
  const clean = summarizeDoctorChecks([check("pass")]);
  assert.match(clean.summary, /compare-models/);

  const warned = summarizeDoctorChecks([check("warn"), check("warn")]);
  assert.match(warned.summary, /2 warning\(s\)/);

  const broken = summarizeDoctorChecks([check("fail"), check("warn")]);
  assert.match(broken.summary, /1 blocker\(s\), 1 warning\(s\)/);
});
