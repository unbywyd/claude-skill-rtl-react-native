/**
 * T28 / R22 — the universal direction wrapper.
 *
 * ONE wrapper + ONE hook, both fed by the app language. This is the entire
 * public surface a product app needs:
 *
 *   - <DirectionProvider lang={lang}>  — wraps the app ONCE. Applies
 *     `direction` to a flex:1 View; every logical property inside
 *     (start/end, marginStart, flex-start, plain 'row') mirrors
 *     automatically via Yoga inheritance. No per-component work.
 *
 *   - useDirection()                    — for the two things Yoga does NOT
 *     inherit: isRTL-keyed logic (mirrored icons) and explicit textAlign.
 *     Returns values derived from the LANGUAGE, never from I18nManager —
 *     T10 measured that `isRTL` does not follow `direction`, and R1/T2
 *     measured the flag being wrong on both platforms anyway.
 *
 * Measured basis: `direction` works on Android Fabric (T10/R16) and on iOS
 * Fabric (T10, this repo, iPhone 16 Pro Max) — the only direction primitive
 * verified on both. forceRTL + reload is not portable (R22).
 */

import React, { createContext, useContext, useMemo } from 'react';
import { View, I18nManager } from 'react-native';
import i18n from 'i18next';
import { isRTLLanguage } from '../i18n';

// ---------------------------------------------------------------------------
// Direction sources (moved verbatim from the original direction.ts).
//
// On RN 0.86.2 `I18nManager.isRTL` is a startup snapshot cached at module
// load and never re-read; measured wrong on Android (mirrored layout with
// isRTL=false, R1) and measured honest-but-useless on iOS (T2: the flip never
// applies, so it is always false). The app's own language state is the only
// trustworthy source — the app decided the language, so it knows the
// direction it asked for.
// ---------------------------------------------------------------------------

export type DirectionSource = 'language' | 'i18nManager';

/** Direction derived from the app's language — trustworthy. */
export function directionFromLanguage(): boolean {
  return isRTLLanguage(i18n.language);
}

/** Direction as reported by RN — may be a stale startup snapshot. */
export function directionFromI18nManager(): boolean {
  // This IS the unreliable source; the whole point of this function is to
  // expose it so the tests can compare it against the language (T5, T12).
  // eslint-disable-next-line rtl/no-isrtl
  return I18nManager.isRTL;
}

export function resolveDirection(source: DirectionSource): boolean {
  return source === 'language' ? directionFromLanguage() : directionFromI18nManager();
}

/** True when the two sources disagree — the exact bug condition we measured. */
export function sourcesDisagree(): boolean {
  return directionFromLanguage() !== directionFromI18nManager();
}

type DirectionValue = {
  /** 'rtl' | 'ltr' — what the subtree actually renders with. */
  dir: 'ltr' | 'rtl';
  /** Language-derived RTL bit. NOT I18nManager.isRTL — that flag is unreliable. */
  isRTL: boolean;
  /** Multiplier for directional icons: transform: [{ scaleX: flip }]. */
  flip: 1 | -1;
  /** Ready-made textAlign for text that must hug the reading edge. */
  textAlign: 'left' | 'right';
};

const DirectionContext = createContext<DirectionValue>({
  dir: 'ltr',
  isRTL: false,
  flip: 1,
  textAlign: 'left',
});

export function DirectionProvider({
  lang,
  enabled = true,
  children,
}: {
  lang: string;
  /** Escape hatch for the harness: OFF falls back to the native flag. */
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const dir: 'ltr' | 'rtl' = isRTLLanguage(lang) ? 'rtl' : 'ltr';

  const value = useMemo<DirectionValue>(
    () => ({
      dir,
      isRTL: dir === 'rtl',
      flip: dir === 'rtl' ? -1 : 1,
      textAlign: dir === 'rtl' ? 'right' : 'left',
    }),
    [dir],
  );

  // No `key` remount needed: T29 row G measured that mutating `direction` on an
  // already-mounted node applies immediately. (An earlier version keyed this
  // View on `dir` under the theory that direction only binds at node creation —
  // that theory was disproven; see RESULTS.md T29.) This is the one place
  // `direction` behaves better than forceRTL, which does need surface recreation.
  return (
    <DirectionContext.Provider value={value}>
      <View style={{ flex: 1, direction: enabled ? dir : undefined }}>{children}</View>
    </DirectionContext.Provider>
  );
}

export function useDirection(): DirectionValue {
  return useContext(DirectionContext);
}
