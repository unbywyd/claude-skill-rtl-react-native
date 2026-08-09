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

let failures = 0;
function run(name, rule, cases) {
  try {
    ruleTester.run(name, rule, cases);
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

console.log(failures === 0 ? '\nAll rule tests passed.' : `\n${failures} rule test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
