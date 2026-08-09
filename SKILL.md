---
name: rtl-react-native
description: Build or fix right-to-left (RTL) layouts in React Native and Expo — Hebrew, Arabic, Farsi, Urdu. Use when implementing an RTL screen, converting an app to support an RTL language, reviewing a design or Figma frame that is already mirrored, or debugging symptoms like "the layout is flipped the wrong way", "RTL only works on the second launch", "the icon points the wrong way", "the phone number's + moved to the end", "text is left-aligned on iOS but fine on Android", "the keyboard covers the input", or "blur only tints on Android".
when_to_use: Triggers include RTL, right-to-left, Hebrew, עברית, Arabic, العربية, I18nManager, forceRTL, isRTL, textAlign, marginStart/paddingStart, direction prop, BiDi, LRM, safe area insets, and any React Native screen that must work in both directions.
---

# RTL in React Native — rules measured on real devices

Every rule here was verified on hardware: **Galaxy S21 Ultra (Android 15)** and
**iPhone 16 Pro Max (iOS 26.5.2)**, both on **RN 0.86.2 / Expo SDK 57 / Fabric**.
Where a widely-repeated claim was measured and found false, this file says so.

**Read [`references/rules.md`](references/rules.md) for the evidence behind any rule.**
**Read [`references/recipes.md`](references/recipes.md) for copy-paste patterns.**

---

## 0. The mirrored-mockup trap — read this before writing any code

An RTL design, screenshot, or Figma frame is **already mirrored**. What looks like the
right edge is the **START** of the line, not the end.

Reasoning visually from that image produces the single most common RTL bug:

```jsx
// ❌ "the label looks right-aligned, so…"  → RN mirrors it AGAIN → lands LEFT
<View style={{ justifyContent: 'flex-end' }}>

// ✅ the label is at the START of the line. RN puts start on the right in RTL.
<View style={{ justifyContent: 'flex-start' }}>
```

Figma exposes **no** text-direction metadata to its API, so an RTL frame carries no
machine-readable signal. **Ask which direction a mockup represents, or assume it was
authored LTR.** Never read direction off pixel positions.

---

## 1. RTL layout works on its own — do not "implement" it

Yoga mirrors layout before your code runs. Measured on both platforms with **zero**
direction logic: `flexDirection: 'row'`, `justifyContent`, `alignItems`, `marginStart`,
`paddingStart`, `borderStartWidth`, `start`/`end`, and even `left`/`right` all mirror
correctly.

**Write plain logical values. Add no direction branch.**

```jsx
// ✅ correct in both directions, nothing else needed
<View style={{ flexDirection: 'row', justifyContent: 'flex-start', marginStart: 16 }} />
```

If you are writing `isRTL ? … : …` for ordinary layout, you are re-mirroring what is
already mirrored. That is the bug, not the fix.

---

## 2. `I18nManager.isRTL` is unreliable — never read it

**Measured, 8+ configurations, both platforms:**

| | Android | iOS |
| --- | --- | --- |
| `isRTL` value | `false` **while the layout is fully mirrored** | `false`, and `forceRTL` never applies at all |

`isRTL` is a startup snapshot computed at native-module construction and cached in JS at
module load. It never updates in-process.

This breaks it in **both** roles at once:
- as a layout gate → produces LTR inside an RTL screen,
- as the direction source for the legitimate exceptions → icons never flip,
  `TextInput.textAlign` picks the wrong side, carousel indices are not inverted.

**Worse, a wrong `isRTL` can make broken code look correct**, and the bug is **invisible
on same-script content** — a Hebrew app tested with Hebrew strings looks flawless while its
direction logic is wrong. It only surfaces on Latin text, phone numbers, emails and codes.

> Derive direction from the app's own language state. Never from `I18nManager`.

---

## 3. The working pattern — direction from app state

`forceRTL()` + reload has **no working configuration on iOS** (verified on a Release build,
Metro killed, fresh install). On Android it works but leaves `isRTL` lying. The portable
replacement, measured working on **both** platforms in both directions with a runtime
language switch and **no reload**:

```jsx
// 1. One provider at the root. Direction comes from state.
<DirectionProvider lang={lang}>
  <App />
</DirectionProvider>

// 2. Inside: plain logical values. Yoga mirrors them.
<View style={{ flexDirection: 'row', marginStart: 16 }} />

// 3. The only two things Yoga cannot infer — from the SAME state, never I18nManager:
const { isRTL } = useDirection();
<Icon style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
<TextInput style={{ textAlign: isRTL ? 'right' : 'left' }} />
```

Implementation to copy: [`assets/direction.tsx`](assets/direction.tsx).

**Place `direction` on the screen's scroll container** (or its `contentContainerStyle`) —
verified on both platforms. Only the subtree inside the provider mirrors; a global header
or tab bar rendered outside it keeps the app's native direction. That is a design decision
to make deliberately, not a bug to debug.

Keep `forceRTL` **only** in `app.json` via the `expo-localization` plugin, for the first
frame before JS runs.

---

## 4. Always-LTR data — a separate problem from layout

Phone numbers, emails, URLs, IBANs, order IDs, prices and signed numbers are **always LTR**
even inside RTL text. This is **data corruption, not cosmetics**:

```
+972 54-123-4567   rendered inside RTL text as   54-123-4567 972+
```

The `+` is BiDi class ES — a *weak* character that binds to the surrounding direction.
**`textAlign` does not fix this**; it aligns the block, not the characters.

```jsx
const LRI = '⁦', PDI = '⁩';   // isolates
<Text>טלפון: {LRI}{phone}{PDI}</Text>   // ✅ +972 54-123-4567
```

Isolate the **value at its substitution point**, never the whole sentence — wrapping the
line does nothing for a fragment inside it. Build it into `formatPhone` / `formatPrice` so
call sites cannot forget.

---

## 5. Things that fail silently

No error, no warning, wrong result:

| Write this | What happens |
| --- | --- |
| `textAlign: 'start'` | **Not a valid RN value.** Silently ignored. Use `'left'`/`'right'`. |
| `borderInlineStartWidth` | **Does not exist.** Renders no border. Use `borderStartWidth`. |
| `writingDirection` to align text | Does **not** control alignment. |
| `shadowOffset` on Android | Does not render at all. Use `boxShadow`. |
| `verticalAlign` / `textAlignVertical` on iOS | Android-only. No-ops on iOS. |
| `start` + a `left` override | `start` wins; the override is dead code. |
| Missing `SafeAreaProvider` / `KeyboardProvider` / `GestureHandlerRootView` | Their components do nothing. |

---

## 6. Screen mechanics that break in RTL apps

- **`justifyContent` does not inherit.** Any wrapper between the centring box and the text
  starts a new flex container. Give the wrapper its own.
- **Never centre text with `lineHeight` = container height.** Centres on Android, **not on
  iOS**. Use `justifyContent: 'center'` on the direct parent.
- **`lineHeight ≤ fontSize` clips descenders.** Hebrew glyphs are taller than Latin at the
  same `fontSize`, so a value tuned on English copy clips after translation.
- **Safe-area insets are physical.** `insets.left`/`right` do **not** mirror — map them
  through the current direction. Apply each inset in exactly **one** place; double-counting
  is the quiet half of the bug.
- **Keyboard:** on Android 15 `adjustResize` no longer works under edge-to-edge. A
  `TextInput` inside a plain `ScrollView`, a nested scroller, a `FlatList` or a `Modal`
  will be covered. Use `KeyboardAwareScrollView`; inside a bottom sheet use
  `BottomSheetTextInput`.

---

## 7. Platform asymmetry — write the Android shape

**iOS forgives what Android enforces.** Blur is the clearest case: iOS blurs with almost any
configuration, Android requires all four of `blurMethod`, a `BlurTargetView`, its `ref` as
`blurTarget`, and the `BlurView` as a **sibling** — miss one and you silently get a tint.

> Code written and reviewed on a Mac ships to Android degraded, with a screenshot that
> looked fine to the reviewer.

**But do not assume the direction of the asymmetry** — the `lineHeight` centring case runs
the other way, working on Android and failing on iOS. Measure per case.

---

## 8. Verifying

1. **Test in both directions.** Correctness in one proves nothing about the other.
2. **Test on both platforms.** Their defaults genuinely differ.
3. **Include opposite-script content** — Latin text, phone numbers, IDs. Direction bugs are
   invisible on content written in the app's own script.
4. **Read the code, not the screenshot.** A wrong `isRTL` can make broken code render
   correctly on the device you happen to be holding.
5. **Test effects at mid values.** At `intensity={100}` a working blur is indistinguishable
   from a solid fill.

---

## 9. Enforce with a linter, not with discipline

Every bug above is silent. Prose guidance gets forgotten; a lint error does not.

Ship [`assets/eslint-plugin-rtl/`](assets/eslint-plugin-rtl/) into the project and register it:

```js
// eslint.config.js
import rtl from './tools/eslint-plugin-rtl/index.js';
export default [{ plugins: { rtl }, rules: {
  'rtl/no-isrtl': 'error',
  'rtl/no-physical-styles': 'error',
  'rtl/no-dead-logical-props': 'error',
  'rtl/no-textalign-start': 'error',
  'rtl/no-direction-ternary': 'error',
  'rtl/require-bidi-isolate': 'warn',
}}];
```

Six rules, unit-tested. Each error message names the measurement behind it.

---

## Triage — symptom to cause

| Reported symptom | Real cause |
| --- | --- |
| "RTL only works the second launch" | `forceRTL` needs a bundle reload — and on iOS never applies. Use §3. |
| "forceRTL does nothing on Android" | Check `android:supportsRtl="true"` in the manifest **first**. |
| "The icon points the wrong way" | Keyed off `I18nManager.isRTL`. Use `useDirection()`. |
| "Layout is flipped the wrong way" | A double flip — remove the direction ternary (§1). |
| "The `+` moved to the end of the phone" | BiDi weak character. Isolate the value (§4). |
| "Text is left on iOS, fine on Android" | Set `textAlign` explicitly from app state. |
| "Blur only tints on Android" | Missing one of the four blur conditions (§7). |
| "The keyboard covers the input" | Edge-to-edge killed `adjustResize` (§6). |
| "It looks right on my device" | Not evidence. Read the code (§8.4). |
