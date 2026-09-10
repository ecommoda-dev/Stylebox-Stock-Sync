// EcomModa — Stylebox Stock Sync · فحص الواجهة قبل التسليم
// skills: html-builder v7.0.0 — 10-09-2026
//
// التشغيل:  node check-html.mjs        (بلا أي تنصيب)
//
// ══════════════════════════════════════════════════════
// ليه الملف ده موجود
// ══════════════════════════════════════════════════════
// الفحص بالـ grep بيعدّ نصوص — مابيقراش CSS ولا JS. تلات أنواع أعطال بتعدّي
// منه وبتوصل الإنتاج **في صمت** (الصفحة بتفتح والكونسول نضيف):
//   ① كتلة التوكنز `:root` بتتبلع جوّه selector غلط بسبب تعليق متداخل ⇒ كل
//      `var(--x)` في المشروع بتبقى فاضية، فنص الستايل شغّال ونصّه لأ.
//   ② `var(` مش مقفولة ⇒ الـ `<style>` كله بيفشل يتقرا.
//   ③ دالة متنادية ومش معرّفة ⇒ ReferenceError على أول رسم. و`node --check`
//      بيعدّي عليها لأنها سليمة **نحويًا** — الفرق بين النحو والربط.
//
// الفحوص دي اتجرّبت على ٦ أعطال مقصودة (شيل تعريف دالة · توكن مش معرّف ·
// var( مفتوحة · تعليق متداخل بيبلع :root · onclick بينادي دالة مش موجودة ·
// توكن اتشال والاستخدام فضل) — مسكت الستة.
//
// ⚠️ حدود التغطية: ده فحص **بنية** مش فحص سلوك. مابيقولش إن الشاشة شكلها صح
//    ولا إن الفلاتر بتفلتر — بيقول إن الملف بيتقرا وإن كل اسم له تعريف.

import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('./index.html', import.meta.url).pathname;
const html = readFileSync(file, 'utf8');

// ══════════════════════════════════════════════════════
// §CSS — فحص بـ parser
// ══════════════════════════════════════════════════════
console.log('── CSS ──');

const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
if (!styles.length) { console.log('مفيش <style>'); process.exit(1); }
let fail = 0;
const cssRaw = styles.join('\n');
// التعليقات بتتشال قبل أي فحص محتوى — تعليق بيشرح var(--token) مش استخدام
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

// ① تعليقات شاردة
const opens = (cssRaw.match(/\/\*/g) || []).length, closes = (cssRaw.match(/\*\//g) || []).length;
console.log(`تعليقات: ${opens} فتح / ${closes} قفل ${opens === closes ? '✅' : '❌'}`);
if (opens !== closes) fail++;

// ② اتزان الأقواس + var( مقفولة
let depth = 0, bad = 0;
for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
  if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth < 0) bad++; }
}
console.log(`أقواس: عمق نهائي ${depth} ${depth === 0 && !bad ? '✅' : '❌'}`);
if (depth !== 0 || bad) fail++;
const varOpen = (css.match(/var\(/g) || []).length;
const varClosed = (css.match(/var\(\s*--[A-Za-z0-9-]+\s*(?:,[^()]*)?\)/g) || []).length;
console.log(`var(): ${varOpen} استخدام / ${varClosed} مقفولة سليمة ${varOpen === varClosed ? '✅' : '❌'}`);
if (varOpen !== varClosed) fail++;

// ③ كتلة التوكنز لازم تكون :root بالظبط
const rootRe = /(^|})\s*([^{}]*?):root[^{}]*\{([\s\S]*?)\}/;
const m = css.match(/:root\s*\{([\s\S]*?)\}/);
if (!m) { console.log('❌ مفيش كتلة :root'); fail++; }
// بعد شيل التعليقات، اللي قبل `:root` لازم يكون `}` أو بداية الملف. أي حاجة
// تانية معناها إن `:root` بقت **جزء من selector تاني** فكتلة التوكنز اتبلعت.
// ⚠️ عدّ الأقواس لوحده مابيمسكش دي: نص شارد بلا أقواس بيسيب العدّ متزن.
const beforeRoot = css.slice(0, css.indexOf(':root')).replace(/\s+$/, '');
const prevChar = beforeRoot.slice(-1);
const rootTopLevel = beforeRoot.length === 0 || prevChar === '}';
console.log(`:root على المستوى الأعلى ${rootTopLevel ? '✅' : `❌ (متبلعة جوّه selector — قبلها «${beforeRoot.slice(-40).trim()}»)`}`);
if (!rootTopLevel) fail++;

const openBefore = (beforeRoot.match(/\{/g)||[]).length;
const closeBefore = (beforeRoot.match(/\}/g)||[]).length;
if (openBefore !== closeBefore) { console.log('❌ أقواس غير متزنة قبل :root'); fail++; }

// ④ كل var(--x) مستخدمة لازم تكون معرّفة
const defined = new Set([...(m ? m[1] : '').matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map(x => x[1]));
const used = new Set([...css.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map(x => x[1]));
const missing = [...used].filter(v => !defined.has(v));
console.log(`توكنز: ${defined.size} معرّف · ${used.size} مستخدم · ${missing.length} ناقص ${missing.length ? '❌ ' + missing.join(', ') : '✅'}`);
if (missing.length) fail++;
const unused = [...defined].filter(v => !used.has(v));
if (unused.length) console.log(`   (معرّف ومش مستخدم — مش خطأ: ${unused.join(', ')})`);

// ⑤ مستند مولّد بـ var() — البارسر بيعتبرها معرّفة وهي فاضية وقت التشغيل
const gen = /window\.open|document\.write/.test(html);
console.log(`مستند مولّد: ${gen ? '⚠️ موجود — راجع var() جوّاه' : '✅ مفيش'}`);



// ══════════════════════════════════════════════════════
// §JS — فحص الربط (Step 9B)
// ══════════════════════════════════════════════════════
console.log('');
console.log('── JS ──');

const jsRaw = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
// التعليقات بتتشال قبل أي فحص — تعليق عربي فيه «contains()» مش نداء دالة.
// بتتبدّل بمسافات عشان أرقام السطور تفضل مظبوطة.
const js = jsRaw
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

// النصوص كمان بتتشال: «الـ Worker (شبكة أو CORS)» جوّه رسالة خطأ مش نداء دالة.
// في الـ template literals بنسيب محتوى ${...} — ده كود حقيقي وبينادي دوال.
function stripStrings(src) {
  return src
    .replace(/`(?:\\.|\$\{(?:[^{}]|\{[^}]*\})*\}|[^`\\])*`/g, (lit) => {
      const exprs = [...lit.matchAll(/\$\{((?:[^{}]|\{[^}]*\})*)\}/g)].map(m => m[1]).join(';');
      return '`' + ' ' + exprs + ' ' + '`';
    })
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

const BROWSER_GLOBALS = new Set(['window','document','console','localStorage','sessionStorage','fetch',
 'setTimeout','clearTimeout','setInterval','clearInterval','Promise','JSON','Math','Date','Number','String',
 'Object','Array','Set','Map','RegExp','Error','URL','URLSearchParams','AbortController','Blob','FormData',
 'Intl','isNaN','parseInt','parseFloat','encodeURIComponent','decodeURIComponent','alert','confirm','prompt',
 'requestAnimationFrame','cancelAnimationFrame','ExcelJS','AudioContext','webkitAudioContext','navigator',
 'location','history','Boolean','Symbol','BigInt','structuredClone','queueMicrotask','TextEncoder','btoa','atob',
 'crypto','Element','HTMLElement','Event','CustomEvent','MutationObserver','ResizeObserver','Image','undefined',
 'NaN','Infinity','globalThis','Function','this','arguments','event']);

// التعريفات: function X · const/let/var X · X = function
const jsDefined = new Set([
  ...[...js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
  ...[...js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
  ...[...js.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)].flatMap(m =>
      m[1].split(',').map(x => x.split(':').pop().trim().replace(/=.*/, '').trim()).filter(Boolean)),
  ...[...js.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)].flatMap(m =>
      m[1].split(',').map(x => x.split('=')[0].trim().replace(/^\{|\}$/g,'').split(':').pop().trim()).filter(Boolean)),
  ...[...js.matchAll(/\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)].map(m => m[1]),
  ...[...js.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
  ...[...js.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
]);

// النداءات: X(  — في الـ JS وفي الـ inline onclick بتوع الـ HTML
const jsCode = stripStrings(js);
const calledJs   = [...jsCode.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
const inline     = [...html.matchAll(/\bon[a-z]+="([^"]*)"/g)].map(m => m[1]).join(';');
const calledHtml = [...inline.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);

const KEYWORDS = new Set(['if','for','while','switch','catch','return','typeof','function','new','await',
  'else','do','try','throw','in','of','delete','void','instanceof','case','yield']);

const problems = [];
for (const [src, names] of [['JS', calledJs], ['inline onclick', calledHtml]]) {
  for (const n of new Set(names)) {
    if (KEYWORDS.has(n) || BROWSER_GLOBALS.has(n) || jsDefined.has(n)) continue;
    problems.push(`${src}: ${n}()`);
  }
}
console.log(`معرّف: ${jsDefined.size} · متنادى (JS): ${new Set(calledJs).size} · متنادى (inline): ${new Set(calledHtml).size}`);
if (problems.length) { console.log('❌ متنادى ومش معرّف:\n  ' + problems.join('\n  ')); fail++; }
console.log('✅ كل اسم متنادى له تعريف');

console.log('');
console.log(fail ? `❌ ${fail} مشكلة` : '✅ الواجهة عدّت كل الفحوص');
process.exit(fail ? 1 : 0);
