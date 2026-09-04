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

## 1b. No hardcoded user-facing strings — ever

If the app supports more than one language, **every string a user can see must come from the
translation layer.** This is not style guidance; a hardcoded string is a defect with three
distinct consequences:

1. **It never translates.** It stays in the authoring language forever, in every locale.
2. **It breaks direction.** A Latin string dropped into an RTL screen carries its own BiDi
   behaviour, so it reorders around the text near it (§4).
3. **It is invisible in review.** Nothing fails, nothing warns — the screen just renders
   the wrong language for users who never file a bug about it.

```jsx
// ❌ every one of these ships untranslated
<Text>Save</Text>
<Text>{`Order #${id}`}</Text>
<TextInput placeholder="Enter name" />
<Button title="Cancel" />
Alert.alert('Error', 'Something went wrong');
accessibilityLabel="Close"
navigation.setOptions({ title: 'Profile' })

// ✅
const { t } = useTranslation();
<Text>{t('common.save')}</Text>
<Text>{t('orders.number', { id })}</Text>
<TextInput placeholder={t('profile.namePlaceholder')} />
```

**The places routinely missed** — check all of them, not just `<Text>`:

`placeholder` · `title` · `label` · `accessibilityLabel` · `accessibilityHint` ·
`Alert.alert()` · `confirmText` / `cancelText` · navigation `title` and tab labels ·
validation and error messages · empty-state and loading copy · date/number formats ·
`Share.share()` · push-notification copy built on the client · `toast`/`snackbar` text.

**Interpolate, never concatenate.** Word order differs between languages, and concatenation
also creates the BiDi break in §4:

```jsx
// ❌ assumes English word order; also splits the number out of the sentence
<Text>{count} {t('items')} {t('remaining')}</Text>

// ✅ one key, the library places the value
<Text>{t('cart.remaining', { count })}</Text>   // "נותרו {{count}} פריטים"
```

Use the plural forms your i18n library provides rather than an `if (count === 1)` branch —
Hebrew, Arabic and Russian have plural categories English does not.

### Auditing an existing codebase

Hardcoded strings hide from review, so find them mechanically:

```bash
# JSX text nodes that are plain words
grep -rnE '>[A-Za-z][A-Za-z ]{2,}<' src/ --include=*.tsx

# string literals in the props that are most often forgotten
grep -rnE '(placeholder|title|label|accessibilityLabel|accessibilityHint)=("|\{")' src/ --include=*.tsx

# alerts built from literals
grep -rn 'Alert.alert(' src/ --include=*.tsx
```

Then enforce it so it cannot come back — `rtl/no-hardcoded-text` in the bundled lint plugin
(§9) flags literal user-facing strings in JSX and in the props above.

> When adding a language to an existing app, treat "no hardcoded strings" as a **precondition**,
> not a follow-up task. Direction work on top of untranslated copy produces screens that are
> correctly mirrored and still wrong.

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

// 3. What Yoga cannot infer — from the SAME state, never I18nManager:
const { isRTL, textAlign, textAlignInput } = useDirection();
<Icon style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />

// 4. textAlign: TWO rules, because the two elements behave OPPOSITELY (T30/T30b).
<Text style={{ textAlign }} />            // 'left' in BOTH directions — Yoga mirrors it
<TextInput style={{ textAlign: textAlignInput }} />  // physical — NOT mirrored
```

Implementation to copy: [`assets/direction.tsx`](assets/direction.tsx).

### ⚠️ `textAlign` is mirrored on `<Text>` and not on `<TextInput>`

The single sharpest trap in this file, because one hook value feeding both elements makes
the input look right while the label is wrong — and the input's correctness hides the error.

Measured inside one `direction: 'rtl'` island, same property, same value `'left'`:

| Element | Renders | Because |
| --- | --- | --- |
| `<Text>` | **right** (start edge) | resolved by Yoga, which mirrors it like `flex-start` |
| `<TextInput>` | **left** | resolved in the platform text widget, physical value survives |

So under `DirectionProvider`:

```jsx
<Text style={{ textAlign }} />                       // always 'left' — 'left' IS the start
<TextInput style={{ textAlign: textAlignInput }} />  // isRTL ? 'right' : 'left'
```

Writing `isRTL ? 'right' : 'left'` on a **`<Text>`** mirrors a second time and lands the text
on the wrong edge — the §1 double flip, in the one property §1 does not cover.

`textAlign: 'center'` has no start/end sense and is untouched by either mechanism.

**Never omit it on either element.** The defaults disagree three ways, measured on both
platforms:

| Element | Android default | iOS default |
| --- | --- | --- |
| `<Text>` | the island's direction | **always physically LEFT** |
| `<TextInput>` placeholder | the content, first-strong | **always physically LEFT** |
| `<TextInput>` value | the content, first-strong | the content, first-strong |

Only the last row agrees across platforms. **On iOS nothing moves a `<Text>` or a
placeholder off the left edge** — not the island, not the script, and not the app's own
direction: measured identical, to the pixel, in a natively forced-RTL build
(`isRTL=true`, whole app mirrored) and in a state-driven one. There is no iOS configuration
in which omitting the property is safe.

Three distinct bugs come out of that:

- An input with no `textAlign` aligns **per value**: the name field right, the email field
  left, and a field flips as the user types its first strong character. Two fields in one
  Hebrew form disagree with each other.
- A `<Text>` with no `textAlign` puts a Hebrew label on the **left edge on iOS**, while the
  same code is correct on Android — invisible to a Hebrew-only review done on Android.
- An **empty** Hebrew form renders its placeholders right on Android and **left on iOS**, so
  on iOS the screen looks broken before the user touches it, then each field snaps right as
  it is filled in.

For an **explicit** value there is no platform split: mirrored on `<Text>`, physical on
`<TextInput>`, on both platforms.

> **This applies only under a `direction` provider.** With `forceRTL` / app-language RTL
> nothing mirrors the property, and the physical value is correct on both elements. Both
> approaches produce "an RTL app"; only one mirrors `textAlign`. Know which lever you are
> pulling.

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
| `textAlign: 'start'` | **Not a valid RN value.** Silently ignored. Use `'left'`/`'right'` — and see §3 for which one, it differs between `<Text>` and `<TextInput>`. |
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
  'rtl/no-hardcoded-text': 'error',
  'rtl/require-bidi-isolate': 'warn',
}}];
```

Seven rules, unit-tested. Each error message names the measurement behind it.

`no-hardcoded-text` accepts options if the defaults are too broad or too narrow for a
codebase:

```js
'rtl/no-hardcoded-text': ['error', {
  props: ['placeholder', 'title', 'label', 'accessibilityLabel'],  // props to check
  ignore: ['testID'],                                             // props to skip
}]
```

It deliberately only flags strings that read like prose — two or more letters, not a
lowercase identifier, not a URL — so `testID`, style values and keys do not trip it.

---

## Triage — symptom to cause

| Reported symptom | Real cause |
| --- | --- |
| "RTL only works the second launch" | `forceRTL` needs a bundle reload — and on iOS never applies. Use §3. |
| "forceRTL does nothing on Android" | Check `android:supportsRtl="true"` in the manifest **first**. |
| "The icon points the wrong way" | Keyed off `I18nManager.isRTL`. Use `useDirection()`. |
| "Layout is flipped the wrong way" | A double flip — remove the direction ternary (§1). |
| "The `+` moved to the end of the phone" | BiDi weak character. Isolate the value (§4). |
| "Text is left on iOS, fine on Android" | Set `textAlign` explicitly from app state — the right one per element (§3). |
| "The label is on the wrong edge but the input next to it is fine" | One `textAlign` value fed both. `<Text>` is mirrored by the island, `<TextInput>` is not (§3). |
| "It was correct until I wrapped the app in DirectionProvider" | `textAlign` on `<Text>` now mirrors. Drop the `isRTL ?` ternary there (§3). |
| "The Hebrew label is on the left, but only on iOS" | No `textAlign` on that `<Text>`. On iOS the default is always physically left; Android follows the island (§3). |
| "The field jumps sides as the user types" | No `textAlign` on that `<TextInput>`. Its default is first-strong, so it follows the value (§3). |
| "The Hebrew form is left-aligned until you type, but only on iOS" | No `textAlign` on those inputs. On iOS a placeholder is always physically left; Android resolves it first-strong (§3). |
| "Blur only tints on Android" | Missing one of the four blur conditions (§7). |
| "The keyboard covers the input" | Edge-to-edge killed `adjustResize` (§6). |
| "It looks right on my device" | Not evidence. Read the code (§8.4). |
