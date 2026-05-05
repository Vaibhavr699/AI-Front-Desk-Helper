"use strict";

function getPhoneDigits(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function getLast10Digits(raw) {
  const digits = getPhoneDigits(raw);
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function normalizeE164Phone(raw, options = {}) {
  const { allowNonDialable = false } = options;
  const value = String(raw || "").trim();
  if (!value) return null;

  if (/^(fb-|web-)/i.test(value)) {
    return allowNonDialable ? value : null;
  }

  if (value.startsWith("+")) {
    const digits = getPhoneDigits(value);
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (value.startsWith("00")) {
    const digits = getPhoneDigits(value.replace(/^00+/, ""));
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  }

  const digits = getPhoneDigits(value);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;

  return allowNonDialable ? value : null;
}

module.exports = {
  getPhoneDigits,
  getLast10Digits,
  normalizeE164Phone,
};
