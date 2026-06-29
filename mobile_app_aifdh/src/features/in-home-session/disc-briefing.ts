import type { DiscLetter } from "@/src/features/appointments/types";

export type DiscBriefing = {
  label: string;
  pace: string;
  dos: string[];
  donts: string[];
};

const BRIEFINGS: Record<DiscLetter, DiscBriefing> = {
  D: {
    label: "Dominant — direct, results-driven",
    pace: "Move fast. Lead with the bottom line, then fill in detail only if asked.",
    dos: [
      "Get to the point and the price quickly.",
      "Give them control — offer clear options to choose from.",
      "Show outcomes and ROI, not process.",
    ],
    donts: [
      "Don't over-explain or pad with small talk.",
      "Don't be wishy-washy — make a firm recommendation.",
      "Don't waste their time with features they didn't ask about.",
    ],
  },
  I: {
    label: "Influential — social, enthusiastic",
    pace: "Warm and energetic. Let them talk; match their excitement.",
    dos: [
      "Build personal rapport first — be a person, not a pitch.",
      "Paint the vision and how great the result will feel.",
      "Use stories and other happy customers.",
    ],
    donts: [
      "Don't drown them in fine print and spec sheets.",
      "Don't be cold or purely transactional.",
      "Don't rush past the relationship to close.",
    ],
  },
  S: {
    label: "Steady — patient, relationship-focused",
    pace: "Slow down. Be calm, reassuring, and unhurried.",
    dos: [
      "Reassure them — emphasize warranty, support, and reliability.",
      "Give them time and space to decide; no pressure.",
      "Be consistent and follow through on every promise.",
    ],
    donts: [
      "Don't push for an on-the-spot decision.",
      "Don't use high-pressure or aggressive closing.",
      "Don't spring surprises or sudden changes.",
    ],
  },
  C: {
    label: "Conscientious — analytical, detail-driven",
    pace: "Be precise and methodical. Give them data and time to think.",
    dos: [
      "Bring specifics — numbers, comparisons, written detail.",
      "Answer questions thoroughly and accurately.",
      "Let them review; expect and respect their research.",
    ],
    donts: [
      "Don't be vague or wing an answer you're unsure of.",
      "Don't rely on hype or emotional appeals.",
      "Don't rush them past their due diligence.",
    ],
  },
};

export function discBriefingFor(
  primary: DiscLetter | "unknown" | null | undefined,
): DiscBriefing | null {
  if (!primary || primary === "unknown") return null;
  return BRIEFINGS[primary] ?? null;
}
