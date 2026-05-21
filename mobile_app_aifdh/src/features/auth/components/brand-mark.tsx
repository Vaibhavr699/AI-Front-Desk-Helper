import { Image } from "expo-image";
import { View, type ViewProps } from "react-native";

type Props = ViewProps & {
  size?: number;
};

const logo = require("@/assets/images/favicon copy.png");

export function BrandMark({ size = 96, className, ...rest }: Props) {
  return (
    <View className={className} {...rest}>
      <Image
        source={logo}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
    </View>
  );
}
