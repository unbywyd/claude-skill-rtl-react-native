/**
 * The primitives — where the measured defaults become unreachable.
 *
 * `direction.tsx` gives an app the correct VALUES. This file removes the step
 * where a developer has to remember to apply them, because that step is where
 * every bug in this harness was actually made.
 *
 * WHY COMPONENTS AND NOT A RULE. The original defect in this project came from
 * a CORRECT code sample. The skill showed
 *
 *     <TextInput style={{ textAlign: isRTL ? 'right' : 'left' }} />
 *
 * which is right — on a TextInput. It was read, copied into a hook, and applied
 * to <Text>, where it is wrong. The prose around it was accurate and said
 * nothing false. A sample cannot state its own scope, and the reader fills the
 * gap with the most useful assumption. No amount of rewording reaches that:
 * the only fix is to make the wrong version unwriteable.
 *
 * WHAT THIS DOES NOT COVER, stated up front rather than discovered later. These
 * primitives close the common path. They are not a closed system: a badge from
 * a UI kit, a chart's axis labels, a third-party component taking a `title`
 * string — all render text this file never sees. For those, the rules file is
 * still the answer, and `references/rules.md` is where the reasoning lives.
 * Treating the library as total is how the next unstated precondition gets in.
 *
 * THE MEASUREMENTS BEHIND EACH CHOICE are cited per component. Every one was
 * taken on both platforms on physical hardware; where the platforms disagree,
 * the disagreement is the reason the component exists.
 */

import React from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';
import type { TextProps, TextInputProps, TextStyle } from 'react-native';
import { useDirection } from './direction';

// ---------------------------------------------------------------------------
// BiDi isolates (R14).
//
// U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE. The isolate
// tells the Unicode BiDi algorithm to resolve the run's direction on its own
// and to keep it from reordering against the surrounding sentence.
//
// This is what stops "+972 54-123-4567" rendering as "54-123-4567 972+" inside
// a Hebrew line. That reordering is UAX #9 behaving exactly as specified — it
// is not an RN bug, and it happens identically in Chrome, Safari, Flutter and
// UIKit. textAlign does NOT fix it; only isolation does.
// ---------------------------------------------------------------------------

const FSI = '⁨';
const PDI = '⁩';

/** Wrap a value so BiDi resolves it independently of the sentence around it. */
export function isolate(value: string | number): string {
  return `${FSI}${value}${PDI}`;
}

// ---------------------------------------------------------------------------
// <Label> — text that hugs the reading edge.
// ---------------------------------------------------------------------------

/**
 * Body copy, headings, any text that should sit at the start of the line.
 *
 * Sets textAlign unconditionally, and the value is always 'left'. That is not
 * a bug: the provider puts `direction` on the subtree, and Yoga mirrors
 * textAlign the way it mirrors flex-start, so 'left' IS the start edge in both
 * directions. Passing 'right' here would mirror a second time.
 *
 * The property is set rather than omitted because an ABSENT textAlign resolves
 * differently on each platform (T30d, both devices):
 *
 *     Android   the island's direction
 *     iOS       always physically LEFT — not the island, not the script, and
 *               not the app's own direction. Re-measured under a build-time
 *               forcesRTL:true build (T30f): every row identical to the pixel.
 *
 * So a Hebrew label with no textAlign sits on the LEFT on iOS while identical
 * code is correct on Android — and a Hebrew-only review done on an Android
 * device cannot see it. There is no iOS configuration in which omitting it is
 * safe; the escape people reach for does not exist.
 */
export function Label({ style, ...rest }: TextProps) {
  const { textAlign } = useDirection();
  return <Text {...rest} style={[{ textAlign }, style]} />;
}

/**
 * Text carrying always-LTR data: a phone number, an email, an IBAN, an id.
 *
 * Two separate problems, and they need two separate fixes:
 *
 *   1. WHICH EDGE THE BLOCK SITS ON — textAlign 'right', which Yoga mirrors to
 *      the START edge inside an RTL subtree. That is where LTR data belongs.
 *   2. THE ORDER OF THE CHARACTERS — the isolate. Without it a leading '+'
 *      migrates to the end of the number (R14/T7).
 *
 * Fixing only the first is the common mistake: the block lands correctly and
 * the number is still corrupted, which reads as a font or keyboard problem
 * rather than an alignment one.
 */
export function Ltr({ children, style, ...rest }: TextProps) {
  const { textAlignInput } = useDirection();
  const physical: TextStyle['textAlign'] = textAlignInput === 'right' ? 'right' : 'left';
  return (
    <Text {...rest} style={[{ textAlign: physical }, style]}>
      {typeof children === 'string' || typeof children === 'number' ? isolate(children) : children}
    </Text>
  );
}

/**
 * A number, price, phone, percentage or id inside a sentence.
 *
 * Isolation only — no alignment of its own, because it is inline and inherits
 * the surrounding block. This is the one that keeps "‎+972 54-123-4567" intact
 * inside Hebrew body text.
 */
export function Num({ children, ...rest }: TextProps & { children: string | number }) {
  return <Text {...rest}>{isolate(children)}</Text>;
}

// ---------------------------------------------------------------------------
// <Field> — a text input.
// ---------------------------------------------------------------------------

/**
 * A TextInput with alignment that does not move under the user.
 *
 * The value is PHYSICAL and derived from the language, unlike <Label>, because
 * an input is not mirrored by the island: it resolves alignment in the
 * platform's own text widget rather than through Yoga (T30b, T30c — measured
 * identically on both platforms, so this is the one place the ternary from the
 * old §3 snippet is correct).
 *
 * Setting it is mandatory, and the reason is sharper than tidiness. With no
 * textAlign an input's alignment is decided by its CONTENT, per value:
 *
 *     placeholder, empty field   Android  first-strong (Hebrew right)
 *                                iOS      always physically LEFT
 *     typed value                both     the FIRST STRONG CHARACTER, and the
 *                                         bulk of the string is irrelevant
 *
 * Measured consequences, none of which have a data-side fix:
 *
 *   - A Hebrew form is left-aligned at rest on iOS and each field snaps to the
 *     right as it is filled (T30e).
 *   - "Acme בע״מ" and "שלום Acme" land on OPPOSITE edges in the same address
 *     book, because the deciding character is whatever the data happens to
 *     start with (T30h). No amount of care about the data makes the form
 *     consistent — only this property does.
 *
 * T30h is worth stating precisely, because it is the one row measured on both
 * platforms with the two candidate rules put in conflict. Each string's first
 * strong character disagreed with the bulk of its content:
 *
 *                              Android            iOS
 *   "Acme שלום עולם…"  (bulk HE)  132..672  LEFT    137..668   LEFT
 *   "שלום Acme Corp…"  (bulk EN)  427..950  RIGHT   652..1180  RIGHT
 *
 * Opposite edges on both platforms, and the majority script is irrelevant on
 * both. So "first-strong" is literally true — the FIRST STRONG CHARACTER of
 * the value — and not shorthand for "the string's language". This is the one
 * behaviour in the whole matrix that agrees across platforms, which is why
 * this component can derive a single value instead of branching per OS.
 */
export function Field({ style, ...rest }: TextInputProps) {
  const { textAlignInput } = useDirection();
  return <TextInput {...rest} style={[{ textAlign: textAlignInput }, style]} />;
}

/**
 * An input for always-LTR data — email, phone, IBAN, card number.
 *
 * Physically left in both directions. An email field in a Hebrew form should
 * not flip to the right edge because the user's address happens to start with
 * a Hebrew character, and `keyboardType` does not prevent that: first-strong
 * resolution reads the VALUE, whatever produced it.
 */
export function LtrField({ style, ...rest }: TextInputProps) {
  return <TextInput {...rest} style={[styles.ltrField, style]} />;
}

const styles = StyleSheet.create({
  // Both properties are load-bearing and they do DIFFERENT jobs — do not
  // delete either as redundant.
  //
  //   textAlign        pins the block to the left edge. Works on both
  //                    platforms; this is what stops the field flipping.
  //   writingDirection sets the bidi BASE DIRECTION of the run, which is what
  //                    keeps an email or IBAN in logical order.
  //
  // R17 measured writingDirection as a no-op for ALIGNMENT on Android (and
  // working on iOS), which is why the rules file says never to offer it as an
  // ALTERNATIVE to textAlign. Pairing the two is a different claim: alignment
  // from textAlign, ordering from writingDirection.
  ltrField: { textAlign: 'left', writingDirection: 'ltr' },
});
