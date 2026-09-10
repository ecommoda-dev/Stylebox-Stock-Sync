// EcomModa — Stylebox Stock Sync (Worker)
// skills: worker-builder v3.0.0 · html-builder v7.0.0 · constants v2.0.0 · woocommerce-sync-helper v1.0.0 · shopify-graphql-helper v2.1.0 · shopify-webhook-helper v2.2.0 — 10-09-2026
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════
const TOOL_NAME = 'wp_stock_sync';
const TOOL_VERSION = '2.0.0';
const API_VERSION = '2026-01';

// الاشتراك اتنقل من ويبهوك داشبورد شوبيفاي (Settings → Notifications) إلى
// Webhook Control Center (webhookSubscriptionCreate عبر الـ API) — 10-09-2026.
// التبعة الوحيدة اللي بتوقف الأداة لو اتنسيت: **السر اللي بيوقّع الويبهوك
// بيتغيّر**. اشتراك الداشبورد كان بيتوقّع بـ store-level secret
// (SHOPIFY_WEBHOOK_SECRET)، والاشتراك المعمول بالـ API بيتوقّع بسر التطبيق
// نفسه (CLIENT_SECRET). التحقق تحت بيقبل الاتنين أثناء فترة النقل بس —
// راجع §WEBHOOK::verify وخطوات إسقاط القديم في CLAUDE.md.
// الترتيب مهم: الجديد الأول. أول ما السجل يبقى كله signedWith=CLIENT_SECRET
// لمدة يوم كامل، يتشال 'SHOPIFY_WEBHOOK_SECRET' من الليستة دي ويتحذف السر
// من الداشبورد — راجع «إسقاط السر القديم» في CLAUDE.md.
const WEBHOOK_SECRET_VARS = ['CLIENT_SECRET', 'SHOPIFY_WEBHOOK_SECRET'];

// ══════════════════════════════════════════════════════
// §CORS — Option B (write tool, strict allowlist)
// ملاحظة: الـ CORS هنا بيحمي فقط الـ endpoints الإدارية (get_logs،
// check_employee، إلخ) لو اتفتحت من متصفح — مسار الويبهوك نفسه
// (POST /webhook) بييجي من سيرفر Shopify مش من متصفح،
// فمش بيعتمد على الـ CORS أساساً.
// ══════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];
function getCORS(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': '*' });
  return new Response(JSON.stringify(data), { status, headers });
}

// ── §HELPERS::safeEqual ──
// مقارنة ثابتة الزمن — `===` على الـ digest بيسرّب معلومات توقيت.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── §HELPERS::verifyShopifyHmac ──
// تحقق من توقيع Shopify على الـ raw body بسر واحد محدّد.
// ⚠️ `!secret` لازم ترجع false صراحةً: من غير الحارس ده، سر ناقص بيتحوّل
// لـ encode(undefined) — يعني الـ Worker بيحسب digest بسر اسمه حرفيًا
// "undefined" ويقارن بيه، فالفشل بيبقى شكله "توقيع غلط" مش "السر ناقص".
// و`.trim()` مقصودة: مسافة زايدة في قيمة السر في الداشبورد بتفشل بصمت.
async function verifyShopifyHmac(secret, rawBody, hmacHeader) {
  if (!secret || !hmacHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(String(secret).trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const digest = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return safeEqual(digest, hmacHeader);
}

// ── §HELPERS::verifyShopifyHmacAny ──
// بيجرّب أسرار §CONSTANTS بالترتيب وبيرجّع اسم السر اللي طابق — الاسم ده
// بيتسجّل في D1 مع كل تسليمة، وهو الدليل الوحيد على إن النقل خلص فعليًا:
// أول ما كل الصفوف تبقى CLIENT_SECRET، الاشتراك القديم مات ويُحذف السر القديم.
async function verifyShopifyHmacAny(env, rawBody, hmacHeader) {
  for (const name of WEBHOOK_SECRET_VARS) {
    if (!env[name]) continue;
    if (await verifyShopifyHmac(env[name], rawBody, hmacHeader)) {
      return { valid: true, signedWith: name };
    }
  }
  return { valid: false, signedWith: null };
}

// ── §HELPERS::toQuantity ──
// بترجّع رقم صحيح أو null — **مش** صفر. الفرق ده هو كل الحكاية:
// `Number(null)` و`Number('')` الاتنين بيرجّعوا **0**، فأي محاولة "تنضيف"
// بـ Number() لوحدها كانت هتحوّل كمية غايبة لصفر وتصفّر استوك المنتج
// على ووردبريس وتسجّلها `synced`. القيم غير الرقمية بترجع null عشان
// المنادي يوقف صراحةً.
function toQuantity(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── §HELPERS::normalizeTriggeredAt ──
// حارس الترتيب بيقارن الطوابع الزمنية **كنص** (شرط SQL)، فالصيغة لازم
// تبقى متسقة. لكن الحل الساذج — `new Date(raw).toISOString()` على طول —
// **بيكسر أكتر مما بيصلّح**:
//   ١. شوبيفاي بتبعت دقة ميكروثانية (`...:07.588456Z`) و toISOString
//      بترجّع ميلي بس (`...:07.588Z`) — يعني قص دقة على كل حدث.
//   ٢. الجدول فيه بالفعل آلاف القيم الخام المتخزّنة بالصيغة الأصلية،
//      فمقارنة قيمة مقصوصة بقيمة خام بتدي نتايج عشوائية عند نفس الثانية.
// فالقاعدة هنا: لو الصيغة أصلاً ISO-UTC (وهي كده دايمًا من شوبيفاي)،
// سيبها **زي ما هي بالحرف** — متسقة مع المتخزّن ومحتفظة بكامل الدقة.
// التحويل بيحصل بس لو وصلت صيغة غير متوقّعة، وغير القابل للقراءة بيرجع
// null فيتخطى الحارس بوعي (no_triggered_at_header) بدل مقارنة غلط.
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function normalizeTriggeredAt(raw) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (ISO_UTC_RE.test(v)) return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ══════════════════════════════════════════════════════
// SHARED: Auth & Logging Functions — EcomModa D1 Pattern v1.3.0
// Copy this block VERBATIM into every Worker — no modifications
// ══════════════════════════════════════════════════════
async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();
  if (!row) return null;
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username).run().catch(() => {});
  return row.display_name;
}

async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();
  if (!row) return { exists: false, hasPin: false, isActive: false };
  return { exists: true, hasPin: !!row.pin, isActive: !!row.is_active };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();
  if (!row) throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin) throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');
  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?').bind(pin, username).run();
  return true;
}

async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee ?? null,
    entry.orderId ?? null,
    entry.orderName ?? null,
    entry.sku ?? null,
    entry.productTitle ?? null,
    entry.delta ?? null,
    entry.valueBefore ?? null,
    entry.valueAfter ?? null,
    entry.notes ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

async function getLogs(db, { tool = null, employee = null, type = null, search = null, limit = 100, offset = 0 } = {}) {
  let sql = "SELECT * FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];
  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (type) { sql += ' AND type = ?'; b.push(type); }
  if (search) { sql += ' AND (sku LIKE ? OR notes LIKE ?)'; b.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  b.push(Math.min(limit, 100), offset);
  return (await db.prepare(sql).bind(...b).all()).results;
}

async function getLogsCount(db, { tool = null, employee = null, type = null, search = null } = {}) {
  let sql = "SELECT COUNT(*) as total FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];
  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (type) { sql += ' AND type = ?'; b.push(type); }
  if (search) { sql += ' AND (sku LIKE ? OR notes LIKE ?)'; b.push(`%${search}%`, `%${search}%`); }
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

async function getLogsExport(db, { tool = null, employee = null, type = null, search = null } = {}) {
  let sql = "SELECT * FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];
  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (type) { sql += ' AND type = ?'; b.push(type); }
  if (search) { sql += ' AND (sku LIKE ? OR notes LIKE ?)'; b.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY timestamp DESC LIMIT 2000';
  return (await db.prepare(sql).bind(...b).all()).results;
}
// ══════════════════════════════════════════════════════
// END SHARED BLOCK
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════
// ── §SHOPIFY::getAccessToken ──
// التوكن متخزّن على مستوى الـ isolate. من غير الكاش ده كل تسليمة ويبهوك
// كانت بتعمل نداء OAuth كامل قبل أي شغل مفيد — نداء شبكة زايد على كل حدث
// مخزون في المتجر، وده أكبر مصدر تأخير في المسار ده.
// الكاش آمن لأنه ما بيتشاركش بين حسابات: الـ Worker ده ليه CLIENT_ID واحد.
let cachedToken = null; // { token, expiresAt }

function requireEnv(env, names) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`متغيّرات ناقصة في الـ Worker: ${missing.join(', ')}`);
}

async function getAccessToken(env, { force = false } = {}) {
  requireEnv(env, ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET']);
  if (!force && cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const shopDomain = env.SHOP_DOMAIN.replace(/\/$/, '');
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    cachedToken = null;
    throw new Error(`OAuth failed: ${res.status} ${JSON.stringify(data)}`);
  }
  // هامش دقيقة قبل الانتهاء الحقيقي — عشان ما نستخدمش توكن بيموت أثناء النداء.
  const ttlMs = Number.isFinite(data.expires_in)
    ? Math.max(60_000, data.expires_in * 1000 - 60_000)
    : 30 * 60 * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlMs };
  return data.access_token;
}

// ── §SHOPIFY::shopifyGQL ──
// بياخد التوكن بنفسه (من الكاش) وبيعيد المحاولة مرة واحدة لو التوكن المكاشد
// اتلغى (401). كمان بيتحقق من حالة الـ HTTP قبل قراءة الـ JSON: من غير كده،
// أي رد مش-JSON (429/502 وصفحة HTML) بيرمي "Unexpected token <" — رسالة
// بتخفي السبب الحقيقي في السجل.
async function shopifyGQL(env, query, variables = {}, { retryOn401 = true } = {}) {
  const shopDomain = env.SHOP_DOMAIN.replace(/\/$/, '');
  const token = await getAccessToken(env);
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 401 && retryOn401) {
    cachedToken = null;
    await getAccessToken(env, { force: true });
    return shopifyGQL(env, query, variables, { retryOn401: false });
  }
  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.errors) throw new Error('GraphQL error: ' + JSON.stringify(data.errors));
  return data.data;
}

// ── §SHOPIFY::lookupVariantByInventoryItem ──
// استعلام لحظي واحد — بلا cache دائم — بيرجع variant_id + sku + قيمة
// الـ metafield wordpress_variation_id (لو موجودة). مفيش تخزين محلي
// لأن الـ metafield ممكن تتضاف لاحقاً وعايزين نشوف أحدث قيمة كل مرة.
async function lookupVariantByInventoryItem(env, inventoryItemId) {
  const QUERY = `
    query GetVariantByInventoryItem($id: ID!) {
      inventoryItem(id: $id) {
        variants(first: 1) {
          edges { node {
            id
            sku
            metafield(namespace: "custom", key: "wordpress_variation_id") { value }
          }}
        }
      }
    }`;
  const gid = `gid://shopify/InventoryItem/${inventoryItemId}`;
  const data = await shopifyGQL(env, QUERY, { id: gid });
  const edge = data?.inventoryItem?.variants?.edges?.[0];
  if (!edge) return null;

  const node = edge.node;
  return {
    variantId: node.id.replace('gid://shopify/ProductVariant/', ''),
    sku: node.sku,
    wordpressVariationId: node.metafield?.value ? parseInt(node.metafield.value, 10) : null,
  };
}

// ══════════════════════════════════════════════════════
// §WOOCOMMERCE
// ══════════════════════════════════════════════════════
// ── §WOOCOMMERCE::wcGetVariationStock ──
// 🔴 404 من ووردبريس ليه معنيين مختلفين تمامًا، والكود القديم كان بيخلطهم:
//   (أ) الـ variation نفسها مش موجودة  → نتيجة بيانات، بترجع null وبتتسجّل
//       wp_variation_not_found. الـ variant ده بس هو المتأثر.
//   (ب) الـ route كله مش موجود (`rest_no_route`) — الإضافة اتوقفت أو
//       اتشالت → **كل** variant في المتجر هيرجع 404، والسجل هيمتلي
//       wp_variation_not_found وكأن ووردبريس فقد آلاف المنتجات فجأة.
// الحالتين كانوا شكلهم واحد بالظبط في السجل، فعطل إضافة كامل كان بيتقرا
// غلط على إنه مشكلة بيانات. الفرق دلوقتي صريح: (ب) بترمي، فبتتسجّل
// unexpected_error برسالة بتقول إن الـ endpoint نفسه غايب.
async function wcGetVariationStock(env, variationId) {
  requireEnv(env, ['WP_BASE_URL', 'WP_SYNC_SECRET']);
  const res = await fetch(
    `${env.WP_BASE_URL.replace(/\/$/, '')}/wp-json/ecommoda/v1/variation-stock/${variationId}`,
    { headers: { 'X-EcomModa-Secret': env.WP_SYNC_SECRET } }
  );

  if (res.status === 404) {
    const text = await res.text();
    let code = '';
    try { code = (JSON.parse(text) || {}).code || ''; } catch { /* رد مش JSON */ }
    if (code === 'rest_no_route' || code === 'rest_not_found') {
      throw new Error(
        `endpoint المزامنة نفسه مش موجود على WordPress (${code}) — الإضافة متوقفة أو المسار اتغيّر. ` +
        `ده بيأثر على كل الـ variants مش واحدة.`
      );
    }
    return null; // الـ variation دي بالذات مش موجودة
  }

  if (!res.ok) throw new Error(`WP GET failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function wcUpdateVariationStock(env, variationId, quantity) {
  const res = await fetch(
    `${env.WP_BASE_URL.replace(/\/$/, '')}/wp-json/ecommoda/v1/variation-stock/${variationId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EcomModa-Secret': env.WP_SYNC_SECRET },
      body: JSON.stringify({ quantity }),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WP POST failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// ══════════════════════════════════════════════════════
// §ORDERING-GUARD
// جدول حالة صغير — مش جدول mapping (مفيش SKU/variant اتخزن هنا،
// لسه بيتم الـ lookup اللحظي زي ما هو). الهدف الوحيد: منع حدث
// قديم (وصل متأخر بسبب إعادة إرسال) من الكتابة فوق قيمة أحدث،
// لأن Shopify مش بتضمن ترتيب تسليم الويبهوكات.
//
// شغّل مرة واحدة في D1 Console قبل أول استخدام (سطر واحد، من
// غير أي تعليقات -- جوه الاستعلام نفسه):
//
// CREATE TABLE IF NOT EXISTS wp_stock_sync_state (inventory_item_id TEXT PRIMARY KEY, last_triggered_at TEXT, updated_at TEXT);
// ══════════════════════════════════════════════════════

// ── §ORDERING-GUARD::claimIfNewer ──
// عملية atomic واحدة (INSERT .. ON CONFLICT .. WHERE): لو مفيش سطر
// لنفس الـ inventory_item_id بيتعمله INSERT عادي. لو موجود، التحديث
// بيحصل بس لو triggered_at الجديد أحدث من المخزّن — لو الشرط فشل،
// UPDATE مبيحصلش وres.meta.changes بترجع 0، يعني الحدث ده قديم
// ولازم يتجاهل. مفيش سباق ممكن بين تسليمتين متزامنتين لنفس الـ variant
// لأنها استعلام SQL واحد ذري، مش قراءة ثم كتابة منفصلين.
async function claimIfNewer(db, inventoryItemId, triggeredAt) {
  const now = new Date().toISOString();
  // القراءة دي **مش** جزء من الذرّية — الحجز نفسه لسه استعلام واحد تحت.
  // الغرض منها بس إننا نعرف القيمة القديمة عشان نقدر نرجّعها لو الحدث فشل
  // فشل مؤقّت (راجع releaseClaim).
  const prev = await db.prepare(
    'SELECT last_triggered_at FROM wp_stock_sync_state WHERE inventory_item_id = ?'
  ).bind(inventoryItemId).first();

  const res = await db.prepare(`
    INSERT INTO wp_stock_sync_state (inventory_item_id, last_triggered_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(inventory_item_id) DO UPDATE SET
      last_triggered_at = excluded.last_triggered_at,
      updated_at        = excluded.updated_at
    WHERE excluded.last_triggered_at > wp_stock_sync_state.last_triggered_at
  `).bind(inventoryItemId, triggeredAt, now).run();

  return {
    claimed: (res.meta?.changes ?? 0) > 0,
    previousTriggeredAt: prev?.last_triggered_at ?? null,
  };
}

// ── §ORDERING-GUARD::releaseClaim ──
// الحجز بيتقدّم **قبل** الشغل الفعلي (لازم كده — الذرّية هي اللي بتمنع
// السباق). لو الشغل فشل بعدين فشل مؤقّت (WooCommerce واقع، Shopify رجّع
// خطأ)، الحالة بتفضل متقدّمة على حدث ما اتنفّذش — وأي إعادة تسليم لنفس
// الحدث بنفس الـ triggered_at بترجع stale_event_skipped، فالفرصة بتضيع نهائيًا.
// الإرجاع هنا compare-and-set: بيرجّع القيمة القديمة **بس** لو اللي متخزّن
// لسه هو حجزنا إحنا — عشان ما ندوسش على حدث أحدث سبقنا في الوقت ده.
// القيمة الفاضية '' مقصودة بدل NULL: `x > NULL` في SQLite بترجع NULL
// (falsy)، يعني صف بـ NULL مش هيتحجز تاني أبدًا.
async function releaseClaim(db, inventoryItemId, triggeredAt, previousTriggeredAt) {
  await db.prepare(`
    UPDATE wp_stock_sync_state
    SET last_triggered_at = ?, updated_at = ?
    WHERE inventory_item_id = ? AND last_triggered_at = ?
  `).bind(previousTriggeredAt ?? '', new Date().toISOString(), inventoryItemId, triggeredAt).run();
}

// ══════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    // 1. CORS Preflight — ALWAYS first
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
    }

    // ─── §WEBHOOK ─── (Shopify هي اللي بتنادي المسار ده — من غير Bearer،
    // لأن شوبيفاي مبتبعتش Authorization أصلاً؛ التوقيع بييجي في
    // X-Shopify-Hmac-Sha256. 🔴 الفرع ده لازم يفضل **قبل** حارس
    // WORKER_SECRET تحت — أي إعادة ترتيب = كل تسليمة بترجع 401
    // والاستوك بيقف عن المزامنة بصمت.)
    //
    // فرع `?action=shopify_webhook` القديم اتشال (10-09-2026): الاشتراك
    // الوحيد اللي كان موجود على الداشبورد كان بيضرب `/webhook` بالفعل،
    // والاشتراك الجديد في Webhook Control Center مسجّل على `/webhook` كمان.
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleShopifyWebhook(request, env, ctx);
    }

    // 2. WORKER_SECRET check — ALWAYS second (everything else in this Worker)
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ error: 'Unauthorized' }, 401, request);
    }

    try {
      // ─── §AUTH ────────────────────────────────────────────
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);
        await writeLog(env.DB, { tool: TOOL_NAME, type: 'login', employee: username, notes: `دخول: ${displayName}` });
        return json({ ok: true, displayName }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        if (username) {
          await writeLog(env.DB, { tool: TOOL_NAME, type: 'logout', employee: username, notes: `خروج: ${username.replace(/_/g, ' ')}` });
        }
        return json({ ok: true }, 200, request);
      }

      // ── §VERSION ──
      // فخ ٦ في CLAUDE.md: الواجهة سجل تاريخي، ففتحها مش إثبات إن الـ Worker
      // الجديد اتنشر فعلاً. الـ endpoint ده هو الإثبات: بيرجّع رقم إصدار
      // الكود اللي شغّال دلوقتي + هل الأسرار موجودة (بالوجود بس، من غير
      // أي قيمة) — يعني «السر ناقص» بقى مقروء من غير ما ننتظر تسليمة تفشل.
      if (action === 'version') {
        return json({
          ok: true,
          tool: TOOL_NAME,
          version: TOOL_VERSION,
          apiVersion: API_VERSION,
          webhookPath: '/webhook',
          env: {
            LOCATION_ID: env.LOCATION_ID || null,
            SHOP_DOMAIN: env.SHOP_DOMAIN || null,
            WP_BASE_URL: env.WP_BASE_URL || null,
            secretsPresent: {
              CLIENT_ID: !!env.CLIENT_ID,
              CLIENT_SECRET: !!env.CLIENT_SECRET,
              WP_SYNC_SECRET: !!env.WP_SYNC_SECRET,
              SHOPIFY_WEBHOOK_SECRET: !!env.SHOPIFY_WEBHOOK_SECRET, // قديم — المفروض يختفي بعد النقل
            },
          },
        }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // ─── §LOG-ENDPOINTS ───────────────────────────────────
      if (action === 'get_logs') {
        const entries = await getLogs(env.DB, {
          tool: TOOL_NAME,
          type: url.searchParams.get('type') || null,
          search: url.searchParams.get('search') || null,
          limit: parseInt(url.searchParams.get('limit') || '100'),
          offset: parseInt(url.searchParams.get('offset') || '0'),
        });
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const total = await getLogsCount(env.DB, {
          tool: TOOL_NAME,
          type: url.searchParams.get('type') || null,
          search: url.searchParams.get('search') || null,
        });
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const entries = await getLogsExport(env.DB, {
          tool: TOOL_NAME,
          type: url.searchParams.get('type') || null,
          search: url.searchParams.get('search') || null,
        });
        return json({ ok: true, entries }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      return json({ ok: false, error: 'action غير معروف' }, 400, request);

    } catch (e) {
      return json({ ok: false, error: e.message || String(e) }, 500, request);
    }
  },
};

// ══════════════════════════════════════════════════════
// §WEBHOOK — handleShopifyWebhook فقط بيتحقق من التوقيع ويرد فوراً.
// كل الشغل الفعلي (lookup + WooCommerce calls) بيحصل في processInventoryWebhook
// جوه ctx.waitUntil — عشان منتخطاش الـ 5 ثواني اللي Shopify بتدّيها.
// تجاوزها = retry = تشغيل نفس الحدث مرتين (راجع webhook-receivers.md §6).
// ══════════════════════════════════════════════════════
async function handleShopifyWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const hmacHeader = request.headers.get('X-Shopify-Hmac-Sha256');
  const webhookId = request.headers.get('X-Shopify-Webhook-Id');
  // X-Shopify-Event-Id ثابت عبر كل إعادات تسليم نفس الحدث — هو المفتاح
  // الوحيد اللي بيربط تسليمتين لنفس الحدث في السجل، لأن webhookId بيتغيّر.
  const eventId = request.headers.get('X-Shopify-Event-Id') || webhookId;
  const topic = request.headers.get('X-Shopify-Topic');
  const triggeredAt = normalizeTriggeredAt(request.headers.get('X-Shopify-Triggered-At'));

  // ── §WEBHOOK::verify ──
  // 🔴 السر بيختلف حسب إزاي الاشتراك اتعمل: اشتراك الداشبورد بيتوقّع بـ
  // store-level secret، والاشتراك المعمول بالـ API (Webhook Control Center)
  // بيتوقّع بـ CLIENT_SECRET. verifyShopifyHmacAny بتجرّب الاتنين وبترجّع
  // اسم اللي طابق عشان يتسجّل — ده الدليل على انتهاء النقل.
  const { valid, signedWith } = await verifyShopifyHmacAny(env, rawBody, hmacHeader);
  if (!valid) {
    // توقيع غلط = مش من Shopify فعلاً. نرفض بـ 401 (ده الرفض الوحيد
    // المسموح بيه — أي حاجة عدّت التوقيع بترجع 200 حتى لو فشلت، عشان
    // شوبيفاي بتحذف الاشتراك بصمت بعد ردود متكررة مش-2xx).
    // نسجّل الفشل قبل الرد — من غير اللوج ده مفيش فرق بين "سر غلط"
    // و"الويبهوك مش مسجّل" و"حد بيحاول يزوّر طلب" — الثلاثة شكلهم
    // واحد من برّه (مفيش حاجة بتحصل).
    // envKeys مقصودة: اسم السر بيفشل بنفس صمت القيمة — مسافة زايدة في
    // اسم الـ binding بتخلي env.CLIENT_SECRET undefined والداشبورد
    // بيقص الاسم في العرض فما تشوفهاش.
    ctx.waitUntil(writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'hmac_failed',
      notes: 'فشل التحقق من HMAC — جرّبنا CLIENT_SECRET والقديم SHOPIFY_WEBHOOK_SECRET والاتنين ما طابقوش',
      extra: {
        webhookId, eventId, topic, triggeredAt,
        hmacHeaderPresent: !!hmacHeader,
        bodyBytes: rawBody.length,
        secretsTried: WEBHOOK_SECRET_VARS.filter((n) => !!env[n]),
        envKeys: Object.keys(env),
      },
    }).catch(() => {}));
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = {};
  }

  // ── §WEBHOOK::respondThenProcess ──
  // الرد بيتبعت فوراً بعد التحقق — الشغل الحقيقي في الخلفية، عشان
  // منتخطاش الـ 5 ثواني اللي Shopify بتدّيها.
  ctx.waitUntil(
    processInventoryWebhook(env, payload, { webhookId, eventId, topic, triggeredAt, signedWith }).catch((e) =>
      writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'unexpected_error',
        notes: e.message || String(e),
        extra: { webhookId, eventId, topic, triggeredAt, signedWith },
      }).catch(() => {})
    )
  );

  return new Response('OK (accepted)', { status: 200 });
}

// ── §WEBHOOK::processInventoryWebhook ──
// كل المنطق الفعلي بعد التحقق من الـ HMAC — بيشتغل في الخلفية
// (ctx.waitUntil) ومبيرجعش Response؛ كل نتيجة (نجاح أو تخطي) بتتسجل
// في D1 لأن ده الطريقة الوحيدة لمراقبة Worker بلا واجهة.
async function processInventoryWebhook(env, payload, meta) {
  const { webhookId, eventId, topic, triggeredAt, signedWith } = meta;
  const startedAt = Date.now();
  // بيتحطّ في extra بتاع كل صف — عشان نعرف من السجل نفسه أي تسليمة جت من
  // الاشتراك الجديد وأي واحدة لسه من القديم، من غير ما نفتح شوبيفاي.
  const source = { webhookId, eventId, topic, signedWith };

  // ── §WEBHOOK::payloadGuard ──
  // البج المعروف في API 2026-01: أحياناً الـ payload بيوصل فاضي.
  // مفيش أي fallback ممكن — مفيش inventory_item_id نتعرف بيه على حاجة.
  if (!payload.inventory_item_id) {
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'empty_payload_bug',
      notes: 'Payload وصل فاضي من Shopify (بج معروف API 2026-01) — تعذّر معرفة أي variant اتغير',
      extra: { ...source, triggeredAt },
    });
    return;
  }

  const inventoryItemId = String(payload.inventory_item_id);
  const locationId = String(payload.location_id || '');
  const available = toQuantity(payload.available);

  // ── §WEBHOOK::quantityGuard ──
  // 🔴 من غير الحارس ده الكمية بتتمرّر لـ WooCommerce زي ما هي. لو
  // `available` وصلت null أو غايبة (بيحصل لو التتبّع اتقفل على الـ variant،
  // أو مع الـ payload الناقص فوق)، كنا بنبعت `{"quantity": null}` —
  // ووردبريس بيفسّرها صفر، يعني **بنصفّر استوك منتج شغّال** ونسجّلها
  // `synced` بنجاح. أخطر حالة صامتة في المسار ده.
  if (available === null) {
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'empty_payload_bug',
      notes: `الكمية (available) وصلت غير صالحة من Shopify: ${JSON.stringify(payload.available)} — اتوقف قبل الكتابة على WooCommerce`,
      extra: { ...source, inventoryItemId, locationId, available, triggeredAt },
    });
    return;
  }

  // ── §WEBHOOK::locationGuard ──
  // 🔴 الشرط `env.LOCATION_ID &&` معناه إن غياب المتغيّر **مابيرميش** —
  // بيلغي الحارس بالكامل بصمت. مفيش صف location_skipped في التاريخ كله
  // (المتجر عنده موقع واحد)، فالسجل مش هيكشف الغياب ده أبدًا — التأكيد
  // الوحيد: Worker → Settings → Variables بالعين.
  if (env.LOCATION_ID && locationId !== env.LOCATION_ID) {
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'location_skipped',
      notes: `location_id (${locationId}) مختلف عن LOCATION_ID المتوقع`,
      extra: { ...source, inventoryItemId, locationId, available },
    });
    return;
  }

  // ── §WEBHOOK::orderingGuard ──
  // Shopify مش بتضمن ترتيب تسليم الويبهوكات — حدث متأخر (retry أو
  // تسليم out-of-order) ممكن يكتب رقم قديم فوق رقم أحدث. claimIfNewer
  // بتقارن X-Shopify-Triggered-At بآخر حدث اتعالج لنفس الـ variant
  // بعملية atomic واحدة (راجع §ORDERING-GUARD).
  let claimedTriggeredAt = null;
  let previousTriggeredAt = null;
  if (triggeredAt) {
    const { claimed, previousTriggeredAt: prev } = await claimIfNewer(env.DB, inventoryItemId, triggeredAt);
    if (!claimed) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'stale_event_skipped',
        notes: 'الحدث ده أقدم من (أو مساوي لـ) آخر حدث اتعالج لنفس الـ variant — تم التجاهل لمنع الكتابة فوق قيمة أحدث',
        extra: { ...source, inventoryItemId, locationId, available, triggeredAt },
      });
      return;
    }
    claimedTriggeredAt = triggeredAt;
    previousTriggeredAt = prev;
  } else {
    // مفيش X-Shopify-Triggered-At في الـ headers — نكمل عادي بس نسجل
    // إننا مش قادرين نتحقق من الترتيب في الحالة دي. مش خطأ.
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'no_triggered_at_header',
      notes: 'X-Shopify-Triggered-At مش موجود — تم التنفيذ من غير ordering guard',
      extra: { ...source, inventoryItemId, locationId, available },
    });
  }

  // ── §WEBHOOK::releaseOnTransientFailure ──
  // بترجّع الحجز بس في الفشل المؤقّت (WooCommerce واقع، Shopify رجّع خطأ)
  // — مش في نتيجة بيانات نهائية زي sku_mismatch. من غيرها، أي إعادة
  // مزامنة لاحقة لنفس الحدث بترجع stale_event_skipped وتضيع.
  const release = async () => {
    if (!claimedTriggeredAt) return;
    await releaseClaim(env.DB, inventoryItemId, claimedTriggeredAt, previousTriggeredAt).catch(() => {});
  };

  try {
    // ── §WEBHOOK::liveLookup ──
    // استعلام لحظي في كل مرة — مقصود: الـ metafield ممكن تتضاف بعد
    // كده، وأي cache دائم هيخلي variant اتربط لسه يفضل not_linked_yet.
    const variant = await lookupVariantByInventoryItem(env, inventoryItemId);

    if (!variant) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'variant_not_found',
        notes: 'مفيش variant مرتبط بالـ inventory_item_id ده على Shopify',
        extra: { ...source, inventoryItemId, locationId, available },
      });
      return;
    }

    if (!variant.wordpressVariationId) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'not_linked_yet',
        sku: variant.sku,
        notes: 'الـ variant ده لسه من غير WordPress Variation Id metafield',
        extra: { ...source, inventoryItemId, variantId: variant.variantId, locationId, available },
      });
      return;
    }

    // ── §WEBHOOK::fetchWpVariation ──
    const wp = await wcGetVariationStock(env, variant.wordpressVariationId);
    if (!wp) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'wp_variation_not_found',
        sku: variant.sku,
        notes: `WordPress Variation Id (${variant.wordpressVariationId}) مش موجود على WordPress`,
        extra: { ...source, inventoryItemId, variantId: variant.variantId, wordpressVariationId: variant.wordpressVariationId, locationId, available },
      });
      return;
    }

    // ── §WEBHOOK::tripleCheck ──
    const skuMatch = String(variant.sku || '').trim() === String(wp.sku || '').trim();
    const gtinMatch = String(wp.gtin || '').trim() === String(variant.variantId || '').trim();

    if (!skuMatch) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'sku_mismatch',
        sku: variant.sku,
        notes: `SKU مختلف — Shopify: "${variant.sku}" | WordPress: "${wp.sku}"`,
        extra: { ...source, inventoryItemId, variantId: variant.variantId, wordpressVariationId: variant.wordpressVariationId, locationId, available },
      });
      return;
    }

    if (!gtinMatch) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'gtin_mismatch',
        sku: variant.sku,
        notes: `GTIN لا يطابق Variant ID — WordPress GTIN: "${wp.gtin}" | متوقع: "${variant.variantId}"`,
        extra: { ...source, inventoryItemId, variantId: variant.variantId, wordpressVariationId: variant.wordpressVariationId, locationId, available },
      });
      return;
    }

    // ── §WEBHOOK::syncStock ──
    try {
      const before = toQuantity(wp.stock_quantity);
      const result = await wcUpdateVariationStock(env, variant.wordpressVariationId, available);
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'synced',
        sku: variant.sku,
        delta: Number.isFinite(before) ? available - before : null,
        valueBefore: wp.stock_quantity,
        valueAfter: available,
        notes: `تمّت مزامنة الاستوك بنجاح (${Date.now() - startedAt}ms)`,
        extra: {
          ...source,
          inventoryItemId, variantId: variant.variantId,
          wordpressVariationId: variant.wordpressVariationId,
          locationId, wcResult: result,
        },
      });
    } catch (wpErr) {
      await release();
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'wp_update_failed',
        sku: variant.sku,
        valueBefore: wp.stock_quantity,
        valueAfter: available,
        notes: `فشل تحديث WordPress: ${wpErr.message}`,
        extra: { ...source, inventoryItemId, variantId: variant.variantId, wordpressVariationId: variant.wordpressVariationId, locationId, claimReleased: !!claimedTriggeredAt },
      });
    }

  } catch (e) {
    // أي خطأ غير متوقع (Shopify API فشل، WooCommerce ما ردّش، إلخ) — نسجله.
    // الرد لـ Shopify اتبعت خلاص (200) قبل ما الكود ده حتى يشتغل، فمفيش
    // خطر إلغاء الاشتراك.
    await release();
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'unexpected_error',
      notes: e.message || String(e),
      extra: { ...source, inventoryItemId, locationId, available, claimReleased: !!claimedTriggeredAt },
    });
  }
}
