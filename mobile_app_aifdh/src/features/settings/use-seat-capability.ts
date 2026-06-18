import { useRepProfile } from "./queries";

export function useSeatCapability() {
  const { data, isLoading } = useRepProfile();
  const seatType = data?.seat?.seat_type ?? null;
  return {
    isLoading,
    seatType,
    isManagerSeat: seatType === "manager",
    canRecord: seatType !== "manager",
  };
}
