/**
 * eslint-plugin-rtl — the measured RTL rules, enforced mechanically.
 *
 * ORIGIN: the core of this plugin comes from the `rtl-react-native` skill
 * (https://github.com/unbywyd/claude-skill-rtl-react-native), where each rule
 * was measured on real hardware — Galaxy S21 Ultra and iPhone 16 Pro Max, with
 * Metro killed and the app freshly installed. That skill is the source of
 * truth: when it and this file disagree, the skill is right and this copy is
 * the stale one. Rules marked (anyapp) below were added here afterwards and
 * were derived from reading code, not from device measurement — weaker
 * evidence, and worth re-checking against the skill before trusting them.
 *
 * These bugs are all SILENT: no crash, no warning, and the wrong branch usually
 * looks like a working layout. A linter is the only thing that catches them
 * before the app runs — and it catches them for both platforms at once.
 *
 * Rules:
 *   no-isrtl                          R1  · I18nManager.isRTL is unreliable on both platforms
 *   no-physical-styles                R15 · left/right/marginLeft… do not mirror by intent
 *   no-direction-ternary              T2  · the double flip — isRTL ? 'row-reverse' : 'row'
 *   no-literal-row-reverse            (anyapp)  · the same double flip written as a literal
 *   no-dead-logical-props             R15 · borderInlineStartWidth etc. silently do nothing
 *   no-textalign-start                R6  · textAlign:'start' is not a valid RN value
 *   no-hardcoded-textalign            (anyapp)  · textAlign:'right' locks the screen to Hebrew
 *   no-writingdirection-with-textalign      (anyapp) writingDirection does not align text
 *   require-bidi-isolate              R14 · LTR data interpolated into RTL text corrupts
 *   require-icon-flip                       (anyapp) directional icons must mirror
 *   no-hardcoded-webview-dir                (anyapp) dir="rtl" baked into WebView HTML
 *   no-hardcoded-text                       · untranslated user-facing strings
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

/**
 * True when `left`/`right` in this object are a symmetric pair (`left: 0,
 * right: 0`) — the full-bleed idiom, which mirrors trivially and is not a
 * direction bug — or a percentage used for geometric centring.
 */
function isSymmetricPair(node) {
  const obj = node.parent;
  if (!obj || obj.type !== 'ObjectExpression') return false;
  const key = node.key && (node.key.name || node.key.value);

  const read = (name) => {
    const p = obj.properties.find(
      (x) => x.type === 'Property' && (x.key.name || x.key.value) === name,
    );
    return p && p.value.type === 'Literal' ? p.value.value : undefined;
  };

  const left = read('left');
  const right = read('right');
  // Both present and equal → symmetric, mirrors to itself.
  if (left !== undefined && right !== undefined && left === right) return true;

  // Radial centring: `left: '50%'` with a negative `marginLeft` pulling the
  // element back by half its width. The midpoint is the same point in both
  // directions, so there is nothing to mirror — and rewriting `marginLeft` to
  // `marginStart` here would break the centring under RTL, making the "fix"
  // worse than the finding.
  const own = node.value.type === 'Literal' ? node.value.value : undefined;
  if (own === '50%') return true;
  if (key === 'marginLeft' || key === 'marginRight') {
    const anchor = read(key === 'marginLeft' ? 'left' : 'right');
    if (anchor === '50%') return true;
  }

  return false;
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

            // Two shapes are NOT direction bugs, and flagging them is how a
            // rule gets blanket-disabled on first run:
            //
            //   { left: 0, right: 0 }        full-bleed; symmetric by intent
            //   { left: '50%', marginLeft }  radial centring; geometric, not directional
            //
            // Both are recognisable statically, so skip them rather than making
            // the team add eslint-disable comments to correct code.
            if (
              (key === 'left' ||
                key === 'right' ||
                key === 'marginLeft' ||
                key === 'marginRight') &&
              isSymmetricPair(node)
            ) {
              return;
            }

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
                `the wrong side. Write the plain logical value and let the layout direction do it.` +
                (key === 'textAlign'
                  ? ' — NOTE: on a <TextInput> this ternary is CORRECT (R30: an input is not ' +
                    'mirrored by a direction island, a <Text> is). If this style is for an ' +
                    'input, keep the ternary and name it so, e.g. textAlignInput from ' +
                    'useDirection(); the plain textAlign key is for <Text>.'
                  : ''),
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

        // A value rendered bare inside <Text> is the same hazard as one
        // interpolated into a template, and it is the more common spelling:
        //   <Text>{profile.phone}</Text>
        // The template form was already caught; this one shipped unnoticed.
        // Matching is name-based (phone/email/price/id/…) because the type is
        // not visible to the linter — the payoff is that the names people
        // actually use for LTR data are a small, stable set.
        // Anchored and narrow on purpose. An earlier, looser version matched
        // `card` inside `styles.card` and fired on every styled <View> in the
        // app — a rule that cries wolf on correct code gets switched off, and
        // then the real bugs ride through with it.
        const LTR_DATA_NAME =
          /^(phone|mobile|tel|telephone|email|mail|url|link|href|price|amount|total|sum|cost|iban|creditCard|cardNumber|sku|barcode|id|uuid|version|latitude|longitude)$|(Phone|Email|Url|Price|Amount|Total|Iban|Id|Uuid)$/;

        function nameOf(expr) {
          if (!expr) return '';
          if (expr.type === 'Identifier') return expr.name;
          if (expr.type === 'MemberExpression') return nameOf(expr.property);
          // profile?.phone
          if (expr.type === 'ChainExpression') return nameOf(expr.expression);
          // value ?? '—'  /  value || '—'
          if (expr.type === 'LogicalExpression') return nameOf(expr.left);
          return '';
        }

        function checkJsxExpression(node) {
          const expr = node.expression;
          if (!expr || expr.type === 'JSXEmptyExpression') return;
          // A template literal inside JSX is already handled by checkTemplate,
          // and that path understands isolates — do not double-report.
          if (expr.type === 'TemplateLiteral') return;

          // Only rendered TEXT can reorder. An expression in an attribute
          // position (`style={…}`, `source={…}`, `onPress={…}`) is a value
          // passed to a prop, never characters laid out next to Hebrew.
          if (node.parent && node.parent.type === 'JSXAttribute') return;

          const name = nameOf(expr);
          if (!name || !LTR_DATA_NAME.test(name)) return;

          context.report({
            node,
            message:
              `\`${name}\` reads as always-LTR data rendered inside RTL text. Without a BiDi ` +
              'isolate the characters reorder around their neighbours — measured `+972 54…` -> ' +
              '`54… 972+` (R14/T7, both platforms). textAlign does not fix this: it aligns the ' +
              'block, not the characters. Wrap the value in LRI…PDI — ideally inside a shared ' +
              'formatter (lib/format.ts) so call sites cannot forget.',
          });
        }

        return {
          TemplateLiteral: checkTemplate,
          JSXExpressionContainer: checkJsxExpression,
        };
      },
    },

    // -----------------------------------------------------------------------
    'no-literal-row-reverse': {
      meta: {
        type: 'problem',
        docs: { description: 'row-reverse inside a DirectionProvider app is the double flip' },
        schema: [],
      },
      create(context) {
        return {
          Property(node) {
            const key = node.key && (node.key.name || node.key.value);
            if (key !== 'flexDirection') return;
            const v = node.value;
            const value = v && v.type === 'Literal' ? v.value : null;
            if (value !== 'row-reverse' && value !== 'column-reverse') return;
            context.report({
              node: v,
              message:
                `\`flexDirection: '${value}'\` is the DOUBLE FLIP (T2). <DirectionProvider> already ` +
                'mirrors the subtree, so reversing again cancels the mirroring and lands the row ' +
                'LTR inside an RTL screen — wrong in Hebrew AND wrong in English. This is the ' +
                'literal spelling of the bug `no-direction-ternary` catches; it needs no ternary ' +
                `to be wrong. Write the plain logical value ('row') and let the layout direction ` +
                'do the mirroring.',
            });
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    'no-hardcoded-textalign': {
      meta: {
        type: 'problem',
        docs: { description: "textAlign:'left'|'right' hardcodes one language's direction" },
        schema: [],
      },
      create(context) {
        return {
          Property(node) {
            const key = node.key && (node.key.name || node.key.value);
            if (key !== 'textAlign') return;
            const v = node.value;
            if (!v || v.type !== 'Literal') return;
            if (v.value !== 'left' && v.value !== 'right') return;
            const obj = node.parent;

            // Only flag STYLE objects. `textAlign` also appears as a plain data
            // field — the direction context's own default value is
            // `{ dir, isRTL, flip, textAlign }`, which is the definition of the
            // correct pattern, not a violation of it. A style object always
            // carries other style keys alongside.
            if (obj && obj.type === 'ObjectExpression') {
              const keys = obj.properties
                .filter((p) => p.type === 'Property')
                .map((p) => p.key.name || p.key.value);
              const looksLikeStyle = keys.some((k) =>
                /^(color|fontSize|fontFamily|fontWeight|lineHeight|margin|padding|flex|width|height|background|border|position|top|bottom|start|end|left|right|opacity|gap|align|justify)/.test(
                  String(k),
                ),
              );
              if (!looksLikeStyle) return;
            }

            // An explicitly LTR-tagged style is a deliberate island (a phone
            // field, a code block) — the sibling writingDirection says so.
            const taggedLtr =
              obj &&
              obj.type === 'ObjectExpression' &&
              obj.properties.some(
                (p) =>
                  p.type === 'Property' &&
                  (p.key.name || p.key.value) === 'writingDirection' &&
                  p.value.type === 'Literal' &&
                  p.value.value === 'ltr',
              );
            if (taggedLtr) return;

            context.report({
              node: v,
              message:
                `\`textAlign: '${v.value}'\` pins the text to one direction. The screen then renders ` +
                'correctly in Hebrew and wrong in every LTR language (and vice versa) — the bug is ' +
                'invisible until someone switches locale. Use the direction-derived value: ' +
                '`const { textAlign } = useDirection()`. Only \'center\' and \'justify\' are ' +
                'direction-neutral literals.',
            });
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    'no-writingdirection-with-textalign': {
      meta: {
        type: 'problem',
        docs: { description: 'writingDirection does not control alignment' },
        schema: [],
      },
      create(context) {
        return {
          ObjectExpression(node) {
            const props = node.properties.filter((p) => p.type === 'Property');
            const wd = props.find((p) => (p.key.name || p.key.value) === 'writingDirection');
            const ta = props.find((p) => (p.key.name || p.key.value) === 'textAlign');
            if (!wd || !ta) return;
            // Same-direction pairing is coherent (an explicit LTR island).
            const wdVal = wd.value.type === 'Literal' ? wd.value.value : null;
            const taVal = ta.value.type === 'Literal' ? ta.value.value : null;
            if (!wdVal || !taVal) return;
            const agree =
              (wdVal === 'ltr' && taVal === 'left') || (wdVal === 'rtl' && taVal === 'right');
            if (agree || taVal === 'center' || taVal === 'justify') return;

            context.report({
              node: wd,
              message:
                `\`writingDirection: '${wdVal}'\` with \`textAlign: '${taVal}'\` is a contradiction. ` +
                'writingDirection sets the BiDi base direction of the text — it does NOT align the ' +
                'block, and it does not remap textAlign on iOS (it partly does on Android, which is ' +
                'why this pattern looks fine in one simulator and ships broken). Choose the ' +
                'alignment from the app language via useDirection().',
            });
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    'require-icon-flip': {
      meta: {
        type: 'problem',
        docs: { description: 'Directional icons must mirror with the layout' },
        schema: [
          {
            type: 'object',
            properties: { ignore: { type: 'array', items: { type: 'string' } } },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const opts = context.options[0] || {};
        const IGNORE = new Set(opts.ignore || []);
        // Names that denote a direction. Deliberately not "Close"/"Menu"/"Trash"
        // — those are symbols, not directions, and must NOT mirror.
        const DIRECTIONAL = /(Arrow|Chevron|Caret|Back|Forward|Next|Prev|Previous|Undo|Redo|Send|Reply)/;

        // Components that mirror themselves. The rule reads the call site only,
        // so a self-flipping primitive would otherwise be flagged forever at
        // every use — and the team would end up disabling the rule rather than
        // annotating a hundred call sites. Extend via the `ignore` option.
        const SELF_MIRRORING = new Set([
          'ForwardIcon',
          'BackIcon',
          'RowChevronIcon',
          'DirectionalIcon',
        ]);

        return {
          JSXOpeningElement(node) {
            const name = node.name && node.name.name;
            if (typeof name !== 'string' || IGNORE.has(name)) return;
            if (SELF_MIRRORING.has(name)) return;
            if (!DIRECTIONAL.test(name)) return;

            // Any of these signals the author thought about direction:
            //   <Icon flip />  <Icon style={{ transform: [{ scaleX: flip }] }}>
            //   <Icon scaleX={flip} />  <Icon direction={dir} />
            const sc = context.sourceCode || context.getSourceCode();
            const text = sc.getText(node);
            if (/flip|scaleX|useDirection|isRTL|direction=/.test(text)) return;

            context.report({
              node,
              message:
                `<${name}> is a directional icon that never mirrors. In RTL a "next" arrow must ` +
                'point the other way; a chevron that stays put reads as "back". Apply the ' +
                'direction multiplier: `transform: [{ scaleX: flip }]` with ' +
                '`const { flip } = useDirection()`. If this glyph is genuinely direction-neutral ' +
                '(a logo, a symbol), rename it so the next reader is not misled — an icon named ' +
                '`ArrowLeft` used as "forward" is a trap that guarantees future misuse.',
            });
          },
        };
      },
    },

    // -----------------------------------------------------------------------
    'no-hardcoded-webview-dir': {
      meta: {
        type: 'problem',
        docs: { description: 'Direction baked into WebView HTML ignores the app language' },
        schema: [],
      },
      create(context) {
        // Matches dir="rtl", direction:rtl and text-align:right inside an HTML
        // string — the three ways a WebView document pins itself to one language.
        const BAKED = /(\bdir\s*=\s*["']?(rtl|ltr)|direction\s*:\s*(rtl|ltr)|text-align\s*:\s*(left|right))/i;

        function check(node, text) {
          // Only care about strings that are actually HTML documents.
          if (!/<(html|body|div|p|style|head)\b/i.test(text)) return;
          const m = BAKED.exec(text);
          if (!m) return;
          context.report({
            node,
            message:
              `WebView HTML hardcodes \`${m[0]}\`. The document then renders in that direction ` +
              'regardless of the app language, so a static page stays Hebrew-aligned in an English ' +
              'build. Derive it: `dir="${dir}"` from useDirection(), and use `text-align: start` ' +
              '(CSS logical properties DO work in a WebView, unlike in React Native).',
          });
        }

        return {
          TemplateLiteral(node) {
            check(node, node.quasis.map((q) => q.value.raw).join(''));
          },
        };
      },
    },
  },
};

// A ready-made rule set, so consuming a new project's config is one spread
// instead of a hand-written list of twelve rule names. The list version is how
// a rule silently goes missing when someone adds one here and forgets to
// register it downstream.
module.exports.configs = {
  recommended: {
    rules: Object.fromEntries(
      Object.keys(module.exports.rules).map((name) => [`rtl/${name}`, 'error']),
    ),
  },
};
