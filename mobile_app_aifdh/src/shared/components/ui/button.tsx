import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from "react-native";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

type Props = Omit<PressableProps, "children"> & {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
};

const variantStyles: Record<Variant, { container: string; label: string; spinner: string }> = {
  primary: {
    container: "bg-blue-600 active:bg-blue-700",
    label: "text-white font-semibold",
    spinner: "#ffffff",
  },
  secondary: {
    container: "bg-slate-200 active:bg-slate-300",
    label: "text-slate-900 font-semibold",
    spinner: "#1e293b",
  },
  ghost: {
    container: "bg-transparent active:bg-slate-100",
    label: "text-blue-600 font-semibold",
    spinner: "#2563eb",
  },
};

const sizeStyles: Record<Size, { container: string; label: string }> = {
  md: { container: "h-11 px-4", label: "text-base" },
  lg: { container: "h-14 px-6", label: "text-lg" },
};

export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  ...rest
}: Props) {
  const v = variantStyles[variant];
  const s = sizeStyles[size];
  const isDisabled = disabled || loading;
  const className = [
    "flex-row items-center justify-center rounded-xl",
    v.container,
    s.container,
    fullWidth ? "w-full" : "",
    isDisabled ? "opacity-50" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Pressable className={className} disabled={isDisabled} {...rest}>
      {loading ? (
        <ActivityIndicator color={v.spinner} />
      ) : (
        <Text className={`${v.label} ${s.label}`}>{label}</Text>
      )}
    </Pressable>
  );
}
