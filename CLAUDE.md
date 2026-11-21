<div dir="rtl" style="text-align: right;">

# مزامنة استوك Shopify → WooCommerce (`Stylebox-Stock-Sync`)

![version](https://img.shields.io/badge/version-v3.2.0-blue)

**بتعمل إيه:** مستقبِل ويبهوك `inventory_levels/update` من Shopify — بيعمل
Triple-Check (SKU + GTIN + WordPress Variation Id) وبيحدّث استوك الـ variation
على `stylebox.online`. والواجهة (تابين): **«📦 مزامنة الاستوك»** — شريط الحالة + **مزامنة شاملة يدوية**
(`bulk_sync_all`، **جديد v3.2.0**) — و**«📜 سجل العمليات»** (قراءة فقط).
**مين بيستخدمها:** مخزن · إدارة (السجل + المزامنة الشاملة)
**الإصدار:** Worker `v3.2.0` (`?action=get_config`) · الواجهة `v2.2.0` (شريحة النسخة في الهيدر)

> 🔴 **العقد اتغيّر 21-11-2026:** الواجهة كانت «قراءة فقط» ومكتوب كده في نافذة «عن الأداة». من v2.2.0
> فيها **زرار كتابة واحد** (المزامنة الشاملة) بطلب صريح من أحمد — اتوثّق هنا وفي «عن الأداة» **قبل** النشر.
> أي زرار كتابة تاني = قرار منتج جديد يتوثّق الأول.

> 🟢 **الاشتراك اتنقل لـ Webhook Control Center يوم 10-09-2026.** قبل كده كان
> ويبهوك متعمول من داشبورد شوبيفاي (Settings → Notifications → Webhooks).
> النتيجة العملية الوحيدة اللي بتوقف الأداة: **سر التوقيع اتغيّر** من
> `SHOPIFY_WEBHOOK_SECRET` لـ `CLIENT_SECRET`. تفاصيل كاملة → «نظام الويبهوك».

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Stylebox-Stock-Sync/
الـ Worker : https://stylebox-stock-sync-worker.ecommoda-dev.workers.dev
الويبهوك   : POST https://stylebox-stock-sync-worker.ecommoda-dev.workers.dev/webhook
اسم الـ Worker في الداشبورد: stylebox-stock-sync-worker
```

## الاختبارات

```
node test.mjs        ← الـ Worker: مسار الويبهوك · ٤٠ فحص
node check-html.mjs  ← الواجهة: بنية الـ CSS والربط في الـ JS
```

الاتنين بلا تنصيب ومن جذر الريبو.

الأداة دي كل أعطالها صامتة (شوبيفاي بتبعت، والـ Worker بيرد 200 قبل ما
يشتغل، والواجهة سجل تاريخي) — فمفيش طريقة تجرّب تعديل بالإيد من غير تغيير
مخزون حقيقي على المتجر. `test.mjs` بيقفل الفجوة دي: بينادي `fetch` بتاع
الـ Worker جوّه Node بـ D1 وشبكة مزيّفين، وبيتأكد من كل حارس.

**شغّلهم قبل أي push.** `test.mjs` لأي تعديل في `index.js`، و`check-html.mjs`
لأي تعديل في `index.html`. لو فشل فحص، اقرا اسمه — كل واحد بيقابل باج حصل
فعلًا مش حالة نظرية.

`check-html.mjs` بيمسك التلاتة اللي الـ grep بيعدّي عليهم وبيوصلوا الإنتاج
في صمت (الصفحة بتفتح والكونسول نضيف): كتلة `:root` بتتبلع جوّه selector غلط
بسبب تعليق متداخل · `var(` مش مقفولة بتسقط الـ `<style>` كله · دالة متنادية
ومش معرّفة. اتجرّب على ٦ أعطال مقصودة ومسك الستة.

⚠️ **مش بديل عن إثبات النقل.** الاختبارات بتقول إن **المنطق** صح، مش إن
الاشتراك شغّال ولا إن التسليمات بتوصل — ده لسه صفوف D1 بس هي اللي بتثبته
(«خط الأساس» تحت). وحدود التغطية التانية مكتوبة في أول `test.mjs`.

## الـ Endpoints

| المسار / `?action=` | بيعمل إيه | البوابة |
|---|---|---|
| `POST /webhook` | استقبال `inventory_levels/update` من Shopify | **قبل** بوابة `WORKER_SECRET` — HMAC بس |
| `?action=get_config` | إصدار الكود المنشور + وجود الأسرار (بالوجود بس) + `bulk.pageSize/wpBatchSize` — الاسم القديم `version` لسه شغّال | `Bearer WORKER_SECRET` |
| `?action=bulk_sync_all` | **(v3.2.0)** صفحة واحدة (٥٠ variant) من المزامنة الشاملة — `cursor` للصفحة الجاية + `employee` للتسجيل. الرد: `ok` · `scanned` · `linked` · `results` (٥ مفردات) · `deferred` · `rateLimited` · `retryAfterSec` · `throttleStatus` · `queryCost` · `hasMore` · `nextCursor` · `done`. لو `rateLimited:true` فـ`nextCursor` = **نفس cursor الصفحة** | `Bearer WORKER_SECRET` |
| `?action=diag` | فحص ذاتي **بدون كتابة**: الأسرار (أسماء وأطوال) · `LOCATION_ID` · D1 · شوبيفاي OAuth والصلاحيات و`throttleStatus` · endpoint ووردبريس القديم **+ endpoint الدفعات** (`POST variation-stocks` بـ`items:[]` — **400 = شغّال**، `404` = السنيپت لسه ما اتلصقش) | `Bearer WORKER_SECRET` |
| `?action=get_stats` | شريط الحالة: آخر مزامنة ناجحة · آخر تسليمة ويبهوك · تجميع آخر ٢٤ ساعة | `Bearer WORKER_SECRET` |
| `check_employee` · `register_pin` · `verify_employee` · `log_logout` · `get_employees` | تسجيل الدخول الموحّد | `Bearer WORKER_SECRET` |
| `get_logs` · `get_logs_count` · `get_logs_export` | سجل العمليات + التصدير — فلاتر على السيرفر (`types` CSV · `search` · `dateFrom`/`dateTo`)، والتصدير بيرجّع `cap`/`total`/`truncated` | `Bearer WORKER_SECRET` |

> فرع `?action=shopify_webhook` **اتشال** (10-09-2026). كان معلَّم TEMPORARY
> من قبل النقل؛ الاشتراك الوحيد اللي كان موجود على الداشبورد كان بيضرب
> `/webhook` بالفعل (اتأكدنا بالعين من شاشة الويبهوكس)، والاشتراك الجديد
> مسجّل على `/webhook` كمان — فمكانش ليه أي مصدر تسليمات.

> 🔴 **ترتيب الفروع في `fetch` مش تجميلي.** فرع الويبهوك لازم يفضل **قبل**
> حارس `WORKER_SECRET` — شوبيفاي مبتبعتش `Authorization`. أي إعادة ترتيب =
> كل تسليمة ويبهوك بترجع `401` والاستوك بيقف عن المزامنة بصمت.

## نظام الويبهوك (بعد النقل — 10-09-2026)

```
الاشتراك  : Webhook Control Center → 🪝 إدارة الويبهوكس
Topic     : INVENTORY_LEVELS_UPDATE   (الـ header بييجي inventory_levels/update)
URI       : https://stylebox-stock-sync-worker.ecommoda-dev.workers.dev/webhook
filter    : (فاضي)
includeFields : (فاضي)
سر التوقيع : CLIENT_SECRET
```

**ليه الـ topic فضل `INVENTORY_LEVELS_UPDATE` ومابقاش `PRODUCTS_UPDATE` زي
`stylebox_price_sync`؟** قرار مقصود، مش سهو:

- `INVENTORY_LEVELS_UPDATE` بيضرب **لحظة ما الاستوك يتغيّر فعلاً**، وبيجيب
  `location_id` و`available` لكل موقع لوحده — فحارس `LOCATION_ID` بيفضل ليه
  معنى. `PRODUCTS_UPDATE` بيجيب `inventory_quantity` **إجمالي كل المواقع**،
  يعني الحارس بيسقط بصمت أول ما يتفتح موقع تاني.
- أسوأ فشل ممكن في أداة استوك هو حدث بيضيع (أوفرسيلينج على ووردبريس).
  الاعتماد على `products/update` إنه هيضرب مع كل تغيير مخزون رهان زيادة
  مش مبرَّر هنا.

**الثمن المقبول:** `inventory_levels` payload مافيهوش metafields، يعني:
- مافيش `filter` يقدر يقفل ضوضاء `not_linked_yet` من عند شوبيفاي (زي ما
  عمل price_sync) — الفلترة بتفضل في الكود.
- الـ lookup اللحظي على شوبيفاي بيفضل ضروري لكل حدث (بس التوكن بقى مكاشد
  دلوقتي، فالنداء الزيادة اتشال).

### 🔴 السر اللي بيوقّع — أغلى سطر في الملف ده

| الاشتراك اتعمل إزاي | بيتوقّع بـ |
|---|---|
| داشبورد شوبيفاي (Settings → Notifications) — **القديم** | `SHOPIFY_WEBHOOK_SECRET` (store-level) |
| `webhookSubscriptionCreate` عبر الـ API / Webhook Control Center — **الحالي** | `CLIENT_SECRET` (سر التطبيق) |

التحقق بالسر الغلط بيرجّع **401 على كل تسليمة، بلا أي عرض تاني** — الاستوك
بيقف والواجهة شكلها طبيعي. عشان كده `verifyShopifyHmacAny` في `index.js`
بتجرّب الاتنين بالترتيب وبتسجّل اسم اللي طابق في `extra.signedWith`.

### إسقاط السر القديم (الخطوة الأخيرة — لسه ما اتعملتش)

القبول المزدوج ده **مؤقت بوعي**. الاستعلام اللي بيقول إن النقل خلص:

```sql
SELECT json_extract(extra,'$.signedWith') AS signed_with, COUNT(*) AS n, MAX(timestamp) AS last_ts FROM logs WHERE tool = 'wp_stock_sync' AND timestamp > '2026-09-10' GROUP BY signed_with;
```

لما يفضل `CLIENT_SECRET` بس لمدة يوم كامل فيه حركة استوك حقيقية:
1. احذف `'SHOPIFY_WEBHOOK_SECRET'` من `WEBHOOK_SECRET_VARS` في `index.js`.
2. احذف السر من Worker → Settings → Variables and Secrets.
3. اتأكد إن ويبهوك الداشبورد القديم اتشال من شوبيفاي (لو لسه موجود).

> ⚠️ لو `signed_with` رجّعت `null` لكل الصفوف، ده معناه إن الكود القديم لسه
> منشور — مش إن النقل فشل. اتأكد بـ `?action=version` (لازم `v2.0.0`).

## D1

```
tool  : wp_stock_sync
type  : synced · not_linked_yet · sku_mismatch · gtin_mismatch ·
        wp_variation_not_found · wp_update_failed · variant_not_found ·
        location_skipped · stale_event_skipped · no_triggered_at_header ·
        empty_payload_bug · hmac_failed · unexpected_error · login · logout ·
        rate_limited · no_stock_change_skipped · quantity_unavailable   ← (٣ جداد v3.2.0 — المزامنة الشاملة)
```

> ℹ️ **كل صفوف الأداة من v3.2.0 فيها `extra.result` و`extra.stage`** (مفردات `constants` §12) — الويبهوك كمان،
> مش الشاملة بس. صفوف `no_triggered_at_header` استثناء مقصود (معلوماتي، من غير `result`). الاستعلام الصح لقياس
> الكتابة المؤكَّدة: `… AND json_extract(extra,'$.result') = 'success'` — مش `type` لوحده.
> (الصفوف **القديمة** قبل v3.2.0 مالهاش `result` — تتعرض «—» مش «✓».)
>
> 🔴 **عشرة من الخمستاشر مش مسجّلين في `ecommoda-constants` §7** (المسجّل هناك:
> `synced` · `not_linked_yet` · `sku_mismatch` · `unexpected_error` · `login`).
> مخالفة «التسجيل قبل أول `writeLog`» — وهي **موجودة من قبل النقل**، النقل بس
> اللي كشفها. القيم دي بتتكتب فعليًا في الإنتاج (مثلًا `wp_variation_not_found`
> بـ ١٨ صف يوم 09-09-2026). **يتسجّلوا في §7** — راجع «مسائل مفتوحة».

**جدول إضافي في نفس القاعدة** — غير `logs`/`employees` المشتركين:

```
wp_stock_sync_state (inventory_item_id TEXT PRIMARY KEY, last_triggered_at TEXT, updated_at TEXT)
```

الغرض: **حارس الترتيب**. شوبيفاي مش بتضمن ترتيب تسليم الويبهوكات، فالجدول ده
بيمنع حدث قديم (retry أو تسليم out-of-order) من الكتابة فوق قيمة أحدث.
المقارنة `INSERT .. ON CONFLICT .. WHERE` عملية **ذرّية واحدة** — مش قراءة ثم
كتابة، فمفيش سباق بين تسليمتين متزامنتين لنفس الـ variant.

## 🔁 المزامنة الشاملة (v3.2.0 · 21-11-2026)

**ليه اتعملت:** الويبهوك بيضيع لو اتّرفض (شوبيفاي مابتعيدش بعد الـ 200) وبيفضل الاستوك مختلف لحد ما الـ variant يتحرّك تاني.
مفيش وسيلة قبل كده تصلّح انحراف (زي موجة `wp_variation_not_found` في 09-09). نفس فكرة `stylebox_price_sync` → `bulk_sync_all`.

```
الواجهة  : نداء bulk_sync_all لكل صفحة (٥٠ variant) + cursor + استئناف تلقائي عند 429 + «كمّل من آخر نقطة»
الـ Worker: productVariants(first:50) → الـ metafield + available على LOCATION_ID → prepareBulkVariant (حراس) →
            flushStockBatch (دفعات ≤٢٠، فاصل ١٫٥ ث، متتالي) → applyStockBatchResult (صف D1 لكل variant)
ووردبريس : POST ecommoda/v1/variation-stocks — السيرفر بيعمل triple-check (SKU+GTIN) ويكتب (WC CRUD)
            ويرجّع نتيجة لكل item بنفس الترتيب: updated|unchanged|sku_mismatch|gtin_mismatch|not_found|bad_request|save_failed
```

- **ميزانية الـ 429** (`woocommerce-sync-helper` Step 3.5): كان GET+POST لكل variant (٢×N نداء). دلوقتي نداء واحد لكل ≤٢٠
  variant. الكتالوج ≈ ٥٬٨١٤ variant ← ~١١٧ صفحة؛ المربوط ~١٬٠٢٠ ← **~٥١–١١٧ نداء** (حسب توزيع المربوط على الصفحات) على
  ~٥–١٠ دقايق ← تحت ٣٠ نداء/دقيقة. أول 429 بجسم فاضي = **circuit breaker** (يوقف، يرجّع الحجوزات، صف `rate_limited` لكل variant،
  مفيش إعادة جوّه نفس الاستدعاء). النافذة **مشتركة** مع Workers الأسعار والأوردرات — ماتشغّلش شاملة الأسعار والاستوك مع بعض.
- **حراس الشاملة (نفس الويبهوك بالحرف):** الكمية لازم رقم صالح — `null`/تتبّع مقفول ⇒ `quantity_unavailable` **مش 0** · حارس الموقع
  (`LOCATION_ID` **إلزامي** للشاملة وغيابه ⇒ 500 باسمه) · حارس الترتيب (`claimIfNewer` بطابع = بداية قراءة الصفحة) · triple-check.
- **قاعدة عدم الضياع:** صف واحد بالظبط لكل variant **مربوط**. المش مربوط بيتخطّى **بدون** صف (مش بنغرق السجل — `not_linked_yet` للويبهوك).
- **مفيش كاش «آخر قيمة»** (الأسعار عندها): السيرفر بيقارن بالاستوك الحقيقي وبيرجّع `unchanged` → `no_stock_change_skipped` (`result=already`، عدّاد محايد مش فشل).
- **الاستوك السالب:** شوبيفاي `available` ممكن تنزل تحت الصفر (أوفرسيلينج). الويبهوك بيبعتها زي ما هي؛ endpoint الدفعات بيقبل **عدد صحيح سالب**
  لنفس السبب — لو عايز يتمنع، ده قرار منتج يتاخد قبل ما يتغيّر في الاتنين.

### 🔴 ترتيب النشر — اللي لازم يتعمل **بالترتيب**

1. **الصق `wordpress/variation-stocks-snippet.php` على ووردبريس الأول** (WPCode → `EcomModa – MCP Abilities`، **جوّه نفس** `rest_api_init` بتاع route
   `variation-stock/{id}`، من غير `<?php`). ⚠️ السنيپت بيعتمد على `$permission_check` — **راجع بعينك** إن اسم المتغيّر ده هو اللي بيفحص
   `X-EcomModa-Secret` في الـ closure الحالي (ماقدرتش أشوف كود ووردبريس من الجلسة دي). لو الاسم مختلف، غيّره في سطر `permission_callback` — ولو اتنسى
   الـ route بيرد 401 دايمًا (fail-closed).
2. بعدين نشر الـ Worker (push على `main`) والواجهة.
3. 🩺 فحص النظام → لازم يطلع `WooCommerce batch endpoint ✅ (400)` و`LOCATION_ID` مضبوط.
4. شغّل شاملة **صفحة واحدة الأول** (إيقاف بعد أول صفحة) وراجع الصفوف في D1، وبعدين الكاملة.

```sql
SELECT type, json_extract(extra,'$.result') AS result, COUNT(*) AS n, MAX(timestamp) AS last_ts FROM logs WHERE tool = 'wp_stock_sync' AND json_extract(extra,'$.origin') = 'bulk_sync' GROUP BY type, result ORDER BY n DESC;
```

## المضبوط فعليًا في الداشبورد

```
Bindings : DB → ecommoda-dev-logs
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET · WP_SYNC_SECRET
           (+ SHOPIFY_WEBHOOK_SECRET — قديم، للحذف بعد إثبات النقل)
Vars     : SHOP_DOMAIN · LOCATION_ID · WP_BASE_URL     ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي) — التضييق لسه ما اتعملش
```

**تصنيف الـ `env.*` (`ecommoda-tool-migration-playbook` §4-أ-٢):**

| المتغيّر | التصنيف | إزاي يتأكد |
|---|---|---|
| `WORKER_SECRET` · `CLIENT_ID` · `CLIENT_SECRET` · `WP_SYNC_SECRET` | سر | قيمته مستحيلة القراءة — من مصدر أحمد بس |
| `SHOPIFY_WEBHOOK_SECRET` | سر **قديم — انتقالي** | كان سر توقيع ويبهوك الداشبورد. يتحذف بعد إثبات النقل (فوق) |
| `SHOP_DOMAIN` · `WP_BASE_URL` | var بيرمي لو غاب | مُثبَت من D1: أي صف `synced` بيتكتب **بعد** نداء WooCommerce ⇒ الاتنين كانوا شغالين |
| `LOCATION_ID` | 🔴 **var ليه fallback** | **الداشبورد بعينك — ولا حاجة تانية** |

> 🔴 **ليه `LOCATION_ID` هو الخطر هنا:** الكود بيقول
> `if (env.LOCATION_ID && locationId !== env.LOCATION_ID)`. غيابه **مابيرميش** —
> بيلغي حارس الموقع بالكامل بصمت، فأي حدث مخزون من أي موقع بيتزامن على
> WooCommerce.
> ⚠️ **وسجل D1 مش هيكشفه:** `location_skipped` عنده **صفر صف** في تاريخ الأداة
> كله — وده متوقّع في الحالتين (المتجر عنده موقع واحد). يعني الفرق بين
> «المتغيّر مضبوط» و«المتغيّر ضايع» **غير قابل للقياس من السجل**.
>
> ✅ **بقى قابل للقياس من 10-09-2026:** `?action=version` بيرجّع القيمة
> الفعلية لـ `LOCATION_ID` من داخل الـ Worker الشغّال (مش سر، فعرضها آمن).
> `"LOCATION_ID": null` في الرد = الحارس ملغي دلوقتي. ده أسرع وأوثق من
> النظر في الداشبورد لأنه بيقرا من الـ runtime نفسه مش من الإعدادات.

## CORS

`ALLOWED_ORIGINS` صارمة — `https://ecommoda-dev.github.io` بس (بدون trailing
slash). بتحمي الـ endpoints الإدارية لو اتفتحت من متصفح. **مسار الويبهوك نفسه
مش معتمد على CORS** — بييجي من سيرفر شوبيفاي مش من متصفح.

✅ الدومين المهجور `ecommoda24.github.io` **مش موجود** في الكود ده.

## خط الأساس — قبل النقل (09-09-2026)

مقيس من D1 مباشرة قبل أي تعديل. الاستعلام (سطر واحد للّصق في D1 Console):

```sql
SELECT type, COUNT(*) AS n, MAX(timestamp) AS last_ts FROM logs WHERE tool = 'wp_stock_sync' GROUP BY type ORDER BY n DESC;
```

```
not_linked_yet         9,389   (آخر صف 09-09-2026 17:56 UTC)
synced                 3,063   (آخر صف 09-09-2026 09:08 UTC)
sku_mismatch             481
wp_variation_not_found    18   (كلهم يوم 09-09-2026)
login                     12
unexpected_error          10
────────────────────────────
location_skipped           0   ← صفر متوقّع (موقع واحد) — مش دليل على LOCATION_ID
```

**إثبات النقل:** نفس الاستعلام بعد أول build لازم يرجّع أرقام **مساوية أو أكبر**
مع أحدث `last_ts` — أي توقّف في `synced` بعد النقل = الويبهوك واقف.

### خط أساس تاني — قبل نقل الويبهوك (10-09-2026 · 08:40 UTC)

مقيس من D1 مباشرة قبل أي تعديل في هذه الجولة:

```
not_linked_yet         9,454   (آخر صف 10-09-2026 08:37 UTC ← الويبهوك حيّ)
synced                 3,063   (آخر صف 09-09-2026 09:08 UTC ← 🔴 واقف من إمبارح)
sku_mismatch             481   (آخر صف 09-09-2026 04:37 UTC)
wp_variation_not_found    30   (أول صف 09-09-2026 10:48 · آخر صف 10-09-2026 07:23)
login                     12
unexpected_error          10
location_skipped           0   ← صفر متوقّع (موقع واحد) — مش دليل على LOCATION_ID
```

🔴 **اقرا الأرقام دي مع بعض:** التسليمات لسه بتوصل (`not_linked_yet` النهارده)
لكن `synced` واقفة من 09-09 09:08، و`wp_variation_not_found` بدأت 09-09 10:48.
يعني **مافيش حاجة غلط في استقبال الويبهوك** — العطل بعد كده، في ووردبريس.
تفاصيل → «عطل مفتوح: WordPress بيرجّع 404».

**إثبات نقل الويبهوك تحديدًا** (غير الاستعلام فوق): أي صف جديد لازم يكون
`extra.signedWith = 'CLIENT_SECRET'` — الاستعلام في «نظام الويبهوك».

## الواجهة (اتبنت من أول وجديد — 10-09-2026 · تابين من 21-11-2026)

> **v2.2.0:** الشاشة بقت تابين (`.main-tabs-bar`): «📦 مزامنة الاستوك» (شريط الحالة + شرح + المزامنة الشاملة) و«📜 سجل العمليات»
> (السجل بيتحمّل lazy أول مرة التاب يتفتح). نافذة تأكيد بتسمّي الأثر قبل الشاملة، قفل نقط التعديل أثناءها (`setUpdateLock`)،
> والخروج التلقائي مقفول طول ما هي شغّالة. نقطة الاستئناف في الذاكرة بس (refresh بيمسحها — مقصود).

النسخة القديمة كانت جدول HTML بسيط بلا App Shell ولا نافذة «عن الأداة» ولا
سجل تحديثات ولا رقم نسخة، وفلترتها في المتصفح. اتبنت من جديد على
`ecommoda-html-builder v7.0.0`:

```
Tier         : M (1200px) — الأداة فيها جدول سجل
شاشة الدخول  : خطوتين (اختيار الموظف ← PIN) + زرار إعدادات جوّه الكارت
الهيدر       : [الحالة] [👤] [↻ تحديث] [ℹ️ عن الأداة] [v2.0.0 📋] [⚙️ الإعدادات]
الجدول       : قسم موحّد — فلاتر (نوع العملية multi-select · فترة · بحث) + ترتيب + ترقيم
z-index      : قوايم 200 · دخول 500 · مودالات 600 · توست 9999
```

**اللي اتشال من الإعدادات:** حقل رابط الـ Worker. الرابط مش سر
(Standards #28) ومعروف وقت الكتابة، فبقى ثابت `WORKER_URL` في الكود.
الحقل الوحيد الباقي هو `WORKER SECRET`.

**مفتاح `localStorage` اتغيّر** من `stocksynclog_worker_secret` لـ
`stylebox_stock_sync_worker_secret`، وفيه نقل تلقائي مرة واحدة فمحدش محتاج
يعيد إدخال السر. القديم **مابيتمسحش** — مسحه بيكسر أي تبويب لسه فاتح النسخة القديمة.

### 🟢 شريط الحالة — الحاجة اللي كانت ناقصة فعليًا

```
آخر مزامنة ناجحة   ← الكتابة على WooCommerce شغّالة؟
آخر تسليمة ويبهوك   ← الاستقبال من شوبيفاي حيّ؟
آخر ٢٤ ساعة        ← إجمالي · نجح · فشل
```

**السؤالين دول اتفرقوا فعليًا يوم 09-09-2026** — التسليمات فضلت واصلة
والمزامنة وقفت، وفضل الفرق مخفي **يوم كامل** لأن الشاشة كانت سجل تاريخي بس
ومفيش حاجة عليها بتقيسه. لما الحالتين يتعارضوا (ويبهوك واصل + مفيش مزامنة
من أكتر من يوم) الواجهة بتطلّع تنبيه صريح بيقول إن المشكلة **بعد الاستقبال**.

> ⚠️ الشريط ده بيقلّل فخ ٦ **ومابيقفلوش**: هو بيقرا من D1، يعني بيقول
> «آخر صف اتكتب إمتى» — مش «الاشتراك على شوبيفاي لسه موجود». الإثبات ده
> لسه في Reclaim بتاع Webhook Control Center بس.

**عدّاد «فشل» مقصود إنه ضيّق:** `not_linked_yet` و`stale_event_skipped`
و`no_triggered_at_header` و`location_skipped` **مش فشل** ومابيدخلوش العدّاد.
لو دخلوا، أكتر رقم على الشاشة (٩٬٤٥٤ صف `not_linked_yet`) يبقى أقله إفادة
والموظف بيتعلّم يعدّي على الأحمر كله.

## فخاخ الأداة دي

- **فخ ٦ اتقلّ بس ما اتقفلش.** بقى فيه تلات إثباتات جزئية، وكل واحد بيثبت
  حاجة مختلفة — الخلط بينهم هو نفسه فخ:
  | الإثبات | بيقول إيه | **مش** بيقول إيه |
  |---|---|---|
  | شريحة `v2.0.0` + `get_config` | الكود الجديد اتنشر | إن الويبهوك بيوصل |
  | «آخر تسليمة ويبهوك» في الشريط | آخر صف اتكتب في D1 إمتى | إن الاشتراك على شوبيفاي لسه موجود |
  | «آخر مزامنة ناجحة» | الكتابة على WooCommerce اشتغلت | إن كل حدث بيتزامن |

  الإثبات القاطع إن الاشتراك حيّ لسه **Reconcile في Webhook Control Center** بس.
- 🔴 **الاشتراك بقى غير مرئي من داشبورد شوبيفاي.** بعد النقل، شاشة
  Settings → Notifications → Webhooks **مش بتعرض** الاشتراك ده خالص —
  الاشتراكات المعمولة بالـ API مالهاش وجود في الشاشة دي. مش معناه إنه
  اتمسح. مكان العرض الوحيد: Webhook Control Center → 🪝 إدارة الويبهوكس.
- **شوبيفاي بتحذف الاشتراك بصمت** بعد ردود متكررة مش-2xx، من غير أي إشعار.
  صمت السجل دليل ظرفي بس — الإثبات الوحيد هو زرار «🔄 Reconcile مع شوبيفاي»
  في Webhook Control Center.
- ✅ **مسار الويبهوك بقى واحد** (`/webhook`). فرع `?action=shopify_webhook`
  اتشال بعد التأكد إنه بلا مصدر تسليمات.
- ✅ **اسم الـ Worker في الواجهة اتصحّح** (`wc-stock-sync-worker` →
  `stylebox-stock-sync-worker`) في نص "عن الأداة" وplaceholder الإعدادات.
- **`no_triggered_at_header` مش خطأ** — معناها إن شوبيفاي ما بعتتش
  `X-Shopify-Triggered-At`، فحارس الترتيب اتخطى للحدث ده بوعي.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
الواجهة الأصلية (Index.html بحرف كبير) محفوظة في commit: 61045a0
git show 61045a0:Index.html
```

مفيش ملفات نسخ مرقّمة (`2.0.html` …) في الريبو ده أصلاً.

**إثبات النقل النضيف — نقطتين في التاريخ:**

```
index.js   بايت ببايت من كلاودفلير في commit ea7a38f
           md5 = a8f002cd533ecc3c471c052150cfeac7 · 607 سطر
index.html نفس الـ blob SHA بتاع Index.html القديم في commit e6298e1
           dfd4053632c999d3af8698be8a8415af2abe89a4 — قبل سطر البصمة
```

> ⚠️ **الجملتين دول بيوصفوا نقل الأداة على Git (09-09-2026) بس.** بعد نقل
> الويبهوك (10-09-2026) الملفين **مابقوش** مطابقين للنسخة اللي في
> كلاودفلير وقتها — الكوميتات فوق هي مرجع «النسخة الأصلية» لو احتجت
> ترجعلها، مش وصف للملف الحالي.

## مواءمة 21-11-2026 — Worker v3.2.0 · الواجهة v2.2.0 (المزامنة الشاملة + تابين)

> مقارنة بـ `Stylebox-Price-Sync` v1.4.0 (النمط المرجعي) وبإصدارات المهارات الحالية. `node test.mjs` — **كل الفحوص عدّت** (قسم ١٧ جديد: ٣٠ حالة) و`check-html.mjs` و`check-log-values.mjs` exit 0.

| الحاجة | قبل | بعد |
|---|---|---|
| مزامنة يدوية | مفيش — الواجهة «قراءة فقط» | `bulk_sync_all` + تاب «مزامنة الاستوك» (نفس تصميم الأسعار) |
| نداءات ووردبريس للشاملة | — | endpoint دفعات `variation-stocks` (١ لكل ≤٢٠ بدل ٢ لكل variant) + circuit breaker عند 429 (Step 3.5 قواعد ٤–٧) |
| صفوف D1 | بلا `extra.result`/`stage` | كلها فيها `result`/`stage` (+ `origin:'bulk_sync'` للشاملة) — Step 5A ④ ⑭ |
| `log-values.json` | `result:null` لكل القيم | `result`/`stage` مكتوبين + ٣ أنواع جديدة + `logAnchors:["log"]` (الأنكور المحلي في `prepareBulkVariant`) |
| `diag` | endpoint ووردبريس القديم بس | + endpoint الدفعات (400 = شغّال) |
| `get_config` | version + env | + `bulk.pageSize/wpBatchSize` |
| الواجهة | صفحة واحدة، «عرض فقط» | تابين · نافذة تأكيد بالأثر · عدّادات النتايج الخمسة · استئناف عند 429 · About/Changelog محدّثين |
| `MIN_WORKER_VERSION` | `3.1.0` | `3.2.0` (الواجهة بتعتمد على `bulk_sync_all`) |

## مواءمة 18-11-2026 — Worker v3.1.0 · الواجهة v2.1.0

> مواءمة مع المهارات الحالية. `node test.mjs` — **كل الفحوص عدّت** (اتزاد قسم ١٦ بخمس حالات جديدة).

| الحاجة | قبل | بعد |
|---|---|---|
| إصدار API | `2026-01` | **`2026-10`** (`inventoryItem.variants` اتفحصت على Shopify MCP) |
| `getAccessToken` | محاولة واحدة (مع كاش) | 3 محاولات + backoff قصير (مسار ويبهوك — ميزانية ~٥ ث) |
| `shopifyGQL` | بيرمي على الأخطاء | + إعادة محاولة قصيرة على `THROTTLED` + التقاط التكلفة |
| `getLogs` | `ORDER BY timestamp DESC` حرفي | **`orderByClause()`** بقائمة بيضاء + كاسر تعادل — الواجهة بقت بتبعت `sortBy`/`sortDir` والترتيب على السيرفر (كان بيرتّب صفحة الـ١٠٠ صف بس) |
| `diag` | **مفيش** (أداة بتكتب على ووردبريس!) | **اتضاف** + زرار 🩺 في الإعدادات |
| حارس `WORKER_SECRET` | `Bearer undefined` ممكن يعدّي | `typeof`+`trim` ⇒ 500 |
| الواجهة | خروج بـ`confirm` · مفيش خروج تلقائي | خروج تلقائي 60 د + خروج فوري |

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v4.2.0 |
| ecommoda-constants | v6.0.1 |
| woocommerce-sync-helper | v2.2.0 |
| shopify-graphql-helper | v3.2.0 |
| shopify-webhook-helper | v1.0.0 |
| ecommoda-html-builder | v9.1.1 |

> `ecommoda-constants` v6.0.1: الرقم من بصمة `Stylebox-Price-Sync` (19-11-2026) — ماتقرتش المهارة نفسها في جلسة 21-11، والمفردات (§12) المستخدمة هنا هي نفس اللي في الأسعار.
> `shopify-webhook-helper` v1.0.0: ماتلمسش مسار الويبهوك في الجولة دي (غير إضافة `result`/`stage` على الصفوف) — الرقم مش متراجع.

آخر مطابقة: 21-11-2026 · `index.js` v3.2.0 · `index.html` v2.2.0

🔴 معلّقة:
- 🔴 **سنيپت `variation-stocks` لسه ما اتلصقش على ووردبريس** (الريبو فيه الملف: `wordpress/variation-stocks-snippet.php`). من غيره المزامنة الشاملة بتفشل بأول دفعة برسالة صريحة ⇒ **يتلصق قبل أول تشغيل** (ترتيب النشر فوق). وراجع اسم `$permission_check` في الـ closure الحالي.
- ⚠️ **تكلفة استعلام الشاملة على شوبيفاي مقدّرة مش مقيسة** (~٥ نقط/variant ⇒ ~٢٥٠ للصفحة، أقل من ٧٠٠). أول تشغيل بيرجّع `queryCost` و`throttleStatus` في الرد — لو `actualQueryCost` طلع أعلى بكتير، `BULK_SYNC_PAGE_SIZE = floor(700 ÷ التكلفة للـ variant)` (والاستعلام نفسه اتجرّب على Shopify MCP/`2026-10` وصالح).
- ⚠️ **اختبار حي بعد النشر (v3.2.0):** 🩺 فحص النظام ← `WooCommerce batch endpoint ✅` ← شاملة صفحة واحدة ← صف `synced` + مطابقة الكمية على الموقع ← الكاملة. وارجع للاستعلام فوق. ماتشغّلش شاملة الأسعار والاستوك في نفس الوقت (نافذة 429 مشتركة).
- 🟡 **الاستوك السالب** يتبعت زي ما هو (ويبهوك وشاملة) — لو عايزه يتقفل عند صفر، قرار منتج.
- 🟡 **شاشة السجل لسه على الشكل القديم (قسم فلاتر فوق الجدول — `S47`) ومن غير تحكم في عرض الأعمدة (`S51`)** — معيار الجداول الجديد (فلاتر في رأس العمود + قايمة `position:fixed` + مقبض سحب العرض، `data-table-standard.md` §2 و§9ب) إعادة تصميم كبيرة لشاشة تشغيل حيّة. اتأجّلت **بقرار مقصود** 18-11-2026 (المهارة نفسها بتصنّفها 🟡 «عند أول فتح، مش في حملة») عشان ما تتغيّرش من غير مراجعة بصرية حقيقية. تتعمل في جلسة مخصصة بـ `templates/24_data-table-section.html` + اختبار Playwright.
- 🟡 **Build watch paths** (chip لـ`index.js` وchip منفصل لـ`wrangler.toml`) — إعداد في داشبورد Cloudflare مش في الريبو، ماتأكدش منه من الجلسة دي.
- ✅ **اتقفل 18-11-2026:** «عشر قيم `type` غير مسجّلة في `ecommoda-constants` §7» — البند ده كان قبل `constants` v3.0.0؛ السجل بقى `log-values.json` جنب الكود و`node check-log-values.mjs` بيرجّع exit 0 على كل القيم.
- ⚠️ **اختبار حي لازم بعد النشر:** 🩺 فحص النظام (جديد) · وبعدها غيّر مخزون variant مربوط وتأكد من صف `synced`. وتذكّر إن `MIN_WORKER_VERSION` بقت `3.1.0` — الواجهة هتعرض ⚠️ لو الـ Worker المنشور أقدم.

## عطل مفتوح: WordPress بيرجّع 404 (من 09-09-2026)

**مش من الأداة دي ولا من النقل** — متسجّل هنا لأنه بيخفي نجاح النقل.

`wcGetVariationStock` بترجّع `null` على 404، فبيتسجّل `wp_variation_not_found`
وبنوقف قبل أي كتابة. الأرقام:

- `wp_stock_sync` : ٣٠ صف · أول واحد **09-09-2026 10:48 UTC**
- `stylebox_price_sync` : ٥٦ صف · أول واحد **09-09-2026 10:47 UTC**

الاتنين بدأوا في نفس الدقيقة تقريبًا، وكل واحد فيهم بينادي **endpoint مختلف
بهيدر سر مختلف** (`variation-stock` بـ `X-EcomModa-Secret` مقابل
`variation-price` بـ `X-Sync-Header-Secret`). توافق زي ده معناه سبب مشترك عند
ووردبريس — مش باج في أي worker من الاتنين.

عيّنة من الـ IDs اللي رجعت 404: `1127` · `1128` · `1129` · `1183` · `1184` ·
`5021` · `17457`.

**احتمالين، ولسه ما اتحسمش أيهم** (الجلسة اللي كتبت الملف ده كانت محجوبة
عن `stylebox.online` بسياسة الشبكة، فما قدرتش تجرّب الـ endpoint):

1. **الإضافة اتوقفت / المسار اتغيّر** — ساعتها WP REST بيرجّع 404 بكود
   `rest_no_route` **لكل** نداء. ده بيفسّر إن الاتنين وقعوا في نفس الدقيقة
   رغم اختلاف الـ endpoint والسر، وإن `sku_mismatch` وقفت هي كمان (آخر صف
   09-09 04:37) — يعني **مافيش ولا نداء بيعدّي** بقاله يوم، مش variants
   متفرقة. **ده الأرجح.**
2. **الـ variations اتعملت من جديد** (IDs جديدة) فقيم
   `custom.wordpress_variation_id` على شوبيفاي بقت بتشاور على صفوف مامضتش.

**التفرقة بقت أوتوماتيكية من 10-09-2026:** `wcGetVariationStock` بقت تفرّق
بين 404 بكود `rest_no_route` (بترمي ⇒ `unexpected_error` برسالة صريحة إن
الـ endpoint غايب) و404 عادي (⇒ `wp_variation_not_found` زي الأول). يعني
أول تسليمة بعد النشر هتقول أي احتمال هو الصح من غير أي تخمين.

**تشخيص يدوي فوري (٣٠ ثانية)، من غير انتظار النشر:**

```
افتح https://stylebox.online/wp-json/ecommoda/v1  في المتصفح
  ردّ فيه routes  ⇒ الإضافة شغّالة  ⇒ الاحتمال (٢)
  404 rest_no_route ⇒ الإضافة واقفة ⇒ الاحتمال (١)
```

لو طلع الاحتمال (٢): **مفيش تعديل كود بيصلحه** — القيم على شوبيفاي هي
اللي محتاجة تحديث.

## مسائل مفتوحة

- **تسجيل الـ ١٠ `type` الناقصين في `ecommoda-constants` §7** — القيم اللي
  بتتكتب فعليًا وناقصة: `gtin_mismatch` · `wp_variation_not_found` ·
  `wp_update_failed` · `variant_not_found` · `location_skipped` ·
  `stale_event_skipped` · `no_triggered_at_header` · `empty_payload_bug` ·
  `hmac_failed` · `logout`.
- **تضييق الـ Build watch paths** على `index.js` + `wrangler.toml`
  (⚠️ بقى فيه `test.mjs` و`check-html.mjs` في الجذر — ملفات فحص مالهاش أي
  علاقة بالنشر، فتضييق المسارات بقى أنفع من الأول)
  (`ecommoda-tool-migration-playbook` §13-ب) — لسه ما اتعملش. لو اتعمل، لازم
  الاختبارين (السلبي والإيجابي)، والتضييق يتوثّق هنا.
- **إسقاط `SHOPIFY_WEBHOOK_SECRET`** بعد إثبات إن كل التسليمات بقت
  `signedWith=CLIENT_SECRET` — الاستعلام والخطوات في «نظام الويبهوك» فوق.
  ده آخر بند في النقل ولسه مفتوح بوعي.
- **ضوضاء `not_linked_yet`** — ٩٬٤٥٤ صف (أكبر نوع في الأداة) وكل واحد فيهم
  كلّف استعلام GraphQL كامل. `INVENTORY_LEVELS_UPDATE` مايقدرش يفلترها من
  عند شوبيفاي (مافيش metafields في الـ payload)، فالحل لو اتقرر: خنق
  التسجيل في الكود (سجّل مرة واحدة لكل variant لحد ما حالة الربط تتغيّر).
  **ما اتعملش** — بيقلّل قابلية الملاحظة، ومحتاج قرار.
- ✅ **اتقفل 21-11-2026:** «مافيش إعادة مزامنة يدوية» — اتضافت المزامنة الشاملة (`bulk_sync_all`) بطلب صريح من أحمد، والعقد اتحدّث
  في أول الملف وفي «عن الأداة». ⚠️ **الشاملة مابتصلحش** عطل ووردبريس 404 لو لسه قايم — هتطلّع `wp_variation_not_found`/`sku_mismatch` صفوف بدل ما تخبّيهم.
- **إعادة تسمية الـ Worker** مؤجَّلة بقرار المشروع (§1 قرار ٦).


آخر تحديث: 21-11-2026 — 10:43 — v3.2.0: المزامنة الشاملة (bulk_sync_all) + endpoint الدفعات + تابين + result/stage على كل الصفوف

</div>
