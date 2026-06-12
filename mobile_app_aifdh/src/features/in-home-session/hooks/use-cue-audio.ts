import { useCallback, useEffect, useState } from "react";

import { playCueMp3Base64, stopActiveCue } from "../audio/cue-audio-player";
import { isAudioOutputReady, useAudioOutputReady } from "../audio/audio-route";

export function useCueAudio() {
  const [muted, setMuted] = useState(false);
  const ready = useAudioOutputReady();

  useEffect(() => {
    if (!ready) stopActiveCue();
  }, [ready]);

  useEffect(() => {
    if (muted) stopActiveCue();
  }, [muted]);

  const play = useCallback(
    (base64: string): boolean => {
      if (muted) return false;
      if (!isAudioOutputReady()) return false;
      playCueMp3Base64(base64).catch(() => {});
      return true;
    },
    [muted],
  );

  return { play, muted, setMuted, ready };
}
