"use strict";

const TWO_PARTY_CONSENT_STATES = new Set([
  "CA", "FL", "IL", "MD", "MA", "MI", "MT", "NV", "NH", "PA", "WA", "OR",
]);

function isTwoPartyConsentState(stateCode) {
  return TWO_PARTY_CONSENT_STATES.has(String(stateCode).toUpperCase());
}

module.exports = { TWO_PARTY_CONSENT_STATES, isTwoPartyConsentState };
