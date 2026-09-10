# Stylebox-Stock-Sync

مزامنة استوك Shopify → WooCommerce (`stylebox.online`) عن طريق ويبهوك
`inventory_levels/update`، وواجهة **قراءة فقط** لعرض سجل كل عملية مزامنة.

> الاشتراك متسجّل من **Webhook Control Center** (عبر الـ API) — مش من
> داشبورد شوبيفاي. يعني مش هيظهر في Settings → Notifications → Webhooks،
> وسر التوقيع هو `CLIENT_SECRET`. التفاصيل → `CLAUDE.md`.

| القطعة | الرابط |
|---|---|
| الواجهة (GitHub Pages) | https://ecommoda-dev.github.io/Stylebox-Stock-Sync/ |
| الـ Worker | https://stylebox-stock-sync-worker.ecommoda-dev.workers.dev |

## الملفات

```
index.js       ← كود الـ Worker (مصدر النشر — Workers Builds)
wrangler.toml  ← اسم الـ Worker + D1 binding + vars
index.html     ← الواجهة (GitHub Pages)
test.mjs       ← اختبارات الـ Worker — `node test.mjs`
check-html.mjs ← فحص بنية الواجهة — `node check-html.mjs`
CLAUDE.md      ← قواعد الأداة وفخاخها — اقراه قبل أي تعديل
```

## الاختبارات

```
node test.mjs        # الـ Worker: مسار الويبهوك كامل بـ D1 وشبكة مزيّفين
node check-html.mjs  # الواجهة: بنية الـ CSS + الربط في الـ JS
```

بلا أي تنصيب — مفيش dependencies ومفيش package.json (مقصود: إضافة واحد
ممكن تغيّر سلوك Workers Builds).
**شغّلهم قبل أي push** — الأول لأي تعديل في `index.js`، والتاني لأي تعديل
في `index.html`.

## النشر

`git push` على `main` بينشر الاتنين تلقائيًا — الـ Worker عبر Cloudflare
Workers Builds، والواجهة عبر GitHub Pages. **مفيش لصق كود في داشبورد
Cloudflare بعد الربط** — الريبو هو المصدر الوحيد.

التفاصيل والفخاخ → `CLAUDE.md`.
