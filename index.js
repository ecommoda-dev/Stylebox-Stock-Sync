// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════
const TOOL_NAME = 'wp_stock_sync';
const API_VERSION = '2026-01';

// ══════════════════════════════════════════════════════
// §CORS — Option B (write tool, strict allowlist)
// ملاحظة: الـ CORS هنا بيحمي فقط الـ endpoints الإدارية (get_logs،
// check_employee، إلخ) لو اتفتحت من متصفح — مسار الويبهوك نفسه
// (?action=shopify_webhook) بييجي من سيرفر Shopify مش من متصفح،
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

// ── §HELPERS::verifyShopifyHmac ──
// تحقق من توقيع Shopify (Admin UI webhook) على الـ raw body.
// السر هنا هو WP_SYNC_SECRET؟ لأ — ده سر مختلف: SHOPIFY_WEBHOOK_SECRET
// (بيظهر في نفس صفحة إنشاء الـ webhook في Settings > Notifications > Webhooks)
async function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const bytes = new Uint8Array(sigBuf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const computed = btoa(binary);

  if (computed.length !== hmacHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return diff === 0;
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
async function getAccessToken(env) {
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
  const data = await res.json();
  if (!data.access_token) throw new Error('OAuth failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function shopifyGQL(env, token, query, variables = {}) {
  const shopDomain = env.SHOP_DOMAIN.replace(/\/$/, '');
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error('GraphQL error: ' + JSON.stringify(data.errors));
  return data.data;
}

// ── §SHOPIFY::lookupVariantByInventoryItem ──
// استعلام لحظي واحد — بلا cache دائم — بيرجع variant_id + sku + قيمة
// الـ metafield wordpress_variation_id (لو موجودة). مفيش تخزين محلي
// لأن الـ metafield ممكن تتضاف لاحقاً وعايزين نشوف أحدث قيمة كل مرة.
async function lookupVariantByInventoryItem(env, token, inventoryItemId) {
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
  const data = await shopifyGQL(env, token, QUERY, { id: gid });
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
async function wcGetVariationStock(env, variationId) {
  const res = await fetch(
    `${env.WP_BASE_URL.replace(/\/$/, '')}/wp-json/ecommoda/v1/variation-stock/${variationId}`,
    { headers: { 'X-EcomModa-Secret': env.WP_SYNC_SECRET } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`WP GET failed: ${res.status} ${await res.text()}`);
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
  const res = await db.prepare(`
    INSERT INTO wp_stock_sync_state (inventory_item_id, last_triggered_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(inventory_item_id) DO UPDATE SET
      last_triggered_at = excluded.last_triggered_at,
      updated_at        = excluded.updated_at
    WHERE excluded.last_triggered_at > wp_stock_sync_state.last_triggered_at
  `).bind(inventoryItemId, triggeredAt, now).run();
  return (res.meta?.changes ?? 0) > 0;
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

    // ─── §WEBHOOK ─── (Shopify calls this — NO WORKER_SECRET Bearer here,
    // Shopify signs its own way via X-Shopify-Hmac-Sha256. This branch must
    // run BEFORE the generic WORKER_SECRET gate below.)
    // ⚠️ TEMPORARY dual-route: '/webhook' هو المسار الجديد (المفضّل —
    // مش بيتلخبط مع namespace الـ action وواضح في ليستة Admin). فرع
    // ?action=shopify_webhook لسه موجود مؤقتاً لحد ما تتأكد إن تحديث
    // الرابط نجح على Shopify (راجع خطوات التحديث تحت). احذف فرع
    // action القديم بعد التأكيد.
    if ((url.pathname === '/webhook' || action === 'shopify_webhook') && request.method === 'POST') {
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
  const triggeredAt = request.headers.get('X-Shopify-Triggered-At');

  // ── §WEBHOOK::verify ──
  const valid = await verifyShopifyHmac(rawBody, hmacHeader, env.SHOPIFY_WEBHOOK_SECRET);
  if (!valid) {
    // توقيع غلط = مش من Shopify فعلاً. نرفض بـ 401 (Shopify نفسها مش
    // بتحاسبك على رفض توقيع غلط — العكس هو المطلوب أمنياً).
    // نسجّل الفشل قبل الرد — من غير اللوج ده مفيش فرق بين "سر غلط"
    // و"الويبهوك مش مسجّل" و"حد بيحاول يزوّر طلب" — الثلاثة شكلهم
    // واحد من برّه (مفيش حاجة بتحصل).
    ctx.waitUntil(writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'hmac_failed',
      notes: 'فشل التحقق من HMAC — سر التوقيع غلط أو الـ body اتغيّر',
      extra: { webhookId, triggeredAt, hmacHeaderPresent: !!hmacHeader, bodyBytes: rawBody.length },
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
  // الرد بيتبعت فوراً بعد التحقق — الشغل الحقيقي في الخلفية.
  ctx.waitUntil(
    processInventoryWebhook(env, payload, { webhookId, triggeredAt }).catch((e) =>
      writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'unexpected_error',
        notes: e.message || String(e),
        extra: { webhookId, triggeredAt },
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
  const { webhookId, triggeredAt } = meta;
  const startedAt = Date.now();

  // ── §WEBHOOK::emptyPayloadGuard ──
  // البج المعروف في API 2026-01: أحياناً الـ payload بيوصل فاضي.
  // مفيش أي fallback ممكن — مفيش inventory_item_id نتعرف بيه على حاجة.
  if (!payload.inventory_item_id) {
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'empty_payload_bug',
      notes: 'Payload وصل فاضي من Shopify (بج معروف API 2026-01) — تعذّر معرفة أي variant اتغير',
      extra: { webhookId, triggeredAt },
    });
    return;
  }

  const inventoryItemId = String(payload.inventory_item_id);
  const locationId = String(payload.location_id || '');
  const available = payload.available;

  // ── §WEBHOOK::locationGuard ──
  if (env.LOCATION_ID && locationId !== env.LOCATION_ID) {
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'location_skipped',
      notes: `location_id (${locationId}) مختلف عن LOCATION_ID المتوقع`,
      extra: { inventoryItemId, locationId, available },
    });
    return;
  }

  // ── §WEBHOOK::orderingGuard ──
  // Shopify مش بتضمن ترتيب تسليم الويبهوكات — حدث متأخر (retry أو
  // تسليم out-of-order) ممكن يكتب رقم قديم فوق رقم أحدث. claimIfNewer
  // بتقارن X-Shopify-Triggered-At بآخر حدث اتعالج لنفس الـ variant
  // بعملية atomic واحدة (راجع §ORDERING-GUARD).
  if (triggeredAt) {
    const claimed = await claimIfNewer(env.DB, inventoryItemId, triggeredAt);
    if (!claimed) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'stale_event_skipped',
        notes: 'الحدث ده أقدم من (أو مساوي لـ) آخر حدث اتعالج لنفس الـ variant — تم التجاهل لمنع الكتابة فوق قيمة أحدث',
        extra: { inventoryItemId, locationId, available, triggeredAt },
      });
      return;
    }
  } else {
    // مفيش X-Shopify-Triggered-At في الـ headers — نكمل عادي بس نسجل
    // إننا مش قادرين نتحقق من الترتيب في الحالة دي.
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'no_triggered_at_header',
      notes: 'X-Shopify-Triggered-At مش موجود — تم التنفيذ من غير ordering guard',
      extra: { inventoryItemId, locationId, available },
    });
  }

  try {
    // ── §WEBHOOK::liveLookup ──
    const token = await getAccessToken(env);
    const variant = await lookupVariantByInventoryItem(env, token, inventoryItemId);

    if (!variant) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'variant_not_found',
        notes: 'مفيش variant مرتبط بالـ inventory_item_id ده على Shopify',
        extra: { inventoryItemId, locationId, available },
      });
      return;
    }

    if (!variant.wordpressVariationId) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'not_linked_yet',
        sku: variant.sku,
        notes: 'الـ variant ده لسه من غير WordPress Variation Id metafield',
        extra: { inventoryItemId, variantId: variant.variantId, locationId, available },
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
        extra: { inventoryItemId, variantId: variant.variantId, locationId, available },
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
        extra: { inventoryItemId, variantId: variant.variantId, wordpressVariationId: variant.wordpressVariationId, locationId, available },
      });
      return;
    }

    if (!gtinMatch) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'gtin_mismatch',
        sku: variant.sku,
        notes: `GTIN لا يطابق Variant ID — WordPress GTIN: "${wp.gtin}" | متوقع: "${variant.variantId}"`,
        extra: { inventoryItemId, variantId: variant.variantId, wordpressVariationId: variant.wordpressVariationId, locationId, available },
      });
      return;
    }

    // ── §WEBHOOK::syncStock ──
    try {
      const result = await wcUpdateVariationStock(env, variant.wordpressVariationId, available);
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'synced',
        sku: variant.sku,
        delta: (available ?? 0) - (wp.stock_quantity ?? 0),
        valueBefore: wp.stock_quantity,
        valueAfter: available,
        notes: `تمّت مزامنة الاستوك بنجاح (${Date.now() - startedAt}ms)`,
        extra: {
          inventoryItemId, variantId: variant.variantId,
          wordpressVariationId: variant.wordpressVariationId,
          locationId, wcResult: result,
        },
      });
    } catch (wpErr) {
      await writeLog(env.DB, {
        tool: TOOL_NAME,
        type: 'wp_update_failed',
        sku: variant.sku,
        valueBefore: wp.stock_quantity,
        valueAfter: available,
        notes: `فشل تحديث WordPress: ${wpErr.message}`,
        extra: { inventoryItemId, variantId: variant.variantId, wordpressVariationId: variant.wordpressVariationId, locationId },
      });
    }

  } catch (e) {
    // أي خطأ غير متوقع (Shopify API فشل، إلخ) — نسجله. الرد لـ Shopify
    // اتبعت خلاص (200) قبل ما الكود ده حتى يشتغل، فمفيش خطر إلغاء الاشتراك.
    await writeLog(env.DB, {
      tool: TOOL_NAME,
      type: 'unexpected_error',
      notes: e.message || String(e),
      extra: { inventoryItemId, locationId, available },
    });
  }
}
