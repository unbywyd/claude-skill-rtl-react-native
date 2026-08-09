# Verified Rules → Skill

Rules that survived measurement on real devices. **Nothing enters this file without
evidence.** Each rule carries what was measured, where, and what it changes for an agent.

Anything unverified stays in `TEST_PLAN.md` until a device settles it.

**Baseline:** Expo SDK 57 · RN 0.86.2 · Fabric · Galaxy S21 Ultra (Android 15) + Pixel 6 Pro emulator (API 34)

---

> **Note on evidence links.** This file references screenshots and test-plan entries by name.
> They live in the measurement harness, not in this skill:
> https://github.com/unbywyd/rtl-rn-test — see `harness/screenshots/` and `harness/RESULTS.md`.


## R1 · `I18nManager.isRTL` is unreliable — do not gate layout on it

**Status:** ✅ measured, 6 configurations, 2 devices

**What was measured:** the app rendered a fully mirrored RTL layout while
`I18nManager.isRTL === false`, in every configuration tried:

| Build | Device | System locale | Launch | Layout | `isRTL` |
| --- | --- | --- | --- | --- | --- |
| debug | emulator | en-US | 1st + cold | mirrored | `false` |
| release | emulator | en-US | fresh + cold | mirrored | `false` |
| release | emulator | he-IL | fresh | mirrored | `false` |
| release | **Galaxy S21 Ultra, Android 15** | ru-RU | 1st + cold | mirrored | `false` |

Native state proved the flag was actually set:
```xml
<boolean name="RCTI18nUtil_forceRTL" value="true" />
```

**Root cause (RN 0.86.2 source):**
- `I18nManagerModule.kt:26` computes `isRTL` at **native module construction**, before JS runs.
- `I18nManager.js` snapshots it once at module load and never re-reads it.
- `I18nUtil.kt:66` checks `Locale.getAvailableLocales()[0]` — an arbitrary JVM locale
  table entry, **not** the device's preferred locale.

**The exceptions are broken too — measured, not assumed.** In the Hebrew UI, the directional
arrow written as the textbook-correct
```jsx
transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }]
```
rendered **identical to the unflipped arrow** — both pointing right, in a right-to-left UI.
`isRTL` was `false`, so `scaleX` resolved to `1` and no flip occurred. The same screen showed
the `row-reverse` demo rows rendering identically for the same reason.

So `isRTL` fails in **both** roles at once:
- as a layout gate → produces LTR inside RTL (or masks a bug, see R1b),
- as the direction source for the *legitimate* exceptions → icons never flip,
  `textAlign` picks the wrong side, carousel indices are not inverted.

**Rule for the agent:**
> Never gate layout on `isRTL` — RN mirrors layout on its own, and the flag can be **wrong**.
> And for the cases that genuinely need a direction (directional icons, `TextInput.textAlign`,
> index math), **still do not read `I18nManager.isRTL`**. Derive direction from the app's own
> language state, which is the value the app actually decided:
> ```js
> const isRTL = ['he', 'ar'].includes(i18n.language);   // trustworthy
> // NOT: I18nManager.isRTL                              // startup snapshot, may be stale
> ```

**Third confirmation, in the one place `textAlign` is genuinely required.** In the Arabic
build, an input written as the textbook-correct
```jsx
textAlign: I18nManager.isRTL ? 'right' : 'left'
```
rendered its text **left-aligned inside an RTL app** — `isRTL` was `false`, so `'left'` won.
The "recommended fix" row and the "no textAlign" row looked identical.

This is the sharpest form of the problem: `<Text>` does not need `textAlign` at all (R12),
so `TextInput` is the **one** place the property matters — and it is exactly where reading
`I18nManager.isRTL` breaks it.

**Side-by-side proof, same screen, same property, only the source differs** (Arabic build,
`screenshots/t5-direction-compare.png`):
```
direction from language = true    ← trustworthy
I18nManager.isRTL       = false   ← stale
```
| Input | `textAlign` derived from | Result |
| --- | --- | --- |
| top | `I18nManager.isRTL` | text **left**-aligned in an RTL app ❌ |
| bottom | app language | caret on the **right** ✅ |

Two inputs, one line of difference. This is the clearest single demonstration in the whole
harness and should be the illustration used in the skill.

**Why this matters:** this is the strongest possible argument for the "don't touch RTL, it
already works" position — and it goes further than expected. Layout mirrored correctly *while
the flag said otherwise*, and every piece of code that trusted the flag was wrong.

---

## R2 · Apply a safe-area inset in exactly ONE place

**Status:** ✅ measured, Galaxy S21 Ultra (Android 15)

**What was measured:** the final card cleared the nav bar but left ~144dp of dead space
instead of ~96dp, because the bottom inset was applied twice:
```jsx
contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}  // once
<View style={{ marginBottom: insets.bottom }}>                  // again
```

**Two symmetrical failure modes, both bugs:**

| Mode | Symptom | Visibility |
| --- | --- | --- |
| Forgot the inset | content sits under the nav bar | loud, caught immediately |
| **Counted it twice** | large dead gap | **quiet, ships unnoticed** |

**Rule for the agent:**
> Apply each safe-area inset exactly once — normally in the scroll container's
> `contentContainerStyle`. An agent told merely "remember safe area" reliably produces the
> double-count. State the *single place*, not the reminder.

---

## R3 · `SafeAreaView` must come from `react-native-safe-area-context`

**Status:** ✅ verified in code; RN's own export is documented iOS-only

**Rule for the agent:**
> Import `SafeAreaProvider` and `SafeAreaView` from `react-native-safe-area-context`, never
> from `react-native` — RN's own `SafeAreaView` is iOS-only and a silent no-op on Android.
> Without `SafeAreaProvider` wrapping the tree, `useSafeAreaInsets()` returns zeros and
> every inset-aware layout silently degrades.

---

## R4 · `insets.left` / `insets.right` are PHYSICAL — they do not mirror

**Status:** ✅ verified on device (`left: 0 · right: 0` portrait; needs a landscape/notch
pass to show a visible difference)

**Rule for the agent:**
> Safe-area insets are physical screen edges and are **not** direction-aware. Mapping
> `insets.left → paddingStart` is correct in LTR and wrong in RTL. Map them through the
> current direction:
> ```jsx
> paddingStart: isRTL ? insets.right : insets.left,
> paddingEnd:   isRTL ? insets.left  : insets.right,
> ```
> This is one of the few places a direction check is genuinely required — and per R1, that
> check must not come from `I18nManager.isRTL`.

---

## R5 · Insets are dp, not pixels

**Status:** ✅ measured — `screen: 384×853 dp` on a physical 1080×2400 panel (density ≈ 2.8)

**Rule for the agent:**
> `insets.bottom: 48` is ~134 physical pixels at density 2.8. A small-looking inset number
> is a large visual band. Never dismiss an inset as negligible because the number is small.

---

## R6 · `textAlign` accepts no `start` / `end`

**Status:** ✅ verified in installed types, two RN versions

```ts
// RN 0.86.2 — types/public/ReactNativeRenderer.d.ts:630
textAlign?: 'auto' | 'left' | 'right' | 'center' | 'justify' | undefined;
```
Also absent in 0.81.5. Merged to RN `main` (PR #57201) but shipped in no release yet.

**Rule for the agent:**
> Use logical properties (`marginStart`, `paddingEnd`, `start`, `end`) for **layout**, but
> **never** write `textAlign: 'start'` — it is not a valid value and fails silently, leaving
> text on the wrong side. Use an explicit `'left' | 'right'` decision instead.
> This is the exact bug produced by mechanically applying the web CSS logical-property
> rewrite to React Native.

---

## R7 · `android:supportsRtl="true"` is a hard prerequisite

**Status:** ✅ verified in generated manifest + plugin output

Since RN 0.75, `I18nUtil.isRTL()` is gated on this flag as the outermost AND. Without it
`forceRTL` **silently no-ops** with no JS-visible signal. Expo's prebuild supplies it, and
the `expo-localization` plugin additionally writes:
```xml
<string name="ExpoLocalization_supportsRTL">true</string>
<string name="ExpoLocalization_forcesRTL">false</string>
```

**Rule for the agent:**
> When "forceRTL does nothing on Android" is reported, check `android:supportsRtl="true"`
> in the manifest **first**, before touching any JS. Also prefer the `expo-localization`
> config plugin over a hand-written AppDelegate patch — the plugin covers **both**
> platforms; a custom AppDelegate plugin is iOS-only and silently does nothing on Android.

---

## R8 · A reload mechanism is required — but `expo-updates` is NOT

**Status:** ✅ measured, Galaxy S21 Ultra, project deliberately built **without** `expo-updates`

**What was measured:** switching `en → he` in-app flipped the direction correctly. The app
reloaded once, came back in Hebrew, and rendered fully mirrored — header right-aligned,
tab bar running right-to-left. `package.json` contains no `expo-updates`.

The reload used `reloadAppAsync()`, re-exported from the core **`expo`** package
(`expo-modules-core`), documented to work in both release and debug builds.

**Rule for the agent:**
> `I18nManager.forceRTL()` writes a native flag; it does **not** re-lay-out the running JS
> context. The new direction applies only after the bundle reloads — this is the real cause
> of "RTL only works the second time the app opens".
>
> A reload mechanism is therefore **mandatory**, but `expo-updates` specifically is **not**.
> Prefer `reloadAppAsync()` from `expo`. Reload only when the direction actually changed:
> a same-direction switch (he → ar, en → ru) must be instant with no reload.
>
> Defer the reload past first mount (~250ms) — calling it during first render is a
> documented crash/no-op hazard (expo#10598, expo#21347).

**Corrects the prior guide**, which claimed the JS approach "cannot work" without
`expo-updates`. It can. The failing project was missing *any* reload mechanism, which is a
different diagnosis with a different fix.

**Confirmed by the app's own diagnostics** after an `en → he` switch:
```
en → he    directionChanged=true    strategy=expo-reloadAppAsync
```

### R8b · The restart-loop guard is MANDATORY, not defensive

**Status:** ✅ measured — the guard is visibly the only thing preventing an infinite loop.

Bootstrap diagnostics from a normal launch:
```
storedLanguage: "he"    resolvedLanguage: "he"
isRTLBefore: false      shouldBeRTL: true
flagFlipped: true       guardWasSet: true      needsRestart: false
```

Read that carefully. `isRTLBefore` is `false` and `shouldBeRTL` is `true`, so the standard
condition "flag disagrees with language → flip it and restart" is **true on every single
launch** — because `isRTL` never becomes `true` (R1). Only `guardWasSet: true` stopped this
launch from restarting again.

**Rule for the agent:**
> The common pattern *"if the direction flag disagrees with the language, forceRTL and
> reload"* is **self-perpetuating** on Android, because the flag never updates within the
> process. Without a persisted one-shot guard the app restarts forever and never leaves the
> splash screen.
>
> Always persist a guard, and prefer rendering once with a mismatched flag over looping:
> ```js
> if (I18nManager.isRTL !== shouldBeRTL) {
>   I18nManager.forceRTL(shouldBeRTL);
>   if (!(await getGuard())) { await setGuard(true); return { needsRestart: true }; }
> } else {
>   await setGuard(false);   // in sync → clear the stale guard
> }
> ```
> Better still: do not drive this off `I18nManager.isRTL` at all (R1) — compare against a
> direction you persisted yourself alongside the language.

---

## R9 · `adjustResize` does not survive edge-to-edge — the keyboard covers the input

**Status:** ✅ measured AND fix verified on device (Galaxy S21 Ultra, Android 15)

**What was measured:** tapping the input in T23 opened the keyboard **on top of the field**.
After applying the fix below and reinstalling, the focused field stays visible — confirmed
by the user on the same device. This rule is backed by a full broken → diagnosed → fixed →
verified cycle, not by reading documentation.
`dumpsys input_method` showed the contradiction precisely:
```
mInputShown=true          ← keyboard is open
mServedView=null          ← bound to no view
```
The manifest already had `android:windowSoftInputMode="adjustResize"`, and it was not enough.

**Why:** edge-to-edge is mandatory on Android 15. The window no longer resizes when the IME
appears, so RN never learns the keyboard's height and a plain `ScrollView` cannot scroll the
focused field into view. This is exactly the same failure family as safe-area insets: the
system stopped resizing the window, and layout must read insets instead.

**Rule for the agent:**
> On Android 15+, `windowSoftInputMode="adjustResize"` alone does **not** keep a focused
> input visible. Wrap the tree in `KeyboardProvider` and use `KeyboardAwareScrollView`
> (`react-native-keyboard-controller`), which reads real IME insets.
>
> Merely installing the package does nothing — **`KeyboardProvider` must wrap the tree**, the
> same silent-no-op trap as forgetting `SafeAreaProvider` (R3).
>
> Diagnostic: if `dumpsys input_method` reports `mInputShown=true` with `mServedView=null`,
> the IME is open but bound to nothing — a layout/provider problem, not an input problem.

**Generalisation worth stating in the skill:** Android 15 removed the two implicit
conveniences RN layouts historically leaned on — window fitting for system bars, and window
resizing for the keyboard. Both must now be handled explicitly through insets.

---

## R10 · A TextInput inside any nested scroller needs an explicit owner

**Status:** ✅ measured, 10-case matrix, Galaxy S21 Ultra (Android 15). Every case marked
"should work" passed; every case marked "likely fails" failed. The prediction was exact.

**Results:**

| # | Wrapper | Result |
| --- | --- | --- |
| 1 | Bare `View`, no scroll | ✅ works |
| 2 | Plain `ScrollView` | ❌ **fails** |
| 3 | `KeyboardAvoidingView` + `ScrollView` | ❌ fails |
| 4 | `KeyboardAwareScrollView` | ✅ works |
| 5 | `ScrollView` nested in `KeyboardAwareScrollView` | ❌ fails |
| 6 | Field at end of long content | ✅ works |
| 7 | `TextInput` in `FlatList` | ❌ fails |
| 8 | `TextInput` in `Modal` | ❌ fails |
| 9 | Plain `TextInput` in bottom sheet | ❌ fails |
| 9b | `BottomSheetTextInput` in bottom sheet | ✅ works |
| 10 | Multiline `TextInput` | ✅ works |

**The pattern:** exactly one actor must own scrolling the focused field into view. Three
can claim it and they conflict —
1. the **system** (`adjustResize`) — dead under edge-to-edge on Android 15,
2. **`ScrollView`**'s internal focus logic — unreliable, and lost entirely when nested,
3. a **keyboard-aware container** reading real IME insets — the only reliable one.

Failure happens when zero actors own it (case 2), when two fight (case 3), or when the
field sits in a scroller the aware-container does not control (cases 5 and 7).

**Rule for the agent:**
> Never leave a `TextInput` inside a bare `ScrollView`, a nested scroller, or a `FlatList`
> and assume the keyboard will be handled. Give the field an explicit owner:
> - normal screens → `KeyboardAwareScrollView` (`react-native-keyboard-controller`)
> - **do not** stack `KeyboardAvoidingView` around a `ScrollView` — they double-compensate
> - **never nest** a scroller inside the keyboard-aware container and put a field in it
> - `FlatList` with inputs → use the library's aware list, not a plain `FlatList`
> - `Modal` → it has its own window; give it its own keyboard handling
> - **bottom sheet → `BottomSheetTextInput`, never plain `TextInput`** (measured: the plain
>   one fails and the sheet-specific one works, in the same sheet, side by side)

**This is the most common real-world case:** production forms live in sheets and modals,
which is exactly where the plain component fails.

---

## R1b · The double-flip bug can be MASKED by the `isRTL` bug — and that is worse

**Status:** ✅ measured, Hebrew UI, Galaxy S21 Ultra

**What was measured:** in the T2 screen with the app in Hebrew, the deliberately-wrong row
(`justifyContent: isRTL ? 'flex-end' : 'flex-start'`) rendered at the **right** edge —
i.e. it *looked correct*, identical to the properly-written row beside it.

**Why:** `isRTL` read `false` (R1), so the ternary picked `flex-start`, which happens to be
the right answer. Two bugs cancelled out.

**Why this matters more than the plain double flip:**
> Wrong direction code can look correct on the device you are testing on, because the flag
> it depends on is itself wrong. It will start rendering incorrectly the moment `isRTL`
> becomes accurate — a different RN version, a different platform, or a device where the
> startup snapshot resolves `true`.

**Rule for the agent:**
> Do not treat "it looks right on my device" as evidence that direction-dependent code is
> correct. Code that branches on `isRTL` for layout is wrong **even when the screenshot
> looks fine** — verify by reading the code, not the render. The only safe layout code has
> no direction branch in it at all.

---

## R13 · Always set `placeholderTextColor` — and `TextInput` placeholders follow layout direction

**Status:** ✅ measured, Galaxy S21 Ultra (Samsung One UI), Arabic build

**Two findings from the same screen:**

**1. An unset `placeholderTextColor` can render invisibly.** With `backgroundColor` white and
no explicit `placeholderTextColor`, placeholders were **not visible at all** on this device.
That is not only cosmetic: an invisible placeholder hides where the text will actually sit,
which **masks RTL alignment bugs** and makes an empty field's caret position look wrong.

> Always set `placeholderTextColor` explicitly. The platform default is not reliable across
> OEM skins, and an invisible placeholder conceals alignment problems.

**2. Placeholders follow layout direction, with or without `textAlign`.** Both Arabic
placeholders (`أدخل الاسم`) rendered **right-aligned** — including in the field with **no**
`textAlign` at all. Consistent with R12.

### ⚠️ R13b · The `isRTL` bug is INVISIBLE on same-script content

The same screen showed the bug clearly in one place and not at all in another:

| Placeholder | Script | Broken field | Correct field |
| --- | --- | --- | --- |
| "broken when the flag is stale" / "follows the real direction" | **Latin** | left ❌ | right ✅ |
| `أدخل الاسم` | **Arabic** | right ✅ | right ✅ |

Arabic text right-aligns from layout direction regardless of `textAlign`, so a wrong
`textAlign` **changes nothing visible**. Latin text is neutral, obeys whatever `textAlign`
it is given, and therefore exposes the bug immediately.

**Rule for the agent:**
> Direction bugs hide on content written in the app's own script. A Hebrew app tested with
> Hebrew strings can look flawless while its `textAlign` logic is completely wrong — the bug
> only surfaces on Latin text, phone numbers, emails, IDs and codes.
>
> When verifying RTL, **always include opposite-script content in the test data.** Testing
> only with localized copy is how these bugs reach production.

**Caret in an empty RTL field looks misplaced but is correct.** The caret sits at the
position of the first character to come — i.e. at the right-hand edge of the placeholder text
— which reads as "floating in the middle" of an empty field. Typing confirms the behaviour is
right: text enters from the right and flows leftward.

> Do not "fix" a centred-looking caret in an empty RTL input. Verify by typing first; if the
> text enters from the correct edge, there is no bug.

---

## R14 · The `+` in a phone number moves to the END in RTL — `textAlign` does not fix it

**Status:** ✅ reproduced on device, Galaxy S21 Ultra, Arabic build

**What was measured:** typing `+74863963` into an RTL-aligned input rendered as:
```
74863963+          ← the + moved to the end
```

**The digits are NOT reordered** — `74863963` reads correctly. Only the sign moves. That is
what makes this bug dangerous: the number looks *almost* right, but `+972…` becomes `972+…`,
which is no longer a dialable number.

**Mechanism:** `+` is Unicode BiDi class **ES** (European Separator) — a *weak* character with
no direction of its own. It inherits the surrounding paragraph direction, so in an RTL context
it binds to the right-hand side and ends up trailing the digits.

**Critically, the field that showed this bug already had a correct `textAlign`.**
`textAlign` controls **block alignment**, not **character order within the string**. No amount
of alignment tuning fixes it.

**Rule for the agent:**
> A leading `+`, and any sign attached to a number, will migrate to the wrong end inside RTL
> text. `textAlign` cannot fix this — it aligns the block, not the characters.
>
> Isolate the value with BiDi marks:
> ```jsx
> const LRM = '‎';                       // LEFT-TO-RIGHT MARK
> const LRI = '⁦', PDI = '⁩';       // isolates — stronger, preferred
>
> <Text>{LRI}{phone}{PDI}</Text>              // renders +972 54-123-4567 correctly
> ```
> Apply this to **every always-LTR value rendered inside RTL text**: phone numbers, IBANs,
> order IDs, version strings, signed numbers, prices with a leading minus, and URLs.
>
> For `TextInput`, combine `textAlign: 'left'` (pin the block) with an LRM-prefixed
> placeholder — alignment and character order are two separate problems and both need solving.

**Before/after proven side by side** in the same section, same string
(`screenshots/t6-phone-ltr-fix.png`):

| Variant | Rendered |
| --- | --- |
| Plain, no LTR handling | `54-123-4567 972+` ❌ |
| `textAlign: 'left'` + LRM-prefixed placeholder | `+972 54-123-4567` ✅ |

The broken one is worse than "the plus moved": the `972` country group detached from the
front as well, producing a string that cannot be dialled. The fixed one is exactly correct.

### ⭐ iOS pass — three refinements (T7, iPhone 16 Pro Max, iOS 26.5.2)

**1. Reproduces on iOS. Research claiming otherwise is wrong.** Five value types were corrupted
inside Arabic text, in an **LTR** app:

| Type | `raw` | with isolate |
| --- | --- | --- |
| negative | `القيمة: 123.456-` | `القيمة: -123.456` |
| temperature | `القيمة: C°5-` | `القيمة: -5°C` |
| math | `القيمة: 25 = 13 - 12` | `القيمة: 12 - 13 = 25` |

**2. A bare LRM is NOT always enough — prefer the isolate.** For a price, LRM repaired the sign but
displaced the currency symbol:

| | Rendered |
| --- | --- |
| `raw` | `القيمة: 99.90- ₪` ❌ |
| `LRM` | `القيمة: ₪ -99.90` ⚠️ sign fixed, **`₪` on the wrong side** |
| isolate (`LRI…PDI`) | `القيمة: -99.90 ₪` ✅ |

> When the value carries its own non-digit symbol — currency, unit, percent — **use the isolate**.
> A bare LRM fixes the visible half of the bug and silently leaves the rest.

**3. The trigger is the surrounding CONTEXT, not the value.** The identical string `-123.456` is
safe after a Latin label (`raw:`) and corrupted after an Arabic one (`القيمة:`). Two consequences:

- **This happens in LTR apps.** "We don't support RTL" is not protection — one Arabic or Hebrew
  string with an interpolated number is enough.
- **A Latin-labelled test harness cannot see this bug.** Debug output like `value: -123.456` sets an
  LTR paragraph direction and neutralises it. Test values inside real translated sentences.
- `Intl.NumberFormat` output is **not** self-protecting; formatting does not make interpolation safe.

This confirms **both halves are required** — `textAlign` pins the block, the LRM fixes
character order. Neither alone is sufficient.

Email and URL values (`name@example.com`, `https://example.com/path?q=1`) rendered correctly
even unmarked, because they contain no weak signed characters — but the same rule applies,
since a leading `+`, `-` or a bare digit run can appear in IDs and codes.

**It is not a `TextInput` problem — plain `<Text>` corrupts identically.** Two `<Text>` nodes,
same string, only an LRM apart:
```
טלפון: 54-123-4567 972+      ← unmarked, CORRUPTED
טלפון: ‎+972 54-123-4567      ← LRM-marked, CORRECT
```

> This matters more than the input case. Read-only surfaces — order cards, contact lists,
> profile rows, receipts — render phone numbers next to RTL labels constantly, and none of
> them involve a `TextInput`. Wrap the value at the point of display, not just at the point
> of entry.

### How to build an LTR island with an icon — the actual recipe

A recurring practical question: *an icon beside a phone field must stay on the correct side; how do
you get that reversal reliably?*

**Why the common approach fails.** The usual `flexDirection: isRTL ? 'row-reverse' : 'row'` is keyed
off `I18nManager.isRTL`, which is `false` on iOS always and `false` on Android whenever the flag is
stale. The reversal is then **never requested** — it is not that the platform ignores `row-reverse`,
it is that the ternary chose plain `'row'`.

**Does `direction` affect `row-reverse`?** Yes. `direction` changes how Yoga resolves the main axis,
so a plain `'row'` inside `direction: 'rtl'` already runs right-to-left. Adding `row-reverse` there
flips it *back* to LTR — which is why stacking the two is so easy to get wrong.

**✅ Preferred — declare the island, no direction branch at all:**
```jsx
<View style={{ direction: 'ltr', flexDirection: 'row' }}>
  <PhoneIcon />                                                    {/* lands left */}
  <TextInput style={{ textAlign: 'left' }} placeholder={LRM + hint} />
</View>
```
Verified on both platforms (R16). It states the intent — *this subtree is LTR* — instead of
hand-tuning the axis, and it cannot break when a direction flag is wrong, because it reads none.

**⚠️ Acceptable — `row-reverse`, but from a trustworthy source:**
```jsx
const { isRTL } = useDirection();          // app state, NOT I18nManager
flexDirection: isRTL ? 'row-reverse' : 'row'
```
Works, but carries a branch that the first form does not need.

**❌ Never:** `flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row'`.

Remember the two problems stay separate: `direction` fixes **layout**, the LRM/isolate fixes
**character order** (R14). The phone still needs its BiDi mark inside an `ltr` island.

**T6c also confirmed the one legitimate `row-reverse` override:** an icon beside an
LTR-pinned phone field stayed visually adjacent to it, with the number rendering correctly.
That remains the single justified use of a manual direction flip in layout.

### R14b · The trigger is the surrounding text, and you must isolate the VALUE, not the line

**Status:** ✅ measured, T7 screen, Arabic build. This **refutes** RN issue #54713 as generally
stated, and corrects how the isolation must be applied.

**Signed numbers are NOT broken on their own.** Every triple below rendered identically and
correctly in raw, LRM and isolate form:
```
-123.456   ·   +42   ·   12 - 13 = 25   ·   -5°C   ·   -99.90 ₪   ·   -12.5%   ·   10-20
```
Each of those lines begins with a Latin label (`raw:`), which establishes an LTR context — so
the number is safe. RN #54713's claim that Android RTL reorders `-123.456` into `123.456-` did
**not** reproduce on RN 0.86.2 in that form.

**But the same value inside RTL text corrupts — and whole-line isolation does not save it.**
The sentence `הטמפרטורה היא -5°C היום` rendered as:
```
היום C‏הטמפרטורה היא 5°-
```
The minus detached and trailed `5°`, and the `C` jumped to the front, away from the `°`.
**All three variants failed**, because the LRM/isolate had been applied around the *entire
line* rather than around the *value*.

**Rule for the agent — this is the part that is easy to get wrong:**
> BiDi corruption is triggered by the **surrounding text**, not by the number itself. A signed
> value in a Latin-only string is safe; the same value beside an RTL word is not.
>
> Isolate the **value at its substitution point**, never the whole sentence:
> ```jsx
> // WRONG — isolating the line does nothing for a fragment inside it
> <Text>{LRI}הטמפרטורה היא -5°C היום{PDI}</Text>
>
> // CORRECT — isolate the value itself
> <Text>הטמפרטורה היא {LRI}-5°C{PDI} היום</Text>
> ```
> This is the same shape as the working phone fix, where the LRM sat immediately before the
> number. Build it into the formatting helper (`formatPrice`, `formatPhone`, `formatTemp`) so
> call sites cannot forget it.

**`Intl` output is correct but not protected.** `Intl.NumberFormat` produced `-99.90 ₪`
(he-IL), `-$99.90` (en-US) and `9.8.2026` (he-IL date) all correctly — signs in place, shekel
symbol on the correct side. But `Intl` returns an ordinary string with no BiDi marks, so it
corrupts exactly like any other value once placed inside RTL text.

> Do not assume `Intl` handles direction for you. Isolate its result at the substitution
> point like any other always-LTR value.

**This is the single most practically damaging RTL bug in the set**, because it silently
corrupts data users act on rather than merely misplacing pixels.

---

## R15 · Logical-property traps: silent no-ops and precedence

**Status:** ✅ all three measured, Arabic build, Galaxy S21 Ultra

**1. `borderInlineStartWidth` does not exist — and fails silently.**
```
borderInlineStartWidth: 8   → NO border rendered      ❌ silently ignored
borderStartWidth: 8         → border renders on right ✅
```
The `*Inline*` family covers margin and padding (`marginInlineStart`, `paddingInlineStart` —
both verified working, gap on the right in RTL), but **not borders**. Only
`borderStartWidth` / `borderEndWidth` exist. Writing the `Inline` form produces no error, no
warning, and no border.

Verified in **both** directions: the `Inline` border box rendered no border in Arabic *and* in
English, while `borderStartWidth` correctly drew on the right in RTL and on the left in LTR.
So the property is genuinely absent, not merely "unsupported in RTL".

> Do not extrapolate the `*Inline*` pattern to borders. Borders use `borderStartWidth` /
> `borderEndWidth` only.

**2. `start`/`end` silently beat `left`/`right`.**
```
start: 0 + left: 120   → hugs the right edge, left:120 ignored
end:   0 + right: 120  → hugs the left edge,  right:120 ignored
```
> When merging styles, a `left`/`right` override placed on top of a base style containing
> `start`/`end` becomes **dead code**. There is no warning. If a positioning override "does
> nothing", check whether a logical property is winning.

**3. `*Block*` is vertical and does not affect horizontal placement.** `marginBlockStart` ==
`marginTop`. Confirmed by comparing both directions: the box sat on the right in the Arabic
build and on the left in the English one — i.e. it followed ordinary layout mirroring and the
`Block` property contributed nothing horizontal, which is the correct behaviour.

**`*Inline*` confirmed in both directions**, which is the stronger form of the check:

| Property | RTL (Arabic) | LTR (English) |
| --- | --- | --- |
| `marginInlineStart: 40` | gap on the right | gap on the left ✅ |
| `paddingInlineStart: 40` | gap on the right | gap on the left ✅ |

**4. Absolute positioning with `start` works on Android.** `position start: 10` and
`position left: 10` both landed on the right in RTL — paper#3542's report of `start`/`end`
failing for absolute positioning **did not reproduce** here. iOS remains untested.

---

## R16 · The `direction` style prop WORKS on Android (Fabric) — use it for LTR islands

**Status:** ✅ measured on device, English (LTR) build, Galaxy S21 Ultra, RN 0.86.2 / Fabric.
**This settles research open question Q2**, which the source review could not resolve.

**What was measured**, three rows on one LTR page:

| Row | Rendered |
| --- | --- |
| page default (no `direction`) | `1 2 3` left-to-right ✅ |
| `direction: 'ltr'` island | `1 2 3` left-to-right ✅ (matches default, as expected in LTR) |
| **`direction: 'rtl'` island** | **`3 2 1`, 1 rightmost** ✅ |

The third row is decisive: the island genuinely overrode the page direction. The prop is
**not** a no-op on Android.

**Confirmed from both sides** — the Hebrew (RTL) build shows the complementary proof:

| Row | LTR build | RTL build |
| --- | --- | --- |
| page default | `1 2 3` | `3 2 1` |
| `direction: 'ltr'` island | `1 2 3` (matches default) | **`1 2 3` — overrides ⭐** |
| `direction: 'rtl'` island | **`3 2 1` — overrides ⭐** | `3 2 1` (matches default) |

Each direction proves the opposite island, so the prop is verified in both directions rather
than only in the case where it happens to agree with the page.

The conflicting evidence in the research corpus came from
[#41289](https://github.com/facebook/react-native/issues/41289), which is RN 0.68 and closed
as *Unsupported Version*. Under Fabric `direction` is parsed in shared C++, consistent with
this result.

**Re-verified under the R22c pattern (Android, state-driven RTL).** The original T10 run got its RTL
from `forceRTL`. Re-run with direction coming from **app state** instead (`he · isRTL=false ·
dir=rtl (state)`):

| Row | Rendered |
| --- | --- |
| page default (inherits the state-driven RTL) | `3 2 1` ✅ |
| **`direction: 'ltr'` island** | **`1 2 3` — overrides ⭐** |
| `direction: 'rtl'` island | `3 2 1` ✅ |

So `direction` **composes with** the R22c provider rather than competing with it: the provider sets
the app's direction from state, and a nested island still overrides it locally. That is the
mechanism for pinning always-LTR content — phone numbers, IBANs, order IDs, code — inside an
otherwise RTL screen, and it works with `isRTL` permanently `false`.

**Rule for the agent:**
> To pin a subtree to a fixed direction — an always-LTR block of phone numbers, IDs, code or
> version strings inside an RTL screen — prefer:
> ```jsx
> <View style={{ direction: 'ltr' }}>…</View>
> ```
> over the `flexDirection: isRTL ? 'row-reverse' : 'row'` workaround. It states intent, needs
> no direction check (and therefore cannot be broken by R1), and mirrors correctly.

**The two approaches were compared side by side in the Hebrew build, and they disagreed:**

| Approach | Rendered in RTL |
| --- | --- |
| `direction: 'ltr'` island | `1 2 3` — pinned LTR ✅ |
| `flexDirection: isRTL ? 'row-reverse' : 'row'` | `3 2 1` — **failed** ❌ |

The `row-reverse` workaround failed for the familiar reason: `isRTL` read `false`, so the
ternary chose plain `'row'` and ordinary mirroring applied. This is not a stylistic
preference — **`direction` is measurably more reliable**, because it carries no direction
check that R1 can poison.
>
> **Caveat:** `direction` changes Yoga layout resolution only. It does **not** change
> `I18nManager.isRTL`, and it does **not** fix BiDi character order inside a string — a phone
> number inside an `ltr` island still needs its LRM/isolate (R14).

---

## R17 · Shadows: `shadowOffset` is dead on Android, `boxShadow` is the cross-platform one

**Status:** ✅ measured, Hebrew build, Galaxy S21 Ultra, RN 0.86.2.
**This updates research finding C11, which is now outdated.**

| Property | Renders on Android? | Mirrors in RTL? |
| --- | --- | --- |
| `shadowOffset` / `shadowRadius` / `shadowOpacity` | **No** — both cards rendered flat | n/a |
| `elevation` | Yes — but symmetric, no horizontal component | nothing to mirror |
| **`boxShadow`** | **Yes** ✅ — clear directional offset | **No — manual correction needed** |

The two `shadowOffset` cards (`width: +10` and a direction-corrected one) were visually
identical and shadow-less, confirming the property is inert on Android — so "negate
`shadowOffset.width` for RTL" is a **no-op**, pure wasted work.

`boxShadow` did render, with a visible right-and-down offset distinct from `elevation`'s
symmetric shadow. Research finding C11 ("shadowOffset is iOS-only so RTL correction is
pointless") is only half right on RN 0.86: a cross-platform directional shadow now exists.

**But the direction-corrected `boxShadow` card looked identical to the uncorrected one** —
because the correction was written `isRTL ? -dx : dx` and `isRTL` read `false`. R1 again.

**Rule for the agent:**
> For a directional shadow that works on both platforms, use `boxShadow` (RN 0.76+ types;
> verified rendering on Android at 0.86.2). It does **not** mirror automatically — flip the
> horizontal offset yourself, using a trustworthy direction source (R1), never
> `I18nManager.isRTL`.
>
> Do not bother direction-correcting `shadowOffset`: it does not render on Android at all,
> so the correction is invisible there and only affects iOS.

---

## R18 · `@react-native-community/blur` crashes the screen on RN 0.86 / New Architecture

**Status:** ✅ measured — hard crash on device, Galaxy S21 Ultra, RN 0.86.2 / Fabric

```
java.lang.NoSuchMethodError: No virtual method
  setupWith(Landroid/view/ViewGroup;)Leightbitlab/com/blurview/BlurViewFacade;
  in class Leightbitlab/com/blurview/BlurView
    at com.reactnativecommunity.blurview.BlurViewManagerImpl.createViewInstance
    at com.facebook.react.fabric.mounting.SurfaceMountingManager.preallocateView
```

The RN wrapper calls a native `eightbitlab BlurView` method that does not exist in the
resolved version — the library has not been updated for current RN.

**Two things make this worse than an ordinary broken component:**
1. It throws inside Fabric's **`preallocateView`**, before render, so the **entire screen
   dies**, not just the blur.
2. It is a **native** `NoSuchMethodError` — no JS error boundary can catch it, and it cannot
   be surfaced as a graceful fallback.

**Rule for the agent:**
> On Expo SDK 57 / RN 0.86 with the New Architecture, use **`expo-blur`**. Do not add
> `@react-native-community/blur` — it crashes on view creation.
>
> More generally: a native module that has not shipped a New-Architecture-compatible release
> fails at **mount time with a native exception**, which no JS-side guard can contain. Check
> a library's New Architecture support before adding it, rather than discovering it on device.

---

## R19 · Blur on Android needs BOTH `blurMethod` AND `BlurTargetView` (Expo SDK 57)

**Status:** ✅ measured, three-way comparison on device, Galaxy S21 Ultra, Expo SDK 57 /
`expo-blur@57.0.2`

| Panel | Setup | Result at `intensity={50}` |
| --- | --- | --- |
| A | default | **tint only** — stripe edges stay sharp ❌ |
| B | `blurMethod` only | **tint only** — identical to A ❌ |
| C | target + ref + sibling | **real blur** — stripes become a soft gradient ✅ |

### The platform asymmetry, stated plainly

| | iOS | Android |
| --- | --- | --- |
| Panels that blurred | **almost all of them** | **only C** |
| `blurMethod` required? | no | **yes** (defaults to `'none'`) |
| `BlurTargetView` required? | no | **yes** |
| `blurTarget` ref required? | no | **yes** |
| `BlurView` must be a sibling? | no | **yes** |

**iOS forgives every one of the four requirements; Android enforces all four.** This is R20 running
in its usual direction — and it is why blur written and reviewed on a Mac ships to Android as a plain
translucent rectangle, with no error, no warning, and a screenshot that looks fine on the reviewer's
simulator.

> Write the **Android** shape (all four conditions). iOS accepts it unchanged. The reverse does not
> hold.

**Test at a MID intensity, not 100.** At `intensity={100}` the blurred panel turns into a
flat opaque slab, which is indistinguishable from a plain solid fill — during this session
that briefly produced a wrong conclusion in both directions. At `50` the answer is
unambiguous: **colours still distinguishable, edges fully smeared** is blur; sharp edges is
a tint; uniform fill proves nothing.

**FOUR requirements, all mandatory. Miss any one and you silently get a tint:**

1. **`blurMethod` defaults to `'none'` on Android:**
   ```ts
   /** Blur method to use on Android. @default 'none' @platform android */
   blurMethod?: 'none' | 'dimezisBlurView' | 'dimezisBlurViewSdk31Plus';
   ```
2. **A `BlurTargetView` must wrap the content to be blurred** (`ExpoBlurView.kt`):
   ```kotlin
   if (blurTarget == null || blurMethod == BlurMethod.NONE) { return }
   ```
3. **Its ref must be passed as `blurTarget`.** This is the only one that warns:
   ```
   W ReactNativeJS: You have selected the "dimezisBlurView" blur method, but the
   `blurTarget` prop has not been configured. The blur view will fallback to "none".
   ```
4. **The `BlurView` must be a SIBLING of `BlurTargetView`, not a child.** This was the last
   missing piece here — nesting it inside the target produced no warning and no blur, because
   blur cannot sample a tree it is itself part of.

```jsx
// ✅ correct on SDK 57 / Android — matches the official docs example
const targetRef = useRef<View>(null);

<View style={styles.wrap}>
  <BlurTargetView ref={targetRef} style={StyleSheet.absoluteFill}>
    <ContentToBlur />
  </BlurTargetView>
  <BlurView
    blurTarget={targetRef}          // 3
    blurMethod="dimezisBlurView"    // 1
    intensity={100}
    style={styles.panel}            // 4 — sibling, not nested
  />
</View>
```

Only requirement 3 emits a warning. The other three fail in complete silence.

**Version note — the API changed.** On **SDK 54** (`expo-blur@15`) the prop was
`experimentalBlurMethod` and no `BlurTargetView` existed; that setup blurs fine there. On
**SDK 57** `experimentalBlurMethod` is `@deprecated` and `BlurTargetView` is required. Code
that worked before an SDK upgrade **silently degrades to a tint** afterwards — no build error,
no runtime warning.

**Blur can only blur its own view tree.** This is why a blurred confirm overlay must live in
the same tree rather than inside a `Modal` — a `Modal` is a separate window, so there is
nothing behind it to sample. Same root cause as the `BlurTargetView` requirement: blur needs
an explicit source of pixels.

**Rule for the agent:**
> Never assume a blur is working because the component renders. On Android verify against a
> high-contrast backdrop — if edges behind the panel stay sharp, it is a tint, not a blur.
>
> Design so the layout still works when blur degrades to a flat translucent panel: check text
> contrast at `intensity={0}`. A design that is only legible *because* of the blur is relying
> on an effect that is not guaranteed.

---

## R11 · Three providers that silently do nothing if forgotten

**Status:** ✅ observed across this build

`SafeAreaProvider`, `KeyboardProvider` and `GestureHandlerRootView` share a failure mode:
install the package, use its components, and **nothing happens** — no error, no warning.
`useSafeAreaInsets()` returns zeros; keyboard-aware containers do not react; a bottom sheet
does not open.

**Rule for the agent:**
> When adding `react-native-safe-area-context`, `react-native-keyboard-controller` or
> `@gorhom/bottom-sheet`, wrap the root in the matching provider in the same edit.
> A missing provider produces silent misbehaviour, not a crash — so it is invisible in
> review and only shows up on device.

Related, verified here: on **Expo SDK 57** `babel-preset-expo` already includes the
reanimated/worklets babel plugin. Adding a hand-written `babel.config.js` for it **breaks
the bundler** (`Cannot read properties of undefined (reading 'transformFile')`). Do not
copy the old "add the reanimated plugin last" advice into a modern Expo project.

---

## R12 · On Android, text alignment follows LAYOUT DIRECTION — not text content

**Status:** ✅ measured, both halves, controlled probe strings. Galaxy S21 Ultra, Android 15,
RN 0.86.2 / Fabric.

**This refutes the most widely-cited claim about RN text alignment.** The RN 2016 blog says
*"In Android, the default text alignment depends on the language of the text content"*. On
this version it does not.

**Both halves, same device, no `textAlign` anywhere:**

| App language | String | Rendered |
| --- | --- | --- |
| `en` (LTR) | `שלום עולם` (pure Hebrew) | **left** |
| `he` (RTL) | `Hello world` (pure English) | **right** |

The text followed the app's **layout direction** in both cases, ignoring the script entirely.

**The first-strong probes settle it.** In the Hebrew app, all four rendered **right**,
identically to plain Hebrew:

| Probe | Rendered |
| --- | --- |
| `שלום עולם` (plain) | right |
| `123 שלום עולם` (digit-leading) | right |
| `iPhone שלום עולם` (Latin-leading) | right |
| `🚀 שלום עולם` (emoji-leading) | right |

If Android were using `TEXT_DIRECTION_FIRST_STRONG` with an LTR fallback, the digit-,
Latin- and emoji-leading strings would have gone **left**. They did not. There is no
content-based resolution happening here at all.

**Rule for the agent:**
> Do not repeat "Android aligns text by content, iOS by app bundle" — on RN 0.86.2 with
> Fabric, Android aligns by **layout direction**, exactly like a normal RTL-aware layout.
>
> The practical advice is unchanged and is what matters: **set `textAlign` explicitly**
> whenever a string's direction must not depend on the surrounding layout — always-LTR
> data such as phone numbers, emails, URLs, IBANs and code. Derive the value from the app's
> language state (R1), never from `I18nManager.isRTL`.

**Caveat:** iOS is not yet measured. The iOS half of this comparison is the main open item
for the Mac session, and the old claim may still hold there — but the Android half of it is
now disproven on current RN.

**Corollary measured in the same pass (T17): `writingDirection` does NOT control alignment.**
Two identical Hebrew strings, one with `writingDirection: 'rtl'` and one with `'ltr'`, no
`textAlign` on either, rendered **identically** (both right-aligned) on Android.

> Never offer `writingDirection` as an alternative to `textAlign`. It affects bidi ordering
> within a string, not the alignment of the block. `textAlign` is the only property that
> decides which edge text sits against.

Also confirmed here: an explicit `textAlign` **overrides layout direction** — a
`textAlign: 'left'` row stayed left-aligned inside the RTL screen. That is what makes it the
correct tool for always-LTR data.

---

## R20 · Platform asymmetry: iOS forgives what Android punishes — always write the intersection

**Status:** ✅ measured, iPhone 16 Pro Max (iOS 26.5.2) vs Galaxy S21 Ultra (Android 15)

**This is a meta-rule. It governs how every other platform-specific rule in this file should
be applied, and how an agent should weigh "it works on my device".**

**What was measured (T25, blur).** The same three variants, one screen, both platforms:

| Variant | Android | iOS |
| --- | --- | --- |
| A · bare `<BlurView intensity={50} />` | ❌ flat tint, stripes stay sharp | ✅ real blur |
| B · `blurMethod` set, no `BlurTargetView` | ❌ flat tint | ✅ real blur |
| C · `BlurTargetView` + `blurTarget` ref, sibling placement | ✅ real blur | ✅ real blur |

Evidence: `screenshots/t25-blur-ios.png` vs `screenshots/t25-blur-sibling-final.png`.

**The asymmetry.** iOS accepted **all three**. Android accepted **one**. So:

- Writing the pattern that passes on **iOS** yields code that is **broken on Android** — silently.
  No crash, no warning, no error; blur degrades to a flat tint that looks intentional in review.
- Writing the pattern that passes on **Android** yields code that works on **both**. The extra
  scaffolding is inert on iOS and costs nothing.

> **A green result on iOS is not evidence. A green result on Android usually is.**

**Consequences for an agent:**

1. **Write the strict variant unconditionally.** Do not branch on `Platform.OS` to strip the
   scaffolding the permissive platform does not need — the branch removes redundancy that was free
   and adds a path only one platform exercises.
2. **Never conclude "this works" from an iOS-only test.** When only one device is available and it
   is an iPhone, the honest status is *unverified*, not *passing*.
3. **When two patterns both render correctly, prefer the one with no failure mode on either
   platform** — not the shorter one. Breadth of "what seems to work" is a property of the permissive
   platform, not of the pattern.

**This generalizes past blur.** The same shape appears in T27 §4: `verticalAlign` is documented
`Android`, and on iOS it is a **silent no-op** — `top`, `middle` and `bottom` render identically.
The style is accepted, so it reads as working. Same failure class as `borderInlineStartWidth`
(R15) and `writingDirection` (R13): accepted, inert, invisible in review.

**The inverse trap — do not overcorrect.** "Permissive" describes *which platform silently swallows
a wrong pattern*, **not** which platform has fewer bugs. iOS has failures Android does not:
vertical centring lost through an `absoluteFill` wrapper (R21), and `lineHeight ≤ fontSize`
clipping glyph tops (T27 §2). **Both platforms remain mandatory for coverage.** The asymmetry is
about which platform can *falsify* a pattern — only the strict one can.

### Three failure shapes — each needs a different defence

Measured examples, in increasing order of how hard they are to catch:

| Shape | Example | Detected by |
| --- | --- | --- |
| **Works vs broken** | T25 blur: iOS blurs on all three variants, Android only on one | Testing on the **strict** platform |
| **Silent no-op** | T27 §4 `verticalAlign` on iOS: `top`/`middle`/`bottom` identical | Knowing the **docs' platform tag** — nothing at runtime says a word |
| **Works differently** | T24 §10: a multiline `TextInput` lifts the whole field on Android, but only to the **caret** on iOS — one visible row | **Side-by-side comparison of the same interaction.** Nothing else finds it |

The third shape is the reason a cross-platform harness exists at all. Both platforms *pass*; a
screenshot from either one looks correct in isolation; code review sees a config that is obviously
right. It surfaces only as a user complaint. Concretely: `bottomOffset` on
`KeyboardAwareScrollView` is measured from the **caret**, not the field's bottom edge — identical for
single-line inputs, divergent the moment the field is taller than one line.

> When a prop's effect depends on a measurement (caret vs element, content vs container), assume the
> two platforms measure from different anchors until a side-by-side test says otherwise.

---

## R21 · `justifyContent` reaches direct children only — any wrapper silently breaks centring

**Status:** ✅ measured, iOS 26.5.2 (Android column pending)

**What was measured (T27 §1).** Three fixed-height boxes, all with `justifyContent: 'center'`.
Only the wrapper between the box and the text differs:

| | Structure | Result |
| --- | --- | --- |
| A | `<View center><Text/></View>` | ✅ centred |
| B | `<View center><View absoluteFill><Text/></View></View>` | ❌ **pinned to the top** |
| C | `<View center><View absoluteFill center><Text/></View></View>` | ✅ centred |

Evidence: `screenshots/t27-lineheight-ios-1.png`. Found in the wild first — it is why the T25
blur screen's control text sits at the top of block C but is centred in blocks A and B.

**Why.** `justifyContent` is **not inherited**. It positions a flex container's *direct children*.
An inserted wrapper becomes the only direct child — it already fills the box, so centring it is a
no-op — and the wrapper itself declares no alignment, so the text falls to the cross-axis start.

`StyleSheet.absoluteFill` is the usual culprit: it reads like a transparent pass-through but is a
full flex container.

**The trap that makes this survive review:** the text usually already has
`textAlign: 'center'`, which reads as "this text is centred". It governs the **horizontal** axis
only and does nothing for the vertical one.

```jsx
// ❌ centring never reaches the text
<View style={{ justifyContent: 'center' }}>
  <View style={StyleSheet.absoluteFill}>
    <Text style={{ textAlign: 'center' }}>label</Text>
  </View>
</View>

// ✅ every flex container that has a child to place declares its own alignment
<View style={{ justifyContent: 'center' }}>
  <View style={[StyleSheet.absoluteFill, { justifyContent: 'center' }]}>
    <Text style={{ textAlign: 'center' }}>label</Text>
  </View>
</View>
```

> When adding a wrapper — an `absoluteFill` overlay, a gesture/animated container, a
> `BlurTargetView` — check whether it just orphaned the alignment of everything beneath it.

**Related — vertical centring in buttons and inputs (T27 §3–§5).** Measured on iOS:

- `justifyContent` on the direct parent — ✅ works, no caveat, the method to standardise on
- `lineHeight` equal to box height — ✅ centred exactly, but the same property **clips** when set at
  or below `fontSize` (§2), so it carries a failure mode flexbox does not
- `verticalAlign` / `textAlignVertical` — ❌ Android-only, silent no-op on iOS
- `paddingVertical: 0` on a fixed-height `TextInput` — ⚪ no-op; the field was already centred

⚠️ Per R20, §3 and §5 measured **iOS only**, where several methods appeared to work. Until the
Android pass runs, treat everything except `justifyContent` as **unverified**.

See **R21b** for the clipping side of this, which is a separate failure with its own trigger.

---

## R21b · `lineHeight ≤ fontSize` clips text — and translation is what triggers it

**Status:** ✅ measured, iOS 26.5.2 / iPhone 16 Pro Max (T27 §2). Android column pending.

This is the single most common iOS text complaint — *"the text is cut off"* / *"the button label is
missing its accents"* — and it is not a font bug or a platform quirk. It is a `lineHeight` that is
too small for the glyphs it has to contain.

**What was measured.** `fontSize: 16` in every row, tinted background so the real text box is
visible, string `Ág Q pçy — שלום` (Latin ascenders, descenders, an accent, and Hebrew):

| `lineHeight` | Result |
| --- | --- |
| unset | ✅ clean — the box grows to fit |
| **16** — *equal* to `fontSize` | ❌ **the acute on `Á` is cut** |
| **12** — below `fontSize` | ❌ **badly clipped**: accents gone, Hebrew tops sliced |
| 28 | ✅ clean |

Evidence: `screenshots/t27-lineheight-ios-1.png`.

**Why `lineHeight: fontSize` is not "tight but safe".** `fontSize` describes the em size, not the
ink. Ascenders, accents and descenders live **outside** it. Setting `lineHeight` equal to `fontSize`
leaves zero room for them, so they are clipped — and English lowercase without accents usually
survives, which is exactly why the bug ships.

**The i18n trigger — this is why the rule belongs in an RTL guide.** Hebrew and Arabic glyphs are
**taller** than Latin at the same `fontSize`. A `lineHeight` tuned against `Save` can clip once the
same label becomes `שמור`. The bug appears **at translation time**, in a build nobody re-reviewed,
in a language the reviewer may not read.

```jsx
// ❌ clips accents and Hebrew — the classic "tight line height"
{ fontSize: 16, lineHeight: 16 }

// ❌ worse, and it is what "make it more compact" produces
{ fontSize: 16, lineHeight: 12 }

// ✅ leave room for ink outside the em box
{ fontSize: 16, lineHeight: 24 }        // ~1.4-1.5x is a safe default
{ fontSize: 16 }                         // or omit it — the box grows to fit
```

> **Rule:** never set `lineHeight` at or below `fontSize`. If a design needs tight text, ~1.3× is the
> floor, and it must be checked against the **tallest script the app ships**, not against English.
> Omitting `lineHeight` entirely is always safe — the text box sizes itself.

**Do not reach for `lineHeight` to centre text vertically.** It does centre exactly when set equal to
the box height (T27 §3), but it is the same property that clips when it is small — so it carries a
failure mode `justifyContent` does not have. Centre with `justifyContent` on the direct parent
(R21); use `lineHeight` for line spacing only.

**Related, same screen:** with `numberOfLines={2}` and `lineHeight: 14` the two lines **overlapped
vertically** (T27 §6) — tight line height breaks multi-line text before it breaks single-line text.

### ✅ Truncation needs no RTL handling — the `…` follows the text

Measured on iOS (T27 §6b, `numberOfLines={1}` in a 180dp box, `screenshots/t27-ellipsis-ios.png`):

| String | Text hugs | Ellipsis |
| --- | --- | --- |
| Hebrew | right | **left** ✅ |
| English | left | **right** ✅ |
| Mixed | — | at the reading end of the run ✅ |

The ellipsis is placed from the **paragraph direction of the string itself**, not from a fixed
physical side and not from the app's direction flag — it was correct while the layout was LTR and
`isRTL === false`. Same mechanism as default text alignment (R12) and bidi reordering (R14).

> Do **not** special-case truncation for RTL. No `textAlign`, no `isRTL`, no per-language branch.
> Any code that "fixes" the ellipsis side is fixing something that already works, and will break it.

⚠️ Android column pending — per R20 this is an iOS-only measurement so far.

---

## R21c · Never centre text with `lineHeight = container height` — Android-only accident

**Status:** ✅ measured on BOTH platforms — the comparison is the finding

A fixed-height box (48) with the text centred three different ways:

| Method | Android | iOS |
| --- | --- | --- |
| `justifyContent: 'center'` on the direct parent | centred ✅ | centred ✅ |
| **`lineHeight: 48`, no flex centring** | **centred exactly ✅** | **NOT centred ❌** |
| both together | centred ✅ | centred ✅ |

`lineHeight` sets baseline-to-baseline distance. Android distributes the extra leading symmetrically
around the glyph box, so the text happens to land centred; iOS does not, leaving it off-centre inside
the same 48pt line.

**Note the direction of the asymmetry.** Most findings in this harness had **iOS** as the forgiving
platform (R20); this one is the reverse. That is exactly why an asymmetry must be measured per case
and never assumed from a previous result.

**Third instance, found by accident in the blur test.** In T25 the backdrop text sat centred in
panels A and B but was **pinned to the top in panel C** — the only structural difference being that C
places the content inside a `BlurTargetView`. The container had `justifyContent: 'center'`, but the
`BlurTargetView` in between is a new flex container that inherits none of it. Any inserted
wrapper — a blur target, an `absoluteFill`, a provider that renders a `View` — re-triggers this.

**Rule for the agent:**
> Centre text vertically with **`justifyContent: 'center'` on the direct parent** — the only method
> verified on both platforms. Never use `lineHeight` equal to the container height as a centring
> mechanism: it is an Android-only coincidence that ships broken on iOS.
>
> And remember `justifyContent` does not inherit (R21) — if any wrapper sits between the box and the
> text, the wrapper needs its own.

---

## R22 · Do not drive direction from `forceRTL` + reload — drive it from app state

**Status:** ✅ measured on both platforms, and this is the rule that unifies them

**Scope of the iOS failure — settled by T18.** The dev-client result was reproduced on a **Release
build with Metro killed and the app freshly installed**: still `isRTL=false`, still an LTR layout.
So this is **not** a development-only artifact — `forceRTL` + `reloadAppAsync()` has **no working
configuration on iOS** in this harness, despite RN#49455's fix being present in 0.86.2.
(Unmeasured here: `Updates.reloadAsync()` from **expo-updates**, a full host relaunch, which the
community reports working. The failing ingredient is plausibly the reload mechanism, not `forceRTL`.)

**The problem, measured.** The conventional pattern — `I18nManager.forceRTL(shouldBeRTL)` followed by
a reload, protected by a one-shot guard — **fails differently on each platform**:

| | Android | iOS |
| --- | --- | --- |
| Flip applied after reload? | ✅ yes | ❌ **no** |
| `isRTL` afterwards | `false` **while the layout is mirrored** (the flag lies) | `false` **and the layout really is LTR** |
| Net effect | works, but the flag cannot be trusted | **never reaches RTL at all** |

On iOS this was isolated to a single step. With the language persisted and the guard freshly written,
a clean `he → en → he` cycle reported `flagFlipped: true`, ran `reloadAppAsync()`, and came back with
`isRTL: false` and an LTR layout. `forceRTL` does not survive a JS reload there — plausibly because it
writes `NSUserDefaults` (`AppleTextDirection`), which UIKit reads when the window is created, and a
dev reload never recreates the window.

**So the pattern has no portable form.** One platform needs the reload and lies about the flag; the
other ignores the flip entirely. Any code branching on `Platform.OS` here is encoding two bugs.

### The fix: `direction` from app state

`direction` is the one direction primitive **measured working on both platforms** (R16 on Android,
T10 on iOS). On iOS it produced a mirrored layout inside a process where `isRTL === false` and
`forceRTL` had already failed — it does not depend on the broken machinery at all:

```jsx
// ONE source of truth: the app language. No global flag, no reload, no guard.
const dir = isRTLLanguage(lang) ? 'rtl' : 'ltr';

<View style={{ direction: dir, flex: 1 }}>
  {/* logical properties inside mirror against `dir` */}
</View>
```

- applies **instantly** on language change — no restart, no splash, no guard, no restart-loop risk
- identical on both platforms
- `isRTL` is never consulted, so its unreliability stops mattering

### The one caveat — measured, and it matters

**`isRTL` does NOT follow `direction`.** Inside a `direction` island the flag keeps its app-level
value (T10, confirmed on screen: *"Inside an ltr island, isRTL still reads: false"*). Anything keyed
off `isRTL` — mirrored icons via `scaleX`, `textAlign` chosen by ternary, `row-reverse` overrides —
**will not follow the island** and will point the wrong way inside it.

So `direction` and `isRTL` are two independent sources of truth that can silently disagree. Derive
everything from **one** place — the language — and be explicit inside islands:

```jsx
// ✅ both derived from `lang`, never from I18nManager
const dir  = isRTLLanguage(lang) ? 'rtl' : 'ltr';
const flip = isRTLLanguage(lang) ? -1 : 1;

<View style={{ direction: dir }}>
  <Text style={{ textAlign: dir === 'rtl' ? 'right' : 'left' }}>{label}</Text>
  <Icon style={{ transform: [{ scaleX: flip }] }} />
</View>
```

### Where `forceRTL` is still needed

Keep it **only** for what genuinely requires the native flag — first-frame direction before JS runs,
and system-level UI. Use the `expo-localization` plugin props rather than a hand-written AppDelegate
patch:

```jsonc
["expo-localization", { "supportsRTL": true, "forcesRTL": false }]
```

> **Rule:** direction is application state, not a native global. Render it like any other state.
> Reach for `forceRTL` only for the first frame, and never make correctness depend on a reload.

**Ecosystem confirmation.** This failure class is [RN#48311](https://github.com/facebook/react-native/issues/48311),
officially fixed by [PR#49455](https://github.com/facebook/react-native/pull/49455) (`_updateLayoutContext`
on surface recreation, 0.76+) — the fix code is **present in 0.86.2 and the bug still reproduces** in
the Expo dev client; [expo#39752](https://github.com/expo/expo/issues/39752) is open on SDK 54 with the
same symptom. The community's working answers are (a) `Updates.reloadAsync()` from **expo-updates** — a
full host relaunch, works in production but needs expo-updates and still restarts the app — and
(b) the [expo-rtl](https://dev.to/ibrahimtarhini01/why-does-react-native-make-you-restart-the-app-just-to-switch-language-i-fixed-it-2pn2)
package, which drops the native flag and propagates direction via React context + JS style flipping —
the same architecture as this rule, one layer higher. Convergent evolution: everyone who solves
runtime RTL switching ends up **not using the native flag as the source of truth**.

✅ **Both directions now verified on iOS (T29).** An `rtl` island inside an LTR page mirrors (T10),
and a `direction: 'ltr'` island inside a genuinely RTL page pins its content LTR — measured with the
page itself RTL from a `DirectionProvider`, the island reading `1·2·3` while its surroundings read
`3·2·1`. Matches Android, where both directions were already verified.

✅ **Runtime updates work — no remount required.** Mutating `direction` on an already-mounted node
applies immediately (T29 row G). A `key={dir}` remount is **not** needed; this is the one place
`direction` behaves *better* than `forceRTL`, which does require surface recreation.

---

### R22b · Android cross-check of the placement question (T29)

**Status:** ✅ measured on Android — Galaxy S21 Ultra, Android 15, `dir=ltr (state)`

The iOS session found that wrapping the app in `<View style={{direction}}>` flipped nothing and
inferred that a `ScrollView` blocks inheritance. Android was then measured against the same
five-placement probe:

| Row | `direction: 'rtl'` applied to | Android |
| --- | --- | --- |
| **D** | the `ScrollView` itself | **`3 2 1` — flips ✅** |
| **E** | the `ScrollView`'s `contentContainerStyle` | **`3 2 1` — flips ✅** |
| F | nowhere (baseline) | `1 2 3` ✅ |

**On Android a `ScrollView` does NOT block inheritance** — both placements work. Note the app was in
English (`dir=ltr (state)`) while rows A–E still read `3 2 1`, confirming a statically-declared `rtl`
island overrides the page direction regardless of app language.

> **Portable placement:** put `direction` on the **`contentContainerStyle`** of the screen's scroll
> container (row E), which is measured working on both platforms, rather than relying on inheritance
> from a distant ancestor. This is the placement the `DirectionProvider` in
> [`src/lib/direction.tsx`](src/lib/direction.tsx) is built around.

---

## R22c · THE WORKING RECIPE — copy this

Everything above condenses to one pattern, verified on **Android 15** and **iOS 26.5.2**, RN 0.86.2 /
Fabric, in both directions, with a runtime language switch and no reload.

```jsx
// 1. Wrap the app once. Direction comes from app state — never from I18nManager.
<DirectionProvider lang={lang}>
  <App />
</DirectionProvider>

// 2. Inside, write plain logical values. Yoga mirrors them. No isRTL anywhere.
<View style={{ flexDirection: 'row', justifyContent: 'flex-start', marginStart: 16 }} />

// 3. Only two things Yoga cannot infer — take them from the SAME state, via the hook:
const { isRTL } = useDirection();
<Icon style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />   // directional icons
<TextInput style={{ textAlign: isRTL ? 'right' : 'left' }} />  // input alignment

// 4. Always-LTR values keep their bidi isolation, independently of all the above:
<Text>{'⁦'}{phone}{'⁩'}</Text>                        // +972 54-123-4567
```

**What this replaces**

| Old pattern | Why it is abandoned |
| --- | --- |
| `I18nManager.forceRTL()` + reload | No working configuration on iOS (T18, Release build). On Android it works but `isRTL` then lies. |
| `I18nManager.isRTL` for icons/`textAlign` | Reads `false` on Android while mirrored; never becomes `true` on iOS. Wrong on both. |
| `isRTL ? 'row-reverse' : 'row'` | Double flip when the flag is right, silent no-op when it is wrong. |
| `key={dir}` remount on language change | Unnecessary — `direction` applies on a live node with no remount (T29 row G). |

**What stays**

- `forceRTL` in **`app.json`** only (`expo-localization` plugin), for the very first frame before JS runs.
- A language switch that reloads **only** when the direction changes — still correct, still cheap.
- BiDi isolation on every always-LTR value. Orthogonal to direction, and required regardless.

**Cost:** one provider at the root, one hook at two call sites per screen. That is the whole thing.

---

## R23 · Enforce these rules with a linter, not with discipline

**Status:** ✅ implemented and tested in this repo — [`tools/eslint-plugin-rtl/`](tools/eslint-plugin-rtl/index.js)

Every RTL failure measured in this repo is **silent**: no crash, no warning, and the wrong branch
usually renders as a plausible layout. Code review does not catch them (a `textAlign: 'center'` that
governs the wrong axis reads as correct); single-platform QA does not catch them (R20); and an LLM
following prose guidance forgets them the moment the context scrolls away. A linter catches all of
them before the app runs, on both platforms at once.

```bash
npm run lint:rtl         # check the project
npm run test:rtl-rules   # self-test the rules themselves
```

| Rule | Catches | Measured in |
| --- | --- | --- |
| `no-isrtl` | any read of `I18nManager.isRTL` | R1 (Android: flag lies) · T2 (iOS: flip never applies) |
| `no-physical-styles` | `marginLeft`/`paddingRight`/`left`/`right`… — **auto-fixable** | R15 |
| `no-dead-logical-props` | `borderInlineStartWidth` (does not exist), `verticalAlign`/`textAlignVertical` (Android-only, silent no-op on iOS) | T8 · T8c · T27 §4 |
| `no-direction-ternary` | `flexDirection: isRTL ? 'row-reverse' : 'row'` — **the double flip** | T2 |
| `require-bidi-isolate` | a value interpolated into RTL text with no isolate | R14 · T7 |

**Verified working:** the five rules have RuleTester unit tests (valid + invalid cases), and a canary
file containing all seven bad patterns produces exactly seven diagnostics. Running it against this
repo surfaced only intentional uses, each now carrying an explicit
`// eslint-disable-next-line rtl/no-isrtl` with a reason — which is the point: the exceptions become
**visible and justified** instead of indistinguishable from mistakes.

**Deliberately exempt:** `src/screens/**`. Those screens render the wrong patterns on purpose — they
are the fixtures that produced the measurements.

**Why this belongs in the skill.** Prose rules degrade: an agent writing a screen 40 turns later has
lost the context. A lint error is re-delivered at exactly the moment the wrong line is written, with
the measurement that justifies it in the message text. Ship the plugin alongside the guidance — the
guidance explains *why*, the linter enforces *always*.

---

## Pending — measured but not yet conclusive
- **Fabric reload fix** present in both 0.81.5 and 0.86.2 (`_updateLayoutContext` count 4).
- **`boxShadow`** exists cross-platform in 0.86 types — the "shadowOffset is iOS-only"
  research finding may be stale. Not yet visually confirmed.
