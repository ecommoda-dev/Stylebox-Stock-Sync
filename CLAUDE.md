# مزامنة استوك Shopify → WooCommerce (`Stylebox-Stock-Sync`)

**بتعمل إيه:** مستقبِل ويبهوك `inventory_levels/update` من Shopify — بيعمل
Triple-Check (SKU + GTIN + WordPress Variation Id) وبيحدّث استوك الـ variation
على `stylebox.online`. والواجهة **قراءة فقط**: سجل كل عملية مزامنة تمّت أو فشلت.
**مين بيستخدمها:** مخزن · إدارة (عرض السجل بس — مفيش أي تعديل استوك من الواجهة)
**الإصدار:** Worker `v2.0.0` (`?action=version`) · الواجهة `بلا رقم في الكود`

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

## الـ Endpoints

| المسار / `?action=` | بيعمل إيه | البوابة |
|---|---|---|
| `POST /webhook` | استقبال `inventory_levels/update` من Shopify | **قبل** بوابة `WORKER_SECRET` — HMAC بس |
| `?action=version` | إصدار الكود المنشور + وجود الأسرار (بالوجود بس) | `Bearer WORKER_SECRET` |
| `check_employee` · `register_pin` · `verify_employee` · `log_logout` · `get_employees` | تسجيل الدخول الموحّد | `Bearer WORKER_SECRET` |
| `get_logs` · `get_logs_count` · `get_logs_export` | سجل العمليات + التصدير | `Bearer WORKER_SECRET` |

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
        empty_payload_bug · hmac_failed · unexpected_error · login · logout
```

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

## فخاخ الأداة دي

- **الأداة مالهاش زرار "تحديث" يثبت إنها شغّالة.** الواجهة سجل تاريخي بس، يعني
  فخ ٦ (فتح الصفحة مش إثبات) **مايتقفلش بفتح الواجهة هنا** — الإثبات الوحيد
  إن `synced` بيزيد في D1 بعد أي تغيير مخزون فعلي على شوبيفاي.
  ➕ بقى فيه نص إثبات جزئي: «ℹ️ عن الأداة» بيقرا `?action=version` وبيعرض
  إصدار الكود المنشور + أي سر ناقص. ده بيثبت **إن الكود الجديد اتنشر**،
  مش إن الويبهوك بيوصل — التفرقة دي مهمة.
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

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v3.0.0 |
| ecommoda-html-builder | v7.0.0 |
| ecommoda-constants | v2.0.0 |
| woocommerce-sync-helper | v1.0.0 |
| shopify-graphql-helper | v2.1.0 |
| shopify-webhook-helper | v2.2.0 |

آخر مطابقة: 10-09-2026 · `index.js` v2.0.0 · `index.html` بلا رقم

✅ **اتقفلت 10-09-2026:**
- **`ecommoda-constants` §13 — التوقيت الثابت.** `index.html` بقى بيحسب
  `Africa/Cairo` بـ `Intl.DateTimeFormat`. اتأكدنا بالمقارنة: نفس نتيجة
  الكود القديم قبل 29-10-2026 بالظبط، والفرق ساعة كاملة بعده — يعني الباج
  كان حقيقي ومقفول دلوقتي.
- **`ecommoda-html-builder` — قاعدة `esc()` قبل `innerHTML`.** `notes`
  و`sku` بيتحطوا في الجدول من D1، وقيمهم أصلاً جاية من Shopify/WooCommerce
  (نص من برّه الأداة). بقى فيه `esc()` على كل قيمة.

🔴 معلّقة:
- **عشر قيم `type` غير مسجّلة في `ecommoda-constants` §7** (فوق) — مخالفة
  سابقة للنقل، تتقفل بتحديث السكيل مش بتعديل كود. النقل ده **ما ضافش أي
  قيمة جديدة** بقصد: حارس الكمية الجديد بيسجّل تحت `empty_payload_bug`
  الموجودة أصلاً بدل ما يفتح نوع حادي عشر غير مسجّل.

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
- **مافيش إعادة مزامنة يدوية.** `stylebox_price_sync` عنده
  `?action=bulk_sync_all`؛ الأداة دي لأ. يعني أي انحراف (زي موجة
  `wp_variation_not_found` الحالية) مالوش طريقة إصلاح غير انتظار تغيير
  مخزون جديد لكل variant. **مقصود إنه ما اتعملش هنا** — الواجهة متعاقَد
  عليها «قراءة فقط»، وإضافة زرار كتابة قرار منتج مش قرار نقل.
- **إعادة تسمية الـ Worker** مؤجَّلة بقرار المشروع (§1 قرار ٦).

آخر تحديث: 10-09-2026
