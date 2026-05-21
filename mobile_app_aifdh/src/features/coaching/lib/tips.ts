type Tip = {
  title: string;
  body: string;
};

const DIMENSION_TIPS: Record<string, Tip[]> = {
  rapport: [
    {
      title: "Open with a non-business observation",
      body: "Comment on the home, a pet, the neighborhood. Spend 60 seconds connecting before you ask discovery questions.",
    },
  ],
  discovery: [
    {
      title: "Ask one more question before pitching",
      body: "When you feel ready to present, force yourself to ask one more open-ended question. The customer's words become your pitch.",
    },
  ],
  objection_handling: [
    {
      title: "Acknowledge before answering",
      body: "Mirror the objection in your own words first. \"It sounds like you're worried about timing — am I hearing that right?\" Then respond.",
    },
  ],
  closing: [
    {
      title: "Assume the close",
      body: "After value is established, switch from 'would you like' to 'when would you like'. Asking 'are you ready?' invites them to say no.",
    },
  ],
  presenting: [
    {
      title: "Cut your pitch in half",
      body: "Reps lose deals from over-talking, not under-explaining. Make your point, stop, and let silence do the work.",
    },
  ],
  listening: [
    {
      title: "Repeat back the last three words",
      body: "When the customer pauses, repeat their last three words as a question. They'll keep talking and you'll learn more.",
    },
  ],
  next_steps: [
    {
      title: "Lock the next moment before leaving",
      body: "Never leave without a calendar commit — a follow-up call, signing window, or contractor visit. \"No next step\" is a lost lead.",
    },
  ],
  assertiveness: [
    {
      title: "Make the recommendation, then ask",
      body: "Don't ask 'what would you like to do?' Tell them what you'd recommend, then ask if that works. Customers want guidance.",
    },
  ],
};

const FALLBACK_TIP: Tip = {
  title: "Review your last scored call",
  body: "Open the Coaching tab on your most recent lead and re-read the AI feedback before your next visit.",
};

export function tipsFor(weakestDimension: string | null): Tip[] {
  if (!weakestDimension) return [FALLBACK_TIP];
  const key = weakestDimension.toLowerCase().replace(/\s+/g, "_");
  return DIMENSION_TIPS[key] ?? [FALLBACK_TIP];
}
