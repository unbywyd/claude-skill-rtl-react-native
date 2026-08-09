# RTL for React Native — a Claude Code skill

A skill that teaches Claude Code to write **correct right-to-left layouts** in React Native
and Expo — Hebrew, Arabic, Farsi, Urdu.

Every rule in it was measured on real hardware, not taken from documentation. Where a
widely-repeated claim turned out to be false, the skill says so and gives the measured
behaviour instead.

**Measured on:** Expo SDK 57 · RN 0.86.2 · New Architecture (Fabric)
**Devices:** Galaxy S21 Ultra (Android 15) · iPhone 16 Pro Max (iOS 26.5.2) · Pixel 6 Pro emulator

---

## Install

```bash
# all projects
git clone https://github.com/unbywyd/claude-skill-rtl-react-native.git \
  ~/.claude/skills/rtl-react-native

# or one project
git clone https://github.com/unbywyd/claude-skill-rtl-react-native.git \
  .claude/skills/rtl-react-native
```

Cloning **into a folder named `rtl-react-native`** matters — the directory name becomes the
command, so you get `/rtl-react-native` rather than the full repo name.

Verify with `/doctor`, or just ask Claude something RTL-shaped and watch it pick the skill up.

---

## Why it exists

Most RTL bugs in React Native are not caused by RTL being hard. They are caused by
**re-mirroring what the framework already mirrored** — and by a set of failures that produce
no error, no warning, and a wrong result.

AI agents get this wrong in a specific, repeatable way: shown an RTL mockup, they read the
element positions off the image and write `flex-end`, not realising the mockup is *already*
mirrored and React Native will mirror it again.

### What the measurements found

- **`I18nManager.isRTL` cannot be trusted.** On Android it reads `false` while the layout is
  fully mirrored; on iOS `forceRTL` never applies at all. Any code branching on it is wrong
  on both platforms — and a wrong flag can make broken code *look* correct on the device you
  happen to be testing.
- **`forceRTL()` + reload has no working configuration on iOS.** Verified on a Release build
  with Metro killed and the app freshly installed.
- **Driving direction from app state via the `direction` style prop works on both
  platforms**, in both directions, with a live language switch and no reload. That is the
  pattern the skill teaches, and the implementation ships with it.
- **On Android, text alignment follows layout direction, not text content** — the opposite of
  the most widely-cited claim about it.
- **A leading `+` in a phone number migrates to the end inside RTL text.** `textAlign` does
  not fix it; only BiDi isolation does. That corrupts data users act on, not just pixels.

---

## What ships

```
rtl-react-native/
├── SKILL.md                     # the rules — short, loads on invocation
├── references/
│   ├── rules.md                 # every rule with the measurement behind it
│   └── recipes.md               # copy-paste patterns for ten real situations
└── assets/
    ├── direction.tsx            # DirectionProvider + useDirection
    └── eslint-plugin-rtl/       # 6 lint rules, unit-tested
```

### The linter matters as much as the prose

Every bug measured here is **silent**. Guidance that depends on the reader remembering it
will not hold; a lint error will. Six rules, each error message naming the measurement
behind it:

| Rule | Catches |
| --- | --- |
| `no-isrtl` | Reading `I18nManager.isRTL` |
| `no-physical-styles` | `marginLeft` and friends instead of `marginStart` |
| `no-dead-logical-props` | `borderInlineStartWidth` and other silent no-ops |
| `no-textalign-start` | `textAlign: 'start'` — invalid in RN, fails silently |
| `no-direction-ternary` | The double flip: `isRTL ? 'row-reverse' : 'row'` |
| `require-bidi-isolate` | Phone/IBAN/ID rendered without BiDi isolation |

```bash
cp -r ~/.claude/skills/rtl-react-native/assets/eslint-plugin-rtl tools/
```

Registration snippet is in `SKILL.md` §9.

---

## When it triggers

Automatically, on RTL-shaped work: building or converting an RTL screen, a mirrored design
or Figma frame, `I18nManager` / `forceRTL` / `isRTL` in the code — and on symptoms:

- *"RTL only works on the second launch"*
- *"the layout is flipped the wrong way"*
- *"the icon points the wrong way"*
- *"the + moved to the end of the phone number"*
- *"text is left-aligned on iOS but fine on Android"*
- *"the keyboard covers the input"*
- *"blur only tints on Android"*

Or invoke it directly with `/rtl-react-native`.

---

## Where the evidence lives

The test harness that produced these findings — a React Native app with 15 measurement
tabs, plus 124 screenshots and per-test results — is in a separate repository so it does not
travel with the skill:

**→ [unbywyd/rtl-rn-test](https://github.com/unbywyd/rtl-rn-test)**

Go there to re-run the measurements on your own RN version, to check the evidence behind any
rule, or to add a test. Findings are version-pinned: RN's RTL behaviour changed in 0.74,
0.75, 0.76, 0.77–0.78 and 0.80, so do not assume they carry across versions without
re-testing.

---

## Method

1. Nothing is asserted without a measurement.
2. Surprises are the deliverable — a failed expectation is recorded, not fixed away.
3. Both directions, both platforms, and always with opposite-script content: direction bugs
   are invisible when tested only with the app's own script.

MIT.
