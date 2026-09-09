# مزامنة استوك Shopify → WooCommerce (`Stylebox-Stock-Sync`)

**بتعمل إيه:** مستقبِل ويبهوك `inventory_levels/update` من Shopify — بيعمل
Triple-Check (SKU + GTIN + WordPress Variation Id) وبيحدّث استوك الـ variation
على `stylebox.online`. والواجهة **قراءة فقط**: سجل كل عملية مزامنة تمّت أو فشلت.
**مين بيستخدمها:** مخزن · إدارة (عرض السجل بس — مفيش أي تعديل استوك من الواجهة)
**الإصدار:** Worker `بلا رقم في الكود` · الواجهة `بلا رقم في الكود`

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
| `?action=shopify_webhook` (POST) | نفس المسار — فرع قديم مؤقت | نفس الشيء |
| `check_employee` · `register_pin` · `verify_employee` · `log_logout` · `get_employees` | تسجيل الدخول الموحّد | `Bearer WORKER_SECRET` |
| `get_logs` · `get_logs_count` · `get_logs_export` | سجل العمليات + التصدير | `Bearer WORKER_SECRET` |

> 🔴 **ترتيب الفروع في `fetch` مش تجميلي.** فرع الويبهوك لازم يفضل **قبل**
> حارس `WORKER_SECRET` — شوبيفاي مبتبعتش `Authorization`. أي إعادة ترتيب =
> كل تسليمة ويبهوك بترجع `401` والاستوك بيقف عن المزامنة بصمت.

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
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET · SHOPIFY_WEBHOOK_SECRET · WP_SYNC_SECRET
Vars     : SHOP_DOMAIN · LOCATION_ID · WP_BASE_URL     ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي) — التضييق لسه ما اتعملش
```

**تصنيف الـ `env.*` (`ecommoda-tool-migration-playbook` §4-أ-٢):**

| المتغيّر | التصنيف | إزاي يتأكد |
|---|---|---|
| `WORKER_SECRET` · `CLIENT_ID` · `CLIENT_SECRET` · `SHOPIFY_WEBHOOK_SECRET` · `WP_SYNC_SECRET` | سر | قيمته مستحيلة القراءة — من مصدر أحمد بس |
| `SHOP_DOMAIN` · `WP_BASE_URL` | var بيرمي لو غاب | مُثبَت من D1: أي صف `synced` بيتكتب **بعد** نداء WooCommerce ⇒ الاتنين كانوا شغالين |
| `LOCATION_ID` | 🔴 **var ليه fallback** | **الداشبورد بعينك — ولا حاجة تانية** |

> 🔴 **ليه `LOCATION_ID` هو الخطر هنا:** الكود بيقول
> `if (env.LOCATION_ID && locationId !== env.LOCATION_ID)`. غيابه **مابيرميش** —
> بيلغي حارس الموقع بالكامل بصمت، فأي حدث مخزون من أي موقع بيتزامن على
> WooCommerce.
> ⚠️ **وسجل D1 مش هيكشفه:** `location_skipped` عنده **صفر صف** في تاريخ الأداة
> كله — وده متوقّع في الحالتين (المتجر عنده موقع واحد). يعني الفرق بين
> «المتغيّر مضبوط» و«المتغيّر ضايع» **غير قابل للقياس من D1 هنا**. الطريقة
> الوحيدة: Settings → Variables بالعين.

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

## فخاخ الأداة دي

- **الأداة مالهاش زرار "تحديث" يثبت إنها شغّالة.** الواجهة سجل تاريخي بس، يعني
  فخ ٦ (فتح الصفحة مش إثبات) **مايتقفلش بفتح الواجهة هنا** — الإثبات الوحيد
  إن `synced` بيزيد في D1 بعد أي تغيير مخزون فعلي على شوبيفاي.
- **مسارين للويبهوك شغالين مع بعض:** `/webhook` (الجديد) و
  `?action=shopify_webhook` (القديم، معلَّم TEMPORARY في الكود). حذف القديم
  **قبل** التأكد إن تسجيل شوبيفاي بيضرب الجديد = وقف مزامنة كامل بصمت.
- **الواجهة بتذكر اسم Worker قديم:** نص "عن الأداة" وplaceholder الإعدادات
  فيهم `wc-stock-sync-worker` — الاسم الحقيقي `stylebox-stock-sync-worker`.
  نص عرض بس، مش رابط فعّال (الرابط بييجي من `localStorage`)، بس بيضلل أي حد
  بيدوّر على الأداة في الداشبورد.
- **`no_triggered_at_header` مش خطأ** — معناها إن شوبيفاي ما بعتتش
  `X-Shopify-Triggered-At`، فحارس الترتيب اتخطى للحدث ده بوعي.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
الواجهة الأصلية (Index.html بحرف كبير) محفوظة في commit: 61045a0
git show 61045a0:Index.html
```

مفيش ملفات نسخ مرقّمة (`2.0.html` …) في الريبو ده أصلاً.

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v3.0.0 |
| ecommoda-html-builder | v7.0.0 |
| ecommoda-constants | v2.0.0 |
| woocommerce-sync-helper | v1.0.0 |
| shopify-graphql-helper | v2.1.0 |

آخر مطابقة: 09-09-2026 · `index.js` بلا رقم · `index.html` بلا رقم

🔴 معلّقة:
- **`ecommoda-constants` §13 — التوقيت المكتوب ثابت.** `index.html` فيه
  `new Date(iso).getTime() + 3 * 60 * 60 * 1000`. يوم **29-10-2026** مصر
  بترجع UTC+2 وكل وقت في السجل هيغلط بساعة من غير أي رسالة. التحويل لـ
  `Intl` مؤجَّل بوعي — النقل بيتم **بايت ببايت** ومش بيغيّر منطق.
- **عشر قيم `type` غير مسجّلة في `ecommoda-constants` §7** (فوق) — مخالفة
  سابقة للنقل، تتقفل بتحديث السكيل مش بتعديل كود.

## مسائل مفتوحة

- **تسجيل الـ ١٠ `type` الناقصين في `ecommoda-constants` §7** — القيم اللي
  بتتكتب فعليًا وناقصة: `gtin_mismatch` · `wp_variation_not_found` ·
  `wp_update_failed` · `variant_not_found` · `location_skipped` ·
  `stale_event_skipped` · `no_triggered_at_header` · `empty_payload_bug` ·
  `hmac_failed` · `logout`.
- **تضييق الـ Build watch paths** على `index.js` + `wrangler.toml`
  (`ecommoda-tool-migration-playbook` §13-ب) — لسه ما اتعملش. لو اتعمل، لازم
  الاختبارين (السلبي والإيجابي)، والتضييق يتوثّق هنا.
- **حذف فرع `?action=shopify_webhook`** بعد تأكيد إن شوبيفاي بتضرب `/webhook`.
- **تصحيح اسم الـ Worker في نصوص الواجهة** (`wc-stock-sync-worker` →
  `stylebox-stock-sync-worker`) — تعديل واجهة مستقل عن النقل.
- **إعادة تسمية الـ Worker** مؤجَّلة بقرار المشروع (§1 قرار ٦).

آخر تحديث: 09-09-2026
