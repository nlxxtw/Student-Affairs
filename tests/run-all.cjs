"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const tests = [
  path.join(__dirname,"qa-open-filter-sync.cjs"),
  path.join(__dirname,"qa-webdav-resource-boundaries.cjs"),
  path.join(__dirname,"qa-request-origin-security.cjs"),
  path.join(__dirname,"qa-save-attention-browser.cjs"),
  path.join(__dirname,"qa-collaboration-retirement-static.cjs"),
  path.join(__dirname,"qa-workbench-session-store.cjs"),
  path.join(__dirname,"qa-collaboration-retirement.cjs"),
  path.join(__dirname, "qa-student-leave-engine.cjs"),
  path.join(__dirname, "qa-student-leave-service.cjs"),
  path.join(__dirname, "qa-student-leave-browser.cjs"),
  path.join(__dirname, "qa-student-leave-ui.cjs"),
  path.join(__dirname, "qa-checkbox-linkage.cjs"),
  path.join(__dirname, "qa-student-identity-autofill.cjs"),
  path.join(__dirname, "qa-powershell-runtime.cjs"),
  path.join(__dirname, "qa-launch-port.cjs"),
  path.join(__dirname, "qa-database-migrations.cjs"),
  path.join(__dirname, "qa-request-json.cjs"),
  path.join(__dirname, "qa-import-input-boundaries.cjs"),
  path.join(__dirname, "qa-isolated-target-guard.cjs"),
  path.join(__dirname, "qa-ui-contract.cjs"),
  path.join(__dirname, "qa-modal-save-contract.cjs"),
  path.join(__dirname, "qa-backup-triggers.cjs"),
  path.join(__dirname, "qa-backup-delete.cjs"),
  path.join(__dirname, "qa-workbench-store-canonical.cjs"),
  path.join(__dirname, "qa-workbench-store-live-sync.cjs"),
  path.join(__dirname, "qa-party-cards.cjs"),
  path.join(__dirname, "qa-party-import.cjs"),
  path.join(__dirname, "qa-party-import-browser.cjs"),
  path.join(__dirname, "qa-party-form-browser.cjs"),
  path.join(__dirname, "qa-student-phone-query.cjs"),
  path.join(__dirname, "qa-dashboard-class-filter-logic.cjs"),
  path.join(__dirname, "qa-dashboard-class-filters.cjs"),
  path.join(__dirname,"qa-academic-public-capacity.cjs"),
  path.join(__dirname,"qa-academic-public-ui-boundaries.cjs"),
  path.join(__dirname,"qa-academic-public-boundaries.cjs"),
  path.join(__dirname,"qa-academic-public-integrity.cjs"),
  path.join(__dirname,"qa-academic-public-calculation-boundaries.cjs"),
  path.join(__dirname,"qa-academic-public-periods.cjs"),
  path.join(__dirname,"qa-academic-public-warning-independent.cjs"),
  path.join(__dirname,"qa-academic-public-project-exams.cjs"),
  path.join(__dirname,"qa-academic-public-project-service.cjs"),
  path.join(__dirname,"qa-academic-public-project-browser.cjs"),
  path.join(__dirname,"qa-academic-public-period-service.cjs"),
  path.join(__dirname,"qa-academic-public-period-browser.cjs"),
  path.join(__dirname,"qa-academic-public-checkbox-service.cjs"),
  path.join(__dirname,"qa-academic-public-checkbox-browser.cjs"),
  path.join(__dirname,"qa-academic-public-cascade-browser.cjs"),
  path.join(__dirname,"qa-academic-public-files.cjs"),
  path.join(__dirname,"qa-academic-public-policy.cjs"),
  path.join(__dirname,"qa-academic-public-support.cjs"),
  path.join(__dirname,"qa-academic-public-analysis.cjs"),
  path.join(__dirname,"qa-academic-public-analysis-service.cjs"),
  path.join(__dirname,"qa-academic-public-analysis-browser.cjs"),
  path.join(__dirname,"qa-academic-public-completion.cjs"),
  path.join(__dirname,"qa-academic-public-completion-browser.cjs"),
  path.join(__dirname,"qa-academic-public-manual-browser.cjs"),
  path.join(__dirname,"qa-academic-public-layout-browser.cjs"),
  path.join(__dirname,"qa-academic-public-report.cjs"),
  path.join(__dirname,"qa-academic-public-report-browser.cjs"),
  path.join(__dirname,"qa-academic-public.cjs"),
  path.join(__dirname,"qa-academic-public-browser.cjs"),
  path.join(__dirname, "qa-static.cjs"),
  path.join(__dirname, "qa-academic-warning-layout.cjs"),
  path.join(__dirname, "qa-personal-academic-batch-delete.cjs"),
  path.join(__dirname, "qa-portrait-open-close.cjs"),
  path.join(__dirname, "qa-chaoxing-core.cjs"),
  path.join(__dirname, "qa-chaoxing-browser.cjs"),
  path.join(__dirname, "qa-chaoxing-aggregation.cjs"),
  path.join(__dirname, "qa-chaoxing-dates.cjs"),
  path.join(__dirname, "qa-classroom-timetable-removal.cjs"),
  path.join(__dirname, "qa-timetable-layout.cjs"),
  path.join(__dirname, "qa-timetable-periods.cjs"),
  path.join(__dirname, "qa-ui-font-sizes.cjs"),
  path.join(__dirname, "qa-employment-tracking.cjs"),
  path.join(__dirname, "qa-employment-default-year.cjs"),
  path.join(__dirname, "qa-tasks.cjs"),
  path.join(__dirname, "qa-task-save-boundaries.cjs"),
  path.join(__dirname, "qa-task-save-browser.cjs"),
  path.join(__dirname, "qa-task-reference-dashboard.cjs"),
  path.join(__dirname, "qa-counselor-attachment-download.cjs"),
  path.join(__dirname, "qa-session-relogin.cjs"),
  path.join(__dirname, "qa-tool-session-relogin.cjs"),
  path.join(__dirname, "qa-term-governance.cjs"),
  path.join(__dirname, "qa-term-order.cjs"),
  path.join(__dirname, "qa-tool-history.cjs"),
  path.join(__dirname, "qa-academic-summary-reference.cjs"),
  path.join(__dirname, "qa-academic-summary-ai.cjs"),
  path.join(__dirname, "qa-academic-summary-formats.cjs"),
  path.join(__dirname, "qa-tool-csp.cjs"),
  path.join(__dirname, "qa-ai-governance.cjs"),
  path.join(__dirname, "qa-system-update.cjs"),
  path.join(__dirname, "qa-update-social-kit.cjs"),
  path.join(__dirname, "qa_delete_verify.cjs"),
  path.join(__dirname, "qa-excel-check.cjs"),
  path.join(__dirname, "qa-integration.cjs"),
  path.join(__dirname, "qa-word-safety.cjs"),
  path.join(__dirname, "qa-word-api-boundaries.cjs"),
  path.join(__dirname, "qa-word-editor-isolation-browser.cjs"),
  path.join(__dirname, "qa-word-ownership.cjs"),
  path.join(__dirname, "qa-word-timeout-owned.cjs"),
  path.join(__dirname, "qa-imports.cjs"),
  path.join(__dirname, "qa-dorm-import.cjs"),
  path.join(__dirname, "qa-dorm-batch-clear-browser.cjs"),
  path.join(__dirname, "qa-dorm-resource-import.cjs"),
  path.join(__dirname, "qa-dorm-resource-browser.cjs"),
  path.join(__dirname, "qa-dorm-import-performance.cjs"),
  path.join(__dirname, "qa-dorm-import-large-browser.cjs"),
  path.join(__dirname, "qa-import-batch-persistence.cjs"),
  path.join(__dirname, "qa-import-async-commit.cjs"),
  path.join(__dirname, "qa-student-import-lifecycle-browser.cjs"),
  path.join(__dirname, "qa-import-smart-match-browser.cjs"),
  path.join(__dirname, "qa-student-link-integrity.cjs"),
  path.join(__dirname, "qa-student-link-integrity-browser.cjs"),
  path.join(__dirname, "qa-fixed-value-review-browser.cjs"),
  path.join(__dirname, "qa-operation-progress-browser.cjs"),
  path.join(__dirname, "qa-student-identity.cjs"),
  path.join(__dirname, "qa-student-import-dates.cjs"),
  path.join(__dirname, "qa-fund-save-race.cjs"),
  path.join(__dirname, "qa-browser.cjs"),
  path.join(__dirname, "qa-demo-data.cjs"),
  path.join(__dirname, "qa-demo-after-clear-browser.cjs"),
  path.join(__dirname, "qa-dorm-roster-pdf.cjs"),
  path.join(__dirname, "qa-roster-layout-browser.cjs"),
  path.join(__dirname, "qa-custom-roster-navigation.cjs"),
  path.join(__dirname, "qa-nav-customize.cjs"),
  path.join(__dirname, "qa-orgs-aux-sim.cjs"),
  path.join(__dirname, "qa-talk-ai-summary.cjs"),
  path.join(__dirname, "qa-ui-themes.cjs")
];

// Full runs must not inherit focused-only switches or test a separate desktop tool.
const testEnv = { ...process.env, QA_ACADEMIC_SUMMARY_SYSTEM_ONLY: "1" };
for (const key of Object.keys(testEnv)) {
  if (key.startsWith("QA_") && key !== "QA_ACADEMIC_SUMMARY_SYSTEM_ONLY") delete testEnv[key];
}

// Resume long runs without repeating completed groups; default remains full/fail-fast.
const from = process.argv.find(arg => arg.startsWith("--from="))?.slice(7);
const start = from ? tests.findIndex(test => path.basename(test) === from) : 0;
if (start < 0) throw new Error("Unknown test group: " + from);
const continueOnError = process.argv.includes("--continue-on-error");
const failures = [];
for (const test of tests.slice(start)) {
  console.log(`\n[RUN] ${path.relative(root, test)}`);
  const result = spawnSync(process.execPath, [test], { cwd: root, stdio: "inherit", env: testEnv, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (!continueOnError) process.exit(result.status || 1);
    failures.push(path.relative(root, test));
  }
}
for (const mode of ["QA_CHECKCLASS_MULTI_ONLY", "QA_ATTENDANCE_LEAVE_ONLY", "QA_TASKS_ONLY", "QA_STUDENT_PICKER_ONLY"]) {
  console.log(`\n[RUN] tests/qa-browser.cjs (${mode})`);
  const result = spawnSync(process.execPath, [path.join(__dirname, "qa-browser.cjs")], { cwd: root, stdio: "inherit", env: { ...testEnv, [mode]: "1" }, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (!continueOnError) process.exit(result.status || 1);
    failures.push("qa-browser.cjs (" + mode + ")");
  }
}
if (failures.length) {
  console.error("\nFailed groups:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log(`\n${from ? "Selected" : "All"} workbench tests passed (${tests.length - start + 4} groups).`);
