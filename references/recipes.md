# RTL Recipes — copy-paste patterns

Every pattern here is measured working on **Android 15** and **iOS 26.5.2**, RN 0.86.2 /
Expo SDK 57 / Fabric. See [`rules.md`](rules.md) for the evidence.

---

## 1. App setup — direction from state

```jsx
// App.tsx
import { DirectionProvider } from './lib/direction';

export default function App() {
  const { i18n } = useTranslation();
  return (
    <DirectionProvider lang={i18n.language}>
      <YourApp />
    </DirectionProvider>
  );
}
```

Copy [`../assets/direction.tsx`](../assets/direction.tsx) into `src/lib/`.

**`app.json`** — keep native RTL only for the first frame before JS runs:

```jsonc
{
  "expo": {
    "plugins": [
      ["expo-localization", { "supportsRTL": true, "forcesRTL": false }]
    ]
  }
}
```

Set `forcesRTL: true` only for a single-language RTL app. It covers **both** platforms —
a hand-written AppDelegate config plugin is iOS-only and does nothing on Android.

---

## 2. Ordinary layout — no direction logic at all

```jsx
// ✅ mirrors automatically in both directions
<View style={{
  flexDirection: 'row',
  justifyContent: 'flex-start',   // = right edge in RTL
  alignItems: 'center',
  marginStart: 16,
  paddingEnd: 8,
  borderStartWidth: 2,
}} />
```

```jsx
// ❌ every one of these is a bug
<View style={{ flexDirection: isRTL ? 'row-reverse' : 'row' }} />
<View style={{ justifyContent: isRTL ? 'flex-end' : 'flex-start' }} />
<View style={{ marginLeft: 16 }} />
```

---

## 3. The two legitimate uses of a direction value

```jsx
const { isRTL } = useDirection();   // from app state, NOT I18nManager

// Directional icons — opaque pixels, RN cannot know where they point
<Arrow style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />

// TextInput alignment — the ONE place textAlign is genuinely required
<TextInput style={{ textAlign: isRTL ? 'right' : 'left' }} />
```

Plain `<Text>` needs no `textAlign` — it follows layout direction on its own.

Also needs the direction value: carousel/slider index math, `scrollToOffset`, and any
place a *visual* position is derived from an array index.

```jsx
const visibleIndex = isRTL ? total - 1 - rawIndex : rawIndex;
```

---

## 4. LTR island — phone field with an icon

The recurring practical case. **Preferred form, no direction branch:**

```jsx
<View style={{ direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
  <PhoneIcon />
  <TextInput
    style={{ flex: 1, textAlign: 'left' }}
    placeholder={'‎' + '+972 54-123-4567'}
    keyboardType="phone-pad"
  />
</View>
```

`direction: 'ltr'` states the intent and reads no flag, so it cannot break. Verified
composing correctly *inside* a state-driven RTL page.

**Acceptable alternative** — `row-reverse`, but only from a trustworthy source:

```jsx
const { isRTL } = useDirection();
<View style={{ flexDirection: isRTL ? 'row-reverse' : 'row' }}>
```

**Never:** `flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row'`.

> `direction` changes how Yoga resolves the main axis — a plain `'row'` inside
> `direction: 'rtl'` already runs right-to-left, and adding `row-reverse` flips it *back*.
> Do not stack the two.

---

## 5. BiDi isolation — always-LTR values

```js
export const LRM = '‎';   // mark
export const LRI = '⁦';   // isolate — stronger, preferred
export const PDI = '⁩';

export const ltr = (v) => `${LRI}${v}${PDI}`;
```

```jsx
// ✅ isolate the VALUE at its substitution point
<Text>טלפון: {ltr(phone)}</Text>
<Text>הטמפרטורה היא {ltr('-5°C')} היום</Text>

// ❌ isolating the whole line does nothing for a fragment inside it
<Text>{ltr(`הטמפרטורה היא -5°C היום`)}</Text>
```

Apply to: phone numbers, emails, URLs, IBANs, order IDs, version strings, signed numbers,
prices with a leading minus, and `Intl` output (which returns a plain string with no marks).

Bake it into the formatter so call sites cannot forget:

```js
export const formatPhone = (raw) => ltr(prettyPhone(raw));
export const formatPrice = (n, cur) => ltr(new Intl.NumberFormat(loc, {…}).format(n));
```

---

## 6. Safe area

```jsx
// Root — the provider is mandatory, or insets are all zero
<SafeAreaProvider>
  <SafeAreaView edges={['top', 'left', 'right']}>…</SafeAreaView>
</SafeAreaProvider>
```

Import `SafeAreaView` from **`react-native-safe-area-context`**, never from `react-native`
(RN's own is iOS-only and a no-op on Android).

```jsx
// Apply each inset in exactly ONE place — normally the scroll container
<ScrollView contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}>
```

Insets are **physical** and do not mirror:

```jsx
const { isRTL } = useDirection();
paddingStart: isRTL ? insets.right : insets.left,
paddingEnd:   isRTL ? insets.left  : insets.right,
```

Values are **dp**: `insets.bottom: 48` is ~134 physical px at density 2.8.

---

## 7. Keyboard

```jsx
// Root
<KeyboardProvider>…</KeyboardProvider>

// Screen
<KeyboardAwareScrollView
  contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
  keyboardShouldPersistTaps="handled"
  bottomOffset={16}
>
```

Measured matrix — one actor must own scrolling the focused field into view:

| Wrapper | Result |
| --- | --- |
| Bare `View`, `KeyboardAwareScrollView`, multiline | ✅ |
| Plain `ScrollView` | ❌ |
| `KeyboardAvoidingView` + `ScrollView` | ❌ they fight |
| Nested scroller, `FlatList`, `Modal` | ❌ |
| Plain `TextInput` in a bottom sheet | ❌ |
| **`BottomSheetTextInput`** in a bottom sheet | ✅ |

---

## 8. Vertical centring

```jsx
// ✅ works on both platforms
<View style={{ height: 48, justifyContent: 'center' }}>
  <Text>שלום עולם</Text>
</View>

// ❌ Android-only accident — off-centre on iOS
<View style={{ height: 48 }}>
  <Text style={{ lineHeight: 48 }}>שלום עולם</Text>
</View>
```

`justifyContent` does **not** inherit — if any wrapper sits between the box and the text,
the wrapper needs its own.

Keep `lineHeight` comfortably above `fontSize`: at or below it, descenders clip, and
Hebrew glyphs are taller than Latin at the same size.

---

## 9. Blur (Expo SDK 57+)

Four requirements on Android; iOS forgives all of them. **Write the Android shape.**

```jsx
const targetRef = useRef(null);

<View style={{ position: 'relative' }}>
  <BlurTargetView ref={targetRef} style={StyleSheet.absoluteFill}>
    <ContentToBlur />
  </BlurTargetView>
  <BlurView
    blurTarget={targetRef}          // required — the only one that warns if missing
    blurMethod="dimezisBlurView"    // required — defaults to 'none' on Android
    intensity={50}
    style={styles.panel}            // required — SIBLING of the target, not a child
  />
</View>
```

Do not use `@react-native-community/blur` on RN 0.86 — it hard-crashes the screen with a
native `NoSuchMethodError` that no JS boundary can catch.

Blur cannot cross a `Modal` boundary (separate native window). Render blurred overlays in
the same tree instead.

---

## 10. Language switching

```js
const directionChanged = isRTLLanguage(current) !== isRTLLanguage(target);

await saveLanguage(target);        // persist BEFORE anything else
await i18n.changeLanguage(target); // with DirectionProvider this is all you need
```

With direction driven from state, **no reload is needed in either direction** — the
provider re-renders and the layout flips live.

If you must keep the legacy `forceRTL` path, a persisted one-shot guard is **mandatory**,
not defensive: `isRTL` never updates in-process, so the "flag disagrees with language →
flip and restart" condition is true on *every* launch and the app restart-loops forever.

---

## 11. Debug checklist

| Check | Command / place |
| --- | --- |
| Android RTL gated off? | `android:supportsRtl="true"` in `AndroidManifest.xml` |
| Native flag actually set? | `adb shell run-as <pkg> cat /data/data/<pkg>/shared_prefs/com.facebook.react.modules.i18nmanager.I18nUtil.xml` |
| Blur silently degraded? | logcat for `blurTarget prop has not been configured` |
| Keyboard bound to nothing? | `adb shell dumpsys input_method` → `mInputShown=true` + `mServedView=null` |
| `textAlign: 'start'` shipped? | `npm run lint:rtl` |
