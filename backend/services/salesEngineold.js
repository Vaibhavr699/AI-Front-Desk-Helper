"use strict";

/**
 * DEPRECATED — 2026-04-17
 *
 * This file duplicated services/estimateRecovery.js and caused a race
 * condition (both crons processed the same estimate_recoveries rows).
 *
 * All real logic moved to services/estimateRecovery.js:
 *   - createEstimateFollowUp  → estimateRecoveryService.startEstimateRecovery
 *   - runEstimateFollowUps    → estimateRecoveryService.processDueRecoveries
 *   - stopEstimateFollowUp    → estimateRecoveryService.markConverted
 *   - notifyOwnerOfConversion → inlined into estimateRecoveryService.markConverted
 *
 * These stubs remain so any lingering callers don't throw. Each one logs a
 * deprecation warning so we can spot them in logs and finish the cleanup.
 *
 * SAFE TO DELETE THIS FILE once logs confirm zero warnings for a week.
 */

async function createEstimateFollowUp(lead, tenantId = null) {
  console.warn(
    "[DEPRECATED] salesEngine.createEstimateFollowUp called — use estimateRecoveryService.startEstimateRecovery instead. lead=%s tenant=%s",
    lead?.phone || "(no phone)",
    tenantId || "(none)"
  );
  return null;
}

async function runEstimateFollowUps() {
  console.warn(
    "[DEPRECATED] salesEngine.runEstimateFollowUps called — use estimateRecoveryService.processDueRecoveries instead."
  );
  return null;
}

async function stopEstimateFollowUp(phone, status = "converted") {
  console.warn(
    "[DEPRECATED] salesEngine.stopEstimateFollowUp called — use estimateRecoveryService.markConverted (via direct lookup) instead. phone=%s status=%s",
    phone,
    status
  );
  return { ok: false, reason: "deprecated_noop" };
}

module.exports = {
  createEstimateFollowUp,
  runEstimateFollowUps,
  stopEstimateFollowUp,
};
