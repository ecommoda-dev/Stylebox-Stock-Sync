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
test.mjs       ← اختبارات مسار الويبهوك — `node test.mjs`
CLAUDE.md      ← قواعد الأداة وفخاخها — اقراه قبل أي تعديل
```

## الاختبارات

```
node test.mjs
```

بلا أي تنصيب — مفيش dependencies ومفيش package.json (مقصود: إضافة واحد
ممكن تغيّر سلوك Workers Builds). بيشغّل `fetch` بتاع الـ Worker الحقيقي
بـ D1 وشبكة مزيّفين. **شغّله قبل أي push بيلمس `index.js`.**

## النشر

`git push` على `main` بينشر الاتنين تلقائيًا — الـ Worker عبر Cloudflare
Workers Builds، والواجهة عبر GitHub Pages. **مفيش لصق كود في داشبورد
Cloudflare بعد الربط** — الريبو هو المصدر الوحيد.

التفاصيل والفخاخ → `CLAUDE.md`.
