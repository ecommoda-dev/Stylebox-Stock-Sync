// EcomModa — Stylebox Stock Sync · اختبارات مسار الويبهوك
// skills: worker-builder v3.0.0 · shopify-webhook-helper v2.2.0 — 10-09-2026
//
// التشغيل:  node test.mjs        (بلا أي تنصيب — مفيش dependencies خالص)
//
// ══════════════════════════════════════════════════════
// ليه الملف ده موجود
// ══════════════════════════════════════════════════════
// كل أعطال الأداة دي **صامتة** بطبيعتها: الويبهوك بيتبعت من سيرفر شوبيفاي،
// والـ Worker بيرد 200 قبل ما يشتغل أصلاً، والواجهة سجل تاريخي مش شاشة حيّة.
// يعني مفيش أي طريقة تجرّب تعديل بالإيد من غير ما تعمل تغيير مخزون حقيقي
// على المتجر وتستنى وتبص في D1. الاختبارات دي بتقفل الفجوة دي: بتشغّل
// `fetch` بتاع الـ Worker الحقيقي جوّه Node، بـ D1 مزيّف وشبكة مزيّفة،
// فكل حارس بيتأكد في أجزاء من الثانية.
//
// الحالات هنا **مش افتراضية** — كل واحدة فيها بتقفل باج اتكتشف فعلًا
// في الكود (راجع رسالة الكوميت بتاعة نقل الويبهوك). واتأكدنا إنها بتمسك
// فعلًا: ٨ تعديلات مقصودة في الكود (رجوع سر التوقيع للقديم، شيل حارس
// الكمية، خلط الـ 404، شيل حارس الموقع، تعطيل حارس الترتيب، شيل إرجاع
// الحجز، شيل الكاش) — الاختبارات مسكت الـ ٨ كلهم.
//
// 🔴 **حدود التغطية — اقرا ده قبل ما تثق فيها أكتر من اللازم:**
//   • الـ D1 المزيّف بيعيد تنفيذ منطق الحجز الذرّي بنفسه، فأي تعديل في نص
//     الـ SQL بتاع `INSERT .. ON CONFLICT .. WHERE` **مش هيتمسك هنا**.
//     الذرّية الحقيقية بتتأكد في D1 بس.
//   • مفيش أي نداء شبكة حقيقي: لا شوبيفاي ولا ووردبريس ولا HMAC من سيرفر
//     شوبيفاي الفعلي. الاختبارات بتقول إن **المنطق** صح، مش إن الاشتراك
//     شغّال. إثبات إن الويبهوك واصل فعلًا لسه هو صفوف D1 (راجع CLAUDE.md).
//
// ⚠️ ليه بننسخ index.js لملف .mjs مؤقّت بدل ما نستورده على طول؟
// `index.js` فيه `export default` (ESM)، لكن Node بيحدد نوع الموديول من
// الامتداد أو من أقرب package.json. الريبو ده **مافيهوش package.json**
// بقصد — إضافة واحد فيه {"type":"module"} كانت هتخلي Node يقراه صح، بس
// كانت كمان ممكن تغيّر سلوك Cloudflare Workers Builds (يحاول npm install
// أو يدوّر على build command). مخاطرة على النشر مش مستاهلة عشان اختبار،
// فالنسخة المؤقتة هي الحل الآمن.

import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'stock-sync-test-'));
const workerPath = join(tmp, 'worker.mjs');
writeFileSync(workerPath, readFileSync(new URL('./index.js', import.meta.url)));
const worker = (await import(pathToFileURL(workerPath).href)).default;
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

// ══════════════════════════════════════════════════════
// §HARNESS — D1 مزيّف
// ══════════════════════════════════════════════════════
// بيقلّد السلوك الوحيد اللي الاختبارات بتعتمد عليه: كتابة صف في logs،
// والحجز الذرّي في wp_stock_sync_state. شرط الحجز هنا (`trig > الحالي`)
// هو نفس شرط الـ SQL بالظبط — لو اتغيّر في index.js لازم يتغيّر هنا.
function makeDB() {
  const logs = [];
  const state = new Map(); // inventory_item_id -> { last_triggered_at }

  return {
    logs,
    state,
    prepare(sql) {
      let binds = [];
      const api = {
        bind(...b) { binds = b; return api; },

        async run() {
          if (/INSERT INTO logs/.test(sql)) {
            logs.push({
              timestamp: binds[0], tool: binds[1], type: binds[2], employee: binds[3],
              sku: binds[6], delta: binds[8], valueBefore: binds[9], valueAfter: binds[10],
              notes: binds[11], extra: binds[12] ? JSON.parse(binds[12]) : null,
            });
            return { meta: { changes: 1 } };
          }
          if (/INSERT INTO wp_stock_sync_state/.test(sql)) {
            const [id, trig] = binds;
            const cur = state.get(id);
            if (!cur) { state.set(id, { last_triggered_at: trig }); return { meta: { changes: 1 } }; }
            if (trig > cur.last_triggered_at) { cur.last_triggered_at = trig; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          if (/UPDATE wp_stock_sync_state/.test(sql)) {
            // compare-and-set: (newVal, updatedAt, id, expected)
            const [newVal, , id, expected] = binds;
            const cur = state.get(id);
            if (cur && cur.last_triggered_at === expected) {
              cur.last_triggered_at = newVal;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 0 } };
        },

        async first() {
          if (/SELECT last_triggered_at FROM wp_stock_sync_state/.test(sql)) {
            return state.get(binds[0]) || null;
          }
          return null;
        },

        async all() { return { results: [] }; },
      };
      return api;
    },
  };
}

const ENV = {
  DB: null,
  WORKER_SECRET: 'worker-secret',
  CLIENT_ID: 'client-id',
  CLIENT_SECRET: 'app-secret',            // ← سر توقيع الاشتراك الجديد
  SHOPIFY_WEBHOOK_SECRET: 'store-secret', // ← سر توقيع اشتراك الداشبورد القديم
  WP_SYNC_SECRET: 'wp-secret',
  SHOP_DOMAIN: 'shop.myshopify.com',
  LOCATION_ID: '98849620290',
  WP_BASE_URL: 'https://stylebox.online',
};

const INVENTORY_ITEM_ID = 51788908953922;
const PAYLOAD = { inventory_item_id: INVENTORY_ITEM_ID, location_id: 98849620290, available: 121 };

async function sign(secret, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── شبكة مزيّفة ──
// كل اختبار بيحقن ردوده في `net` قبل ما ينادي post().
let net = {};
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/admin/oauth/access_token')) {
    net.oauthCalls = (net.oauthCalls || 0) + 1;
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
  }
  if (u.includes('/graphql.json')) return net.gql();
  if (u.includes('/variation-stock/')) {
    if (opts.method === 'POST') { net.wpPost = JSON.parse(opts.body); return net.wpUpdate(); }
    return net.wpGet();
  }
  throw new Error('نداء شبكة غير متوقّع: ' + u);
};

const variantFound = () => new Response(JSON.stringify({
  data: { inventoryItem: { variants: { edges: [{ node: {
    id: 'gid://shopify/ProductVariant/49745809539394',
    sku: 'GT1 / White / 43',
    metafield: { value: '1127' },
  } }] } } },
}), { status: 200 });

const wpOk = (stock = 100) => new Response(JSON.stringify({
  sku: 'GT1 / White / 43', gtin: '49745809539394', stock_quantity: stock,
}), { status: 200 });

const healthyNet = () => ({
  gql: variantFound,
  wpGet: () => wpOk(100),
  wpUpdate: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
});

let pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };

// بيبعت تسليمة ويبهوك واحدة وبيستنى الشغل الخلفي يخلص قبل ما يرجّع،
// عشان الاختبار يقدر يشوف الصفوف اللي `ctx.waitUntil` كتبها.
async function post(body, { secret = 'app-secret', headers = {}, badSig = false, db = null } = {}) {
  pending = [];
  const raw = JSON.stringify(body);
  const h = {
    'X-Shopify-Hmac-Sha256': badSig ? 'not-a-real-signature' : await sign(secret, raw),
    'X-Shopify-Topic': 'inventory_levels/update',
    'X-Shopify-Webhook-Id': 'wh-1',
    'X-Shopify-Event-Id': 'ev-1',
    'X-Shopify-Triggered-At': '2026-09-10T08:37:07.588456Z',
    ...headers,
  };
  ENV.DB = db || makeDB();
  const res = await worker.fetch(
    new Request('https://worker.dev/webhook', { method: 'POST', headers: h, body: raw }), ENV, ctx
  );
  await Promise.all(pending);
  return { status: res.status, logs: ENV.DB.logs, state: ENV.DB.state, db: ENV.DB };
}

// ══════════════════════════════════════════════════════
// §RUNNER
// ══════════════════════════════════════════════════════
let failures = 0;
let current = '';
const suite = (name) => { current = name; console.log(`\n── ${name} ──`); };
function check(label, passed, detail = '') {
  if (!passed) failures++;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}${passed ? '' : `\n        ${detail}`}`);
}

// ══════════════════════════════════════════════════════
// §TESTS
// ══════════════════════════════════════════════════════

suite('١. المسار السليم — موقّع بـ CLIENT_SECRET (النظام الجديد)');
{
  net = healthyNet();
  const r = await post(PAYLOAD);
  check('بيرد 200', r.status === 200, `رد بـ ${r.status}`);
  check('بيسجّل synced', r.logs[0]?.type === 'synced', JSON.stringify(r.logs));
  check('بيسجّل signedWith=CLIENT_SECRET', r.logs[0]?.extra?.signedWith === 'CLIENT_SECRET',
        JSON.stringify(r.logs[0]?.extra));
  check('بيبعت الكمية الصح لووردبريس', net.wpPost?.quantity === 121, JSON.stringify(net.wpPost));
  check('delta = 121 - 100', r.logs[0]?.delta === 21, String(r.logs[0]?.delta));
  check('بيسجّل X-Shopify-Event-Id', r.logs[0]?.extra?.eventId === 'ev-1',
        JSON.stringify(r.logs[0]?.extra));
}

suite('٢. سر الداشبورد القديم لسه مقبول أثناء فترة النقل');
{
  net = healthyNet();
  const r = await post(PAYLOAD, { secret: 'store-secret' });
  check('التسليمة اتقبلت', r.logs[0]?.type === 'synced', JSON.stringify(r.logs));
  check('متعلّمة إنها بالسر القديم',
        r.logs[0]?.extra?.signedWith === 'SHOPIFY_WEBHOOK_SECRET', JSON.stringify(r.logs[0]?.extra));
}

suite('٣. توقيع مزوّر');
{
  net = healthyNet();
  const r = await post(PAYLOAD, { badSig: true });
  check('بيرد 401', r.status === 401, `رد بـ ${r.status}`);
  check('بيسجّل hmac_failed', r.logs[0]?.type === 'hmac_failed', JSON.stringify(r.logs));
  check('اللوج فيه envKeys للتشخيص', Array.isArray(r.logs[0]?.extra?.envKeys),
        JSON.stringify(r.logs[0]?.extra));
  check('ما نادىش ووردبريس', net.wpPost === undefined, JSON.stringify(net.wpPost));
}

suite('٤. الأخطر: available غايبة — ممنوع تصفير الاستوك');
{
  net = healthyNet();
  const r = await post({ inventory_item_id: INVENTORY_ITEM_ID, location_id: 98849620290, available: null });
  check('ما نادىش ووردبريس خالص', net.wpPost === undefined, JSON.stringify(net.wpPost));
  check('بيسجّل empty_payload_bug', r.logs[0]?.type === 'empty_payload_bug', JSON.stringify(r.logs));
}

suite('٥. available = 0 قيمة شرعية ولازم تتزامن');
{
  net = healthyNet();
  const r = await post({ ...PAYLOAD, available: 0 });
  check('بعت quantity = 0', net.wpPost?.quantity === 0, JSON.stringify(net.wpPost));
  check('بيسجّل synced', r.logs[0]?.type === 'synced', JSON.stringify(r.logs));
}

suite('٦. إضافة ووردبريس واقفة (rest_no_route) — مش variation ناقصة');
{
  net = healthyNet();
  net.wpGet = () => new Response(JSON.stringify({ code: 'rest_no_route', message: 'No route' }), { status: 404 });
  const r = await post(PAYLOAD);
  check('مش متسجّلة غلط كـ wp_variation_not_found',
        r.logs[0]?.type !== 'wp_variation_not_found', `النوع: ${r.logs[0]?.type}`);
  check('بيسجّل unexpected_error', r.logs[0]?.type === 'unexpected_error', JSON.stringify(r.logs[0]));
  check('الرسالة بتقول endpoint', /endpoint/.test(r.logs[0]?.notes || ''), r.logs[0]?.notes);
  check('الحجز اترجّع عشان إعادة المزامنة',
        r.state.get(String(INVENTORY_ITEM_ID))?.last_triggered_at === '',
        JSON.stringify([...r.state]));
}

suite('٧. variation ناقصة فعلًا لسه بتتقرا زي الأول');
{
  net = healthyNet();
  net.wpGet = () => new Response(JSON.stringify({ code: 'woo_variation_missing' }), { status: 404 });
  const r = await post(PAYLOAD);
  check('بيسجّل wp_variation_not_found', r.logs[0]?.type === 'wp_variation_not_found',
        JSON.stringify(r.logs[0]));
}

suite('٨. موقع مختلف — حارس LOCATION_ID');
{
  net = healthyNet();
  const r = await post({ ...PAYLOAD, location_id: 111 });
  check('بيسجّل location_skipped', r.logs[0]?.type === 'location_skipped', JSON.stringify(r.logs));
  check('ما نادىش ووردبريس', net.wpPost === undefined, JSON.stringify(net.wpPost));
}

suite('٩. حارس الترتيب — الحدث الأقدم بيتتخطى');
{
  net = healthyNet();
  const db = makeDB();
  await post(PAYLOAD, { db, headers: { 'X-Shopify-Triggered-At': '2026-09-10T10:00:00.000001Z' } });
  const older = await post(PAYLOAD, { db, headers: { 'X-Shopify-Triggered-At': '2026-09-10T09:00:00.000001Z' } });
  check('الأحدث اتزامن', db.logs[0]?.type === 'synced', JSON.stringify(db.logs[0]));
  check('الأقدم اتتخطى', older.logs[1]?.type === 'stale_event_skipped', JSON.stringify(older.logs[1]));

  // إعادة تسليم لنفس الحدث (نفس triggered_at) — لازم تتتخطى هي كمان
  const retry = await post(PAYLOAD, { db, headers: { 'X-Shopify-Triggered-At': '2026-09-10T10:00:00.000001Z' } });
  check('إعادة تسليم نفس الحدث بتتتخطى',
        retry.logs[2]?.type === 'stale_event_skipped', JSON.stringify(retry.logs[2]));
}

suite('١٠. غياب X-Shopify-Triggered-At مش خطأ');
{
  net = healthyNet();
  const r = await post(PAYLOAD, { headers: { 'X-Shopify-Triggered-At': undefined } });
  check('بيسجّل no_triggered_at_header', r.logs[0]?.type === 'no_triggered_at_header',
        JSON.stringify(r.logs.map((l) => l.type)));
  check('وبيكمّل المزامنة عادي', r.logs[1]?.type === 'synced', JSON.stringify(r.logs[1]));
}

suite('١١. فرع ?action=shopify_webhook القديم اتشال');
{
  const raw = JSON.stringify(PAYLOAD);
  ENV.DB = makeDB();
  const res = await worker.fetch(new Request('https://worker.dev/?action=shopify_webhook', {
    method: 'POST',
    headers: { 'X-Shopify-Hmac-Sha256': await sign('app-secret', raw) },
    body: raw,
  }), ENV, ctx);
  check('بقى وراء حارس WORKER_SECRET (401)', res.status === 401, `رد بـ ${res.status}`);
}

suite('١٢. ترتيب الفروع — الويبهوك قبل حارس WORKER_SECRET');
{
  // الفخ المتوثّق في CLAUDE.md: شوبيفاي مبتبعتش Authorization خالص.
  // لو الحارس اتحرّك قبل فرع الويبهوك، الاختبار ده بيرجع 401.
  net = healthyNet();
  const r = await post(PAYLOAD); // بلا أي Authorization header
  check('تسليمة بلا Authorization بتعدّي', r.status === 200, `رد بـ ${r.status}`);
}

suite('١٣. ?action=version — إثبات النشر');
{
  ENV.DB = makeDB();
  const res = await worker.fetch(new Request('https://worker.dev/?action=version', {
    headers: { Authorization: 'Bearer worker-secret' },
  }), ENV, ctx);
  const body = await res.json();
  check('بيرد 200', res.status === 200, `رد بـ ${res.status}`);
  check('بيرجّع رقم إصدار', typeof body.version === 'string' && body.version.length > 0,
        JSON.stringify(body));
  check('بيرجّع قيمة LOCATION_ID الفعلية', body.env?.LOCATION_ID === '98849620290',
        JSON.stringify(body.env));
  check('بيرجّع وجود الأسرار من غير قيمها',
        body.env?.secretsPresent?.CLIENT_SECRET === true && !JSON.stringify(body).includes('app-secret'),
        JSON.stringify(body.env));

  const unauth = await worker.fetch(new Request('https://worker.dev/?action=version'), ENV, ctx);
  check('محمي بـ WORKER_SECRET', unauth.status === 401, `رد بـ ${unauth.status}`);
}

suite('١٤. كاش توكن OAuth');
{
  // لازم يتقاس في عملية لوحده: الكاش على مستوى الموديول، فأي اختبار قبله
  // بيكون سخّنه بالفعل. الفحص هنا بيتأكد بس إنه مش بيجيب توكن جديد كل مرة.
  net = healthyNet();
  net.oauthCalls = 0;
  await post(PAYLOAD, { headers: { 'X-Shopify-Triggered-At': '2026-09-10T11:00:00.000001Z' } });
  await post(PAYLOAD, { headers: { 'X-Shopify-Triggered-At': '2026-09-10T11:00:01.000001Z' } });
  check('تسليمتين بلا نداء OAuth جديد', net.oauthCalls === 0, `عدد النداءات: ${net.oauthCalls}`);
}

suite('١٥. حساب توقيت القاهرة (ecommoda-constants §13)');
{
  // نفس منطق formatDT في index.html — الاختبار بيقفل الباج اللي كان
  // هيظهر يوم 29-10-2026 لما مصر ترجع UTC+2.
  const FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  const fmt = (iso) => {
    const p = {};
    for (const part of FMT.formatToParts(new Date(iso))) p[part.type] = part.value;
    return `${p.day}/${p.month} ${p.hour}:${p.minute}${String(p.dayPeriod).toUpperCase() === 'PM' ? 'م' : 'ص'}`;
  };
  const fixedOffset = (iso) => {
    const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    let h = d.getUTCHours(); const a = h >= 12 ? 'م' : 'ص'; h = h % 12 || 12;
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(h)}:${pad(d.getUTCMinutes())}${a}`;
  };
  const summer = '2026-09-10T09:08:40Z';
  const winter = '2026-12-15T13:05:00Z';
  check('صيفًا: نفس نتيجة الكود القديم', fmt(summer) === fixedOffset(summer),
        `${fmt(summer)} ≠ ${fixedOffset(summer)}`);
  check('شتاءً: الكود القديم كان بيغلط بساعة', fmt(winter) !== fixedOffset(winter),
        `الاتنين رجّعوا ${fmt(winter)} — الباج مش مقفول`);
  check('شتاءً: القيمة الصح UTC+2', fmt(winter) === '15/12 03:05م', fmt(winter));
  check('منتصف الليل بيتعرض 12 ص', fmt('2026-12-15T22:05:00Z') === '16/12 12:05ص',
        fmt('2026-12-15T22:05:00Z'));
}

// ══════════════════════════════════════════════════════
console.log(failures ? `\n❌ ${failures} فحص فشل\n` : '\n✅ كل الفحوص عدّت\n');
process.exit(failures ? 1 : 0);
