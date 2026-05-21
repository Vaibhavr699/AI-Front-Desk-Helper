import { TextInput, View } from "react-native";

import { TOTP_CODE_LENGTH } from "@/src/config/constants";

type Props = {
  value: string;
  onChangeText: (next: string) => void;
  autoFocus?: boolean;
  editable?: boolean;
};

export function TotpCodeInput({
  value,
  onChangeText,
  autoFocus = true,
  editable = true,
}: Props) {
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={(text) =>
          onChangeText(text.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH))
        }
        keyboardType="number-pad"
        autoFocus={autoFocus}
        editable={editable}
        maxLength={TOTP_CODE_LENGTH}
        textAlign="center"
        placeholder="000000"
        placeholderTextColor="#cbd5e1"
        className="h-16 w-full rounded-xl border border-slate-300 bg-white text-center text-3xl font-semibold tracking-widest text-slate-900"
      />
    </View>
  );
}
