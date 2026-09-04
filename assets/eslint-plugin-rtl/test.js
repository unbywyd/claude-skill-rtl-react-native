/**
 * Self-test for eslint-plugin-rtl, using ESLint's own RuleTester.
 *
 * Every `invalid` case below is a real pattern measured failing on a device in
 * this repo — the test doubles as a regression list for the findings.
 *
 * Run: node tools/eslint-plugin-rtl/test.js
 */

'use strict';

const { RuleTester } = require('eslint');
const plugin = require('./index');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// no-hardcoded-text inspects JSX nodes, which the default parser options do not
// enable. Give it its own tester rather than turning JSX on globally.
const jsxTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

let failures = 0;
function run(name, rule, cases, tester) {
  try {
    (tester || ruleTester).run(name, rule, cases);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${err.message.split('\n').slice(0, 6).join('\n    ')}`);
  }
}

console.log('eslint-plugin-rtl');

run('no-isrtl', plugin.rules['no-isrtl'], {
  valid: [
    { code: 'const dir = isRTLLanguage(lang) ? "rtl" : "ltr";' },
    { code: 'const { isRTL } = useDirection();' },
    { code: 'const x = other.isRTL;' },
  ],
  invalid: [
    { code: 'const a = I18nManager.isRTL;', errors: 1 },
    { code: 'if (I18nManager.isRTL) { flip(); }', errors: 1 },
  ],
});

run('no-physical-styles', plugin.rules['no-physical-styles'], {
  valid: [
    { code: 'const s = { marginStart: 8, paddingEnd: 4, start: 0 };' },
    { code: 'const s = { marginTop: 8, paddingBottom: 4 };' },
    // Full-bleed: symmetric, mirrors to itself.
    { code: 'const s = { position: "absolute", left: 0, right: 0 };' },
    // Radial centring: the midpoint is the same point in both directions, and
    // rewriting marginLeft to marginStart would BREAK the centring under RTL.
    { code: 'const s = { position: "absolute", left: "50%", marginLeft: -2 };' },
  ],
  invalid: [
    {
      code: 'const s = { marginLeft: 8 };',
      output: 'const s = { marginStart: 8 };',
      errors: 1,
    },
    {
      code: 'const s = { paddingRight: 4, left: 0 };',
      output: 'const s = { paddingEnd: 4, start: 0 };',
      errors: 2,
    },
  ],
});

run('no-dead-logical-props', plugin.rules['no-dead-logical-props'], {
  valid: [
    { code: 'const s = { borderStartWidth: 8 };' },
    { code: 'const s = { marginInlineStart: 8 };' }, // this one DOES exist
  ],
  invalid: [
    { code: 'const s = { borderInlineStartWidth: 8 };', errors: 1 },
    { code: 'const s = { verticalAlign: "middle" };', errors: 1 },
    { code: 'const s = { textAlignVertical: "center" };', errors: 1 },
  ],
});

run('no-textalign-start', plugin.rules['no-textalign-start'], {
  valid: [
    { code: 'const s = { textAlign: "left" };' },
    { code: 'const s = { textAlign: "right" };' },
    { code: 'const s = { textAlign: "center" };' },
    // start/end ARE valid for layout props — only textAlign rejects them.
    { code: 'const s = { marginStart: 8 };' },
  ],
  invalid: [
    { code: 'const s = { textAlign: "start" };', errors: 1 },
    { code: 'const s = { textAlign: "end" };', errors: 1 },
  ],
});

run('no-direction-ternary', plugin.rules['no-direction-ternary'], {
  valid: [
    { code: 'const s = { flexDirection: "row" };' },
    { code: 'const s = { justifyContent: "flex-start" };' },
    // A ternary on something that is not a direction test is fine.
    { code: 'const s = { flexDirection: isWide ? "row" : "column" };' },
  ],
  invalid: [
    {
      code: 'const s = { flexDirection: I18nManager.isRTL ? "row-reverse" : "row" };',
      errors: 1,
    },
    {
      code: 'const s = { justifyContent: isRTL ? "flex-end" : "flex-start" };',
      errors: 1,
    },
    {
      code: 'const s = { textAlign: isRTL ? "right" : "left" };',
      errors: 1,
    },
  ],
});

run('no-hardcoded-text', plugin.rules['no-hardcoded-text'], {
  valid: [
    { code: 'const a = <Text>{t("common.save")}</Text>;' },
    { code: 'const a = <TextInput placeholder={t("profile.name")} />;' },
    // machine strings must not trip it
    { code: 'const a = <View testID="save-button" />;' },
    { code: 'const a = <Text>{count}</Text>;' },
    { code: 'const s = { title: "row" };' },
  ],
  invalid: [
    { code: 'const a = <Text>Save changes</Text>;', errors: 1 },
    { code: 'const a = <TextInput placeholder="Enter name" />;', errors: 1 },
    { code: 'const a = <Foo title={"Cancel now"} />;', errors: 1 },
    { code: 'Alert.alert("Error", "Something went wrong");', errors: 2 },
  ],
}, jsxTester);

run('require-bidi-isolate', plugin.rules['require-bidi-isolate'], {
  valid: [
    // No interpolation — nothing to corrupt.
    { code: 'const s = `שלום עולם`;' },
    // No RTL script — plain LTR string.
    { code: 'const s = `value: ${n}`;' },
    // Isolated properly — as an escape (how it is usually written)...
    { code: 'const s = `טלפון: \\\\u2066${phone}\\\\u2069`;' },
    { code: 'const s = `القيمة: \\\\u200e${v}`;' },
    // ...and as the literal control characters.
    { code: 'const s = `טלפון: ⁦${phone}⁩`;' },
  ],
  invalid: [
    { code: 'const s = `טלפון: ${phone}`;', errors: 1 },
    { code: 'const s = `القيمة: ${amount} ₪`;', errors: 1 },
  ],
});

// The JSX half of the same rule. `<Text>{profile.phone}</Text>` is the spelling
// that actually shipped unnoticed in this repo — the template form was covered,
// this one was not.
run('require-bidi-isolate (JSX)', plugin.rules['require-bidi-isolate'], {
  valid: [
    // Not LTR-shaped data — a name reorders harmlessly.
    { code: 'const a = <Text>{profile.firstName}</Text>;' },
    { code: 'const a = <Text>{title}</Text>;' },
    // Already wrapped by a formatter that owns the isolate.
    { code: 'const a = <Text>{formatPhone(profile.phone)}</Text>;' },
    // Attribute positions are values passed to props, not rendered characters.
    // An earlier version matched `card` inside `styles.card` and fired on every
    // styled View in the app; a rule that shouts on correct code gets disabled.
    { code: 'const a = <View style={styles.card} />;' },
    { code: 'const a = <Image source={{ uri: photoUrl }} />;' },
    { code: 'const a = <Btn onPress={() => call(profile.phone)} />;' },
  ],
  invalid: [
    { code: 'const a = <Text>{profile.phone}</Text>;', errors: 1 },
    { code: 'const a = <Text>{order.totalPrice}</Text>;', errors: 1 },
    { code: 'const a = <Text>{customer.email}</Text>;', errors: 1 },
    // Optional chaining and a fallback must not hide it.
    { code: 'const a = <Text>{profile?.phone ?? "—"}</Text>;', errors: 1 },
  ],
}, jsxTester);

run('no-literal-row-reverse', plugin.rules['no-literal-row-reverse'], {
  valid: [
    { code: 'const s = { flexDirection: "row" };' },
    { code: 'const s = { flexDirection: "column" };' },
  ],
  invalid: [
    { code: 'const s = { flexDirection: "row-reverse" };', errors: 1 },
    { code: 'const s = { flexDirection: "column-reverse" };', errors: 1 },
  ],
});

run('no-hardcoded-textalign', plugin.rules['no-hardcoded-textalign'], {
  valid: [
    // Direction-neutral values are fine as literals.
    { code: 'const s = { fontSize: 14, textAlign: "center" };' },
    { code: 'const s = { color: "#000", textAlign: "justify" };' },
    // Derived from the app language — the whole point.
    { code: 'const s = { fontSize: 14, textAlign };' },
    { code: 'const s = { fontSize: 14, textAlign: dir === "rtl" ? "right" : "left" };' },
    // A deliberate LTR island, tagged as such.
    { code: 'const s = { fontSize: 14, textAlign: "left", writingDirection: "ltr" };' },
    // NOT a style object: the direction context's own default value. Flagging
    // this would mean flagging the definition of the correct pattern.
    { code: 'const ctx = { dir: "ltr", isRTL: false, flip: 1, textAlign: "left" };' },
  ],
  invalid: [
    { code: 'const s = { fontSize: 14, textAlign: "right" };', errors: 1 },
    { code: 'const s = { color: "#000", textAlign: "left" };', errors: 1 },
  ],
});

run('no-writingdirection-with-textalign', plugin.rules['no-writingdirection-with-textalign'], {
  valid: [
    // Coherent pairs: base direction and alignment agree.
    { code: 'const s = { writingDirection: "ltr", textAlign: "left" };' },
    { code: 'const s = { writingDirection: "rtl", textAlign: "right" };' },
    // Centre is direction-neutral.
    { code: 'const s = { writingDirection: "rtl", textAlign: "center" };' },
    // Either one alone is not the bug.
    { code: 'const s = { writingDirection: "rtl" };' },
  ],
  invalid: [
    // The exact pattern that left every login error left-aligned in Hebrew.
    { code: 'const s = { textAlign: "left", writingDirection: "rtl" };', errors: 1 },
    { code: 'const s = { textAlign: "right", writingDirection: "ltr" };', errors: 1 },
  ],
});

run('require-icon-flip', plugin.rules['require-icon-flip'], {
  valid: [
    // Direction-neutral glyphs must NOT mirror — and must not be flagged.
    { code: 'const a = <CloseIcon />;' },
    { code: 'const a = <TrashIcon />;' },
    { code: 'const a = <AvatarIcon size={24} />;' },
    // Directional, and handled.
    { code: 'const a = <ChevronIcon style={{ transform: [{ scaleX: flip }] }} />;' },
    { code: 'const a = <ArrowIcon flip={flip} />;' },
    // Self-mirroring primitives: the flip lives inside the component, so the
    // call site is correct as written and must stay quiet.
    { code: 'const a = <ForwardIcon size={22} />;' },
    { code: 'const a = <BackIcon />;' },
    { code: 'const a = <RowChevronIcon color="#fff" />;' },
  ],
  invalid: [
    // Named for the direction they point rather than what they mean — the trap
    // that had a left-pointing arrow serving as "next" throughout this app.
    { code: 'const a = <ArrowLeftIcon />;', errors: 1 },
    { code: 'const a = <ChevronRightIcon size={20} />;', errors: 1 },
    { code: 'const a = <NextArrow />;', errors: 1 },
  ],
}, jsxTester);

run('no-hardcoded-webview-dir', plugin.rules['no-hardcoded-webview-dir'], {
  valid: [
    // Derived from the app language.
    { code: 'const html = `<html dir="${dir}"><body>${content}</body></html>`;' },
    // Not an HTML document — a plain string mentioning a word.
    { code: 'const s = `direction: ${d}`;' },
  ],
  invalid: [
    { code: 'const html = `<html dir="rtl"><body>${c}</body></html>`;', errors: 1 },
    { code: 'const html = `<html><style>body{direction:rtl}</style><p>${c}</p></html>`;', errors: 1 },
    { code: 'const html = `<html><style>p{text-align:right}</style><body>${c}</body></html>`;', errors: 1 },
  ],
});

console.log(failures === 0 ? '\nAll rule tests passed.' : `\n${failures} rule test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
