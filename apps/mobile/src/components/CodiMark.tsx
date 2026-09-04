import type { ColorValue } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);
const ThemedRect = withUniwind(Rect);

/**
 * The Codi brand mark — a serif C followed by a block cursor — matching the
 * desktop sidebar's CodiMark SVG (apps/web SidebarChrome.tsx) and the app
 * icons in assets/. Width derives from the viewBox aspect ratio.
 */
export function CodiMark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 95 / 60;
  return (
    <Svg
      accessibilityLabel="Codi"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="16 34 95 60"
    >
      <ThemedPath
        d="M 64.47 40.36 A 30 30 0 1 0 67.58 84.84 L 60.77 79.11 A 18.5 25.1 0 1 1 58.85 45.94 Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
      <ThemedRect
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
        height={46}
        width={27}
        x={84}
        y={48}
      />
    </Svg>
  );
}
