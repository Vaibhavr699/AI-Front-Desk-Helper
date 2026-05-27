import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";

type Props = {
  value: string;
  size?: number;
};

export function QrCodeDisplay({ value, size = 200 }: Props) {
  return (
    <View className="items-center rounded-sm border border-slate-200 bg-white p-4">
      <QRCode value={value} size={size} />
    </View>
  );
}
