import { copy, text } from "./copy.ts";

/**
 * When a browser refuses the microphone without ever asking, the switch that
 * matters is somewhere the page can't reach: on an iPhone it is in the Settings
 * app, under the browser's own name; elsewhere it sits behind the icon beside
 * the address. This works out which of those this person is looking at, and
 * describes each step as words plus a small mock screen to animate.
 */

/** One mock screen, drawn by the help dialog. Labels are what the real screen says. */
export type MicHelpScreen =
  | { kind: "home" }
  | { kind: "list"; title: string; target: string; back?: boolean }
  | { kind: "toggle"; title: string; target: string }
  | { kind: "choice"; title: string; options: string[]; pick: number }
  | { kind: "address"; host: string }
  | { kind: "retry" };

export type MicHelpStep = { text: string; screen: MicHelpScreen };

export type MicHelp = {
  /** Where this is happening, e.g. "Chrome on this iPhone". */
  intro: string;
  steps: MicHelpStep[];
  /** A second place to look, when the first can leave a setting behind. */
  note?: string;
};

type Platform =
  | { kind: "ios"; device: string; app: string; safari: boolean }
  | { kind: "android" }
  | { kind: "mac-safari" }
  | { kind: "desktop" };

/** iOS browsers and in-app browsers that say who they are; anything else on iOS is Safari. */
const IOS_APPS: [RegExp, string][] = [
  [/CriOS\//, "Chrome"],
  [/FxiOS\//, "Firefox"],
  [/EdgiOS\//, "Edge"],
  [/OPiOS\/|OPT\//, "Opera"],
  [/DuckDuckGo\//, "DuckDuckGo"],
  [/GSA\//, "Google"],
  [/Instagram/, "Instagram"],
  [/FBAN|FBAV/, "Facebook"],
];

export function micPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  const ipadAsMac = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(userAgent) || ipadAsMac) {
    const device = /iPhone|iPod/.test(userAgent) ? "iPhone" : "iPad";
    const app = IOS_APPS.find(([pattern]) => pattern.test(userAgent))?.[1];
    return { kind: "ios", device, app: app ?? "Safari", safari: !app };
  }
  if (/Android/.test(userAgent)) return { kind: "android" };
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Firefox\/|Edg\//.test(userAgent)) {
    return { kind: "mac-safari" };
  }
  return { kind: "desktop" };
}

export function micHelp(input: { userAgent: string; maxTouchPoints?: number; host: string }): MicHelp {
  const words = copy.micHelp;
  const platform = micPlatform(input.userAgent, input.maxTouchPoints);
  const retry: MicHelpStep = { text: words.steps.retry, screen: { kind: "retry" } };

  if (platform.kind === "ios") {
    const { app, device } = platform;
    const opening: MicHelpStep[] = [
      { text: words.steps.openSettings, screen: { kind: "home" } },
      { text: words.steps.tapApps, screen: { kind: "list", title: words.screens.settings, target: words.screens.apps } },
      {
        text: text(words.steps.findApp, { app }),
        screen: { kind: "list", title: words.screens.apps, target: app, back: true },
      },
    ];
    if (platform.safari) {
      return {
        intro: text(words.intro.ios, { app, device }),
        steps: [
          ...opening,
          {
            text: words.steps.safariMicrophone,
            screen: { kind: "list", title: app, target: words.screens.microphone, back: true },
          },
          {
            text: words.steps.chooseAllow,
            screen: { kind: "choice", title: words.screens.microphone, options: words.screens.choices, pick: 2 },
          },
          retry,
        ],
        note: words.notes.iosSafari,
      };
    }
    return {
      intro: text(words.intro.ios, { app, device }),
      steps: [
        ...opening,
        { text: words.steps.turnOn, screen: { kind: "toggle", title: app, target: words.screens.microphone } },
        retry,
      ],
      note: text(words.notes.iosApp, { app }),
    };
  }

  if (platform.kind === "mac-safari") {
    return {
      intro: words.intro.macSafari,
      steps: [
        {
          text: text(words.steps.safariMenu, { host: input.host }),
          screen: { kind: "list", title: "Safari", target: text(words.screens.settingsFor, { host: input.host }) },
        },
        {
          text: words.steps.chooseAllow,
          screen: { kind: "choice", title: words.screens.microphone, options: words.screens.choices, pick: 2 },
        },
        retry,
      ],
    };
  }

  const address: MicHelpStep = { text: words.steps.tapSiteIcon, screen: { kind: "address", host: input.host } };
  if (platform.kind === "android") {
    return {
      intro: words.intro.android,
      steps: [
        address,
        { text: words.steps.tapPermissions, screen: { kind: "list", title: input.host, target: words.screens.permissions } },
        { text: words.steps.turnOn, screen: { kind: "toggle", title: words.screens.permissions, target: words.screens.microphone } },
        retry,
      ],
    };
  }
  return {
    intro: words.intro.desktop,
    steps: [
      address,
      { text: words.steps.turnOn, screen: { kind: "toggle", title: input.host, target: words.screens.microphone } },
      retry,
    ],
  };
}
