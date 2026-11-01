import { Image } from "expo-image";

/** Shared Fold artwork, rendered without runtime effects at navigation-bar size. */
export function CodiMark(props: { readonly height: number }) {
  return (
    <Image
      source={require("../../../../assets/brand/mark.png")}
      accessibilityLabel="Codi"
      accessibilityIgnoresInvertColors
      style={{ height: props.height, width: props.height }}
      contentFit="contain"
    />
  );
}
