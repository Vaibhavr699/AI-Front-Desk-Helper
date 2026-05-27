import { useCallback, useEffect, useRef, useState } from "react";

import { endCall, getCallStatus, initiateCall } from "../api";

export type CallPhase = "idle" | "initiating" | "ringing" | "in-progress" | "completed" | "failed";

export function useCallSession() {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [callSid, setCallSid] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const start = useCallback(async (leadId: string) => {
    setPhase("initiating");
    setError(null);
    setDuration(0);
    try {
      const result = await initiateCall(leadId);
      setCallSid(result.call_sid);
      setPhase("ringing");
      startTimeRef.current = Date.now();
      pollRef.current = setInterval(async () => {
        try {
          const s = await getCallStatus(result.call_sid);
          if (s.status === "in-progress") {
            setPhase("in-progress");
            if (!timerRef.current) {
              timerRef.current = setInterval(() => {
                setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
              }, 1000);
            }
          }
          if (s.status === "completed" || s.status === "busy" || s.status === "no-answer" || s.status === "failed" || s.status === "canceled") {
            setPhase(s.status === "completed" ? "completed" : "failed");
            if (s.status !== "completed") setError(`Call ${s.status}`);
            cleanup();
          }
        } catch {}
      }, 3000);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Call failed");
    }
  }, []);

  const hangUp = useCallback(async () => {
    if (callSid) {
      try { await endCall(callSid); } catch {}
    }
    setPhase("completed");
    cleanup();
  }, [callSid]);

  function cleanup() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  useEffect(() => () => cleanup(), []);

  return { phase, callSid, duration, error, start, hangUp };
}
