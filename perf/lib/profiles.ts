import { devices } from "@playwright/test";

/**
 * The two people this lab stands in for. Chromium on both: the throttling that makes
 * the numbers mean something is a Chrome DevTools Protocol feature.
 *
 * `phone-4g` is the headline: PRODUCT.md says most replies happen on a phone, inside
 * a mail client. These are Lighthouse's "slow 4G" and its 4x CPU slowdown.
 */
export type Profile = {
  id: "phone-4g" | "desktop";
  label: string;
  context: Parameters<import("@playwright/test").Browser["newContext"]>[0];
  cpuSlowdown: number;
  latencyMs: number;
  downKbps: number;
  upKbps: number;
};

// The lab always drives Chromium, whatever browser the device preset names.
const phone = { ...devices["iPhone 13"], defaultBrowserType: undefined };

export const PROFILES: Profile[] = [
  {
    id: "phone-4g",
    label: "Phone on 4G",
    context: phone,
    cpuSlowdown: 4,
    latencyMs: 150,
    downKbps: 1600,
    upKbps: 750,
  },
  {
    id: "desktop",
    label: "Laptop on broadband",
    context: { viewport: { width: 1280, height: 800 } },
    cpuSlowdown: 1,
    latencyMs: 30,
    downKbps: 20000,
    upKbps: 5000,
  },
];
