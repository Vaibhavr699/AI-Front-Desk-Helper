import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";

import { US_STATES } from "../consent-states";

function regionToCode(region: string | null): string | null {
  if (!region) return null;
  const target = region.trim().toLowerCase();
  const byName = US_STATES.find((s) => s.name.toLowerCase() === target);
  if (byName) return byName.code;
  if (target.length === 2) {
    const byCode = US_STATES.find((s) => s.code.toLowerCase() === target);
    if (byCode) return byCode.code;
  }
  return null;
}

export function useSuggestedState(): { suggested: string | null; refresh: () => void } {
  const [suggested, setSuggested] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const places = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      const region = places[0]?.region ?? null;
      const code = regionToCode(region);
      if (code) setSuggested(code);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { suggested, refresh };
}
