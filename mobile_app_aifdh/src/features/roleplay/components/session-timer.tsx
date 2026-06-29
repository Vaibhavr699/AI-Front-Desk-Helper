import { useEffect, useState } from "react";
import { Text } from "react-native";

type Props = {
  startedAt: string;
  className?: string;
};

export function SessionTimer({ startedAt, className }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startMs = new Date(startedAt).getTime();
  const seconds = Math.max(0, Math.floor((now - startMs) / 1000));
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");

  return (
    <Text
      className={`font-mono text-sm font-semibold tabular-nums text-ink-secondary ${className ?? ""}`}
    >
      {mm}:{ss}
    </Text>
  );
}
