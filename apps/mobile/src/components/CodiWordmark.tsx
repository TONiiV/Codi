import { Image } from "react-native";
import { withUniwind } from "uniwind";

const ThemedImage = withUniwind(Image);

/** Rounded brand lettering stays identical across platforms and follows the theme. */
export function CodiWordmark({ height = 24 }: { readonly height?: number }) {
  return (
    <ThemedImage
      source={require("../../../../assets/brand/wordmark.png")}
      accessibilityLabel="Codi"
      tintColorClassName="accent-foreground"
      resizeMode="contain"
      style={{ height, width: height * (208 / 72) }}
    />
  );
}
