/**
 * eslint-plugin-rtl — the measured RTL rules, enforced mechanically.
 *
 * Every rule here corresponds to a failure MEASURED on a device in this repo
 * (see RESULTS.md / SKILL_RULES.md), not to style preference. The point is that
 * these bugs are all SILENT: no crash, no warning, and the wrong branch usually
 * looks like a working layout. A linter is the only thing that catches them
 * before the app runs — and it catches them for both platforms at once.
 *
 * Rules:
 *   no-isrtl              R1  · I18nManager.isRTL is unreliable on both platforms
 *   no-physical-styles    R15 · left/right/marginLeft… do not mirror by intent
 *   no-direction-ternary  T2  · the double flip — isRTL ? 'row-reverse' : 'row'
 *   no-dead-logical-props R15 · borderInlineStartWidth etc. silently do nothing
 *   require-bidi-isolate  R14 · LTR data interpolated into RTL text corrupts
 */

'use strict';

const DIRECTION_HINT = "Derive direction from the app language (useDirection()), not from I18nManager.";

// --- R15: physical -> logical -------------------------------------------------
const PHYSICAL_TO_LOGICAL = {
  marginLeft: 'marginStart',
  marginRight: 'marginEnd',
  paddingLeft: 'paddingStart',
  paddingRight: 'paddingEnd',
  borderLeftWidth: 'borderStartWidth',
  borderRightWidth: 'borderEndWidth',
  borderLeftColor: 'borderStartColor',
  borderRightColor: 'borderEndColor',
  left: 'start',
  right: 'end',
};

// --- R15: properties that DO NOT EXIST in RN and fail silently ----------------
// Measured: borderInlineStartWidth renders no border, no error, no warning —
// on Android (T8) and on iOS (T8c). The *Inline* family exists for margin and
// padding but NOT for borders.
const DEAD_PROPS = [
  'borderInlineStartWidth',
  'borderInlineEndWidth',
  'borderInlineStartColor',
  'borderInlineEndColor',
  'borderInlineStart',
  'borderInlineEnd',
];

// --- Android-only style props that are silent no-ops on iOS (T27 §4) ---------
const ANDROID_ONLY_VERTICAL = ['verticalAlign', 'textAlignVertical'];

// Styles whose value must never be chosen by a direction ternary (T2 double flip).
const DIRECTION_SENSITIVE = new Set([
  'flexDirection',
  'justifyContent',
  'alignItems',
  'alignSelf',
  'textAlign',
]);

function isRTLRead(node) {
  return (
    node &&
    node.type === 'MemberExpression' &&
    node.property &&
    node.property.name === 'isRTL'
  );
}

/** Any expression that looks like a direction test. */
function isDirectionTest(node) {
  if (!node) return false;
  if (isRTLRead(node)) return true;
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    return isDirectionTest(node.argument);
  }
  if (node.type === 'Identifier') {
    return /^(isRTL|rtl|isRtl)$/.test(node.name);
  }
  return false;
}

module.exports = {
  rules: {
    // -----------------------------------------------------------------------
    'no-isrtl': {
      meta: {
        type: 'problem',
        docs: { description: 'I18nManager.isRTL is a stale startup snapshot (R1)' },
        schema: [],
      },
      create(context) {
        return {
          MemberExpression(node) {
            if (!isRTLRead(node)) return;
            // `context.sourceCode` is the current API; `getSourceCode()` was
            // removed in ESLint 10. Support both.
            const sc = context.sourceCode || context.getSourceCode();
            if (!/I18nManager/.test(sc.getText(node.object))) return;
            context.report({
              node,
              message:
                'I18nManager.isRTL is unreliable: measured `false` while the layout was mirrored ' +
                '(Android, R1) and `false` while the flip never applied (iOS, T2). ' +
                DIRECTION_HINT,
            });
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    'no-physical-styles': {
      meta: {
        type: 'problem',
        docs: { description: 'Use logical properties so RTL mirrors automatically' },
        fixable: 'code',
        schema: [],
      },
      create(context) {
        return {
          Property(node) {
            const key = node.key && (node.key.name || node.key.value);
            const logical = PHYSICAL_TO_LOGICAL[key];
            if (!logical) return;
            // `left`/`right` are only directional inside a positioned style; we
            // cannot prove that statically, so report and let the fixer be opt-in.
            context.report({
              node: node.key,
              message: `\`${key}\` does not mirror under RTL. Use \`${logical}\`.`,
              fix: (fixer) =>
                node.key.type === 'Identifier' ? fixer.replaceText(node.key, logical) : null,
            });
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    'no-dead-logical-props': {
      meta: {
        type: 'problem',
        docs: { description: 'Style props that silently do nothing in React Native' },
        schema: [],
      },
      create(context) {
        return {
          Property(node) {
            const key = node.key && (node.key.name || node.key.value);
            if (DEAD_PROPS.includes(key)) {
              context.report({
                node: node.key,
                message:
                  `\`${key}\` does not exist in React Native — it renders nothing, with no ` +
                  'error or warning (measured on Android T8 and iOS T8c). ' +
                  'Use `borderStartWidth` / `borderEndWidth`.',
              });
            }
            if (ANDROID_ONLY_VERTICAL.includes(key)) {
              context.report({
                node: node.key,
                message:
                  `\`${key}\` is Android-only and is a SILENT no-op on iOS (T27 §4: ` +
                  "'top'/'middle'/'bottom' all rendered identically). " +
                  'Centre vertically with `justifyContent` on the direct parent.',
              });
            }
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    'no-textalign-start': {
      meta: {
        type: 'problem',
        docs: { description: "textAlign does not accept 'start'/'end' in React Native" },
        schema: [],
      },
      create(context) {
        return {
          Property(node) {
            const key = node.key && (node.key.name || node.key.value);
            if (key !== 'textAlign') return;
            // Unwrap `'start' as any` / `'start' as const` — a cast is exactly
            // what people add when TypeScript rejects the value, so the rule
            // must see through it rather than fall silent on the worst case.
            let v = node.value;
            while (v && (v.type === 'TSAsExpression' || v.type === 'TSTypeAssertion')) {
              v = v.expression;
            }
            const value = v && (v.value !== undefined ? v.value : null);
            if (value === 'start' || value === 'end') {
              context.report({
                node: v,
                message:
                  `\`textAlign: '${value}'\` is NOT a valid React Native value — the accepted ` +
                  "set is 'auto' | 'left' | 'right' | 'center' | 'justify' (verified in the " +
                  'installed types on 0.81.5 and 0.86.2, R6). It fails SILENTLY, leaving text ' +
                  'on the wrong side. This is the classic bug from applying the web CSS ' +
                  'logical-property rewrite to React Native. Use an explicit ' +
                  "'left' | 'right' chosen from the app language (useDirection()).",
              });
            }
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    'no-direction-ternary': {
      meta: {
        type: 'problem',
        docs: { description: 'The double flip: re-mirroring what RN already mirrored (T2)' },
        schema: [],
      },
      create(context) {
        return {
          Property(node) {
            const key = node.key && (node.key.name || node.key.value);
            if (!DIRECTION_SENSITIVE.has(key)) return;
            if (!node.value || node.value.type !== 'ConditionalExpression') return;
            if (!isDirectionTest(node.value.test)) return;
            context.report({
              node,
              message:
                `\`${key}\` chosen by a direction ternary is the DOUBLE FLIP (T2): RN already ` +
                'mirrors logical values, so this cancels the mirroring and lands the element on ' +
                `the wrong side. Write the plain logical value and let the layout direction do it.`,
            });
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    'no-hardcoded-text': {
      meta: {
        type: 'problem',
        docs: { description: 'User-facing strings must come from the translation layer' },
        schema: [
          {
            type: 'object',
            properties: {
              props: { type: 'array', items: { type: 'string' } },
              ignore: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const opts = context.options[0] || {};
        const PROPS = new Set(
          opts.props || [
            'placeholder',
            'title',
            'label',
            'accessibilityLabel',
            'accessibilityHint',
            'confirmText',
            'cancelText',
            'submitText',
            'emptyText',
          ]
        );
        const IGNORE = new Set(opts.ignore || []);

        // Only flag things that read like prose: at least two letters, and at
        // least one space OR a capitalised word. Avoids firing on "px", "row",
        // testIDs, keys, urls, and other machine strings.
        const looksLikeProse = (v) =>
          typeof v === 'string' &&
          v.trim().length > 2 &&
          /[A-Za-z]{2}/.test(v) &&
          !/^[a-z0-9_.-]+$/.test(v.trim()) &&
          !/^https?:\/\//.test(v.trim());

        const report = (node, what) =>
          context.report({
            node,
            message:
              `Hardcoded user-facing string (${what}). In a multi-language app this never ` +
              'translates, and a Latin literal dropped into RTL text also reorders around its ' +
              "neighbours (BiDi). Move it to the translation layer: t('namespace.key'). " +
              'Interpolate values through the key rather than concatenating.',
          });

        return {
          // <Text>Save</Text>
          JSXText(node) {
            const v = node.value;
            if (looksLikeProse(v)) report(node, 'JSX text');
          },
          // placeholder="Enter name" / title={'Cancel'}
          JSXAttribute(node) {
            const name = node.name && node.name.name;
            if (!PROPS.has(name) || IGNORE.has(name)) return;
            const val = node.value;
            if (!val) return;
            if (val.type === 'Literal' && looksLikeProse(val.value)) {
              report(val, `${name} prop`);
            }
            if (
              val.type === 'JSXExpressionContainer' &&
              val.expression &&
              val.expression.type === 'Literal' &&
              looksLikeProse(val.expression.value)
            ) {
              report(val.expression, `${name} prop`);
            }
          },
          // Alert.alert('Error', 'Something went wrong')
          CallExpression(node) {
            const c = node.callee;
            const isAlert =
              c &&
              c.type === 'MemberExpression' &&
              c.object &&
              c.object.name === 'Alert' &&
              c.property &&
              c.property.name === 'alert';
            if (!isAlert) return;
            for (const arg of node.arguments) {
              if (arg.type === 'Literal' && looksLikeProse(arg.value)) {
                report(arg, 'Alert.alert argument');
              }
            }
          },
        };
      },
    },

    'require-bidi-isolate': {
      meta: {
        type: 'problem',
        docs: { description: 'LTR data inside RTL text reorders without an isolate (R14)' },
        schema: [
          {
            type: 'object',
            properties: { extraPatterns: { type: 'array', items: { type: 'string' } } },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const RTL_SCRIPT = /[֐-׿؀-ۿ܀-ݏ]/;
        // BiDi controls that make an interpolation safe — as literal characters
        // (LRM/RLM, LRI/RLI/FSI/PDI) or written as escapes, which is how they
        // usually appear in source.
        const ISOLATE_CHARS = /[‎‏⁦⁧⁨⁩]/;
        const ISOLATE_ESCAPES = /\\u(200e|200f|2066|2067|2068|2069)/i;

        function checkTemplate(node) {
          // `cooked` is the decoded text (escapes resolved); `raw` is the source
          // as written. Check both so either spelling counts.
          const hasRTL = node.quasis.some(
            (q) => RTL_SCRIPT.test(q.value.cooked || '') || RTL_SCRIPT.test(q.value.raw),
          );
          if (!hasRTL || node.expressions.length === 0) return;
          const raw = node.quasis.map((q) => q.value.raw).join('');
          const cooked = node.quasis.map((q) => q.value.cooked || '').join('');
          if (ISOLATE_CHARS.test(cooked) || ISOLATE_ESCAPES.test(raw)) return;
          context.report({
            node,
            message:
              'Interpolating a value into RTL text without a BiDi isolate corrupts it: measured ' +
              '`+972 54…` -> `54… 972+` and `12 - 13 = 25` -> `25 = 13 - 12` (R14 / T7, BOTH ' +
              'platforms, and it happens in LTR apps too). Wrap the value: `${LRI}${value}${PDI}`. ' +
              'A bare LRM is not enough when the value carries a currency or unit symbol.',
          });
        }

        return { TemplateLiteral: checkTemplate };
      },
    },
  },
};
