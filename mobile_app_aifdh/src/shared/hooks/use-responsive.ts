import { useWindowDimensions } from "react-native";

import {
  LARGE_TABLET_BREAKPOINT_PX,
  TABLET_BREAKPOINT_PX,
} from "@/src/config/constants";

export type Responsive = {
  width: number;
  height: number;
  isPhone: boolean;
  isTablet: boolean;
  isLargeTablet: boolean;
};

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isPhone: width < TABLET_BREAKPOINT_PX,
    isTablet: width >= TABLET_BREAKPOINT_PX,
    isLargeTablet: width >= LARGE_TABLET_BREAKPOINT_PX,
  };
}
