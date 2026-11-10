import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { DeepSeekSettings } from "./settings.ts";

export const deepSeekClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("deepseek"),
  label: "DeepSeek",
  featured: false,
  settingsSchema: DeepSeekSettings,
  environmentFields: [
    {
      name: "DEEPSEEK_API_KEY",
      label: "DeepSeek API key",
      description: "Required. Signs in the DeepSeek Harness CLI.",
      placeholder: "Paste API key",
      sensitive: true,
    },
  ],
  icon: {
    viewBox: "0 0 32 32",
    fill: { light: "#4D6BFE", dark: "#4D6BFE" },
    // Placeholder mark until the official DeepSeek whale asset is available.
    paths: [
      {
        d: "M16 2a14 14 0 1 0 0 28 14 14 0 0 0 0-28Zm0 5a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z",
        fillRule: "evenodd",
      },
    ],
  },
});
