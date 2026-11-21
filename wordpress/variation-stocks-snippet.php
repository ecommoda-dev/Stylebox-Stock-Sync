// ══════════════════════════════════════════════════════════════════════
// EcomModa — endpoint الدفعات: POST /wp-json/ecommoda/v1/variation-stocks
// الإصدار: v1.0.0 — 21-11-2026 (يخدم stylebox-stock-sync-worker v3.2.0 — المزامنة الشاملة)
//
// ⚠️ للّصق في WPCode (سنيپت `EcomModa – MCP Abilities`) — WPCode بيضيف <?php
//    لوحده، فالملف ده **من غير** <?php عن قصد. متلزقش <?php.
// ⚠️ حطّه **جوّه نفس** add_action( 'rest_api_init', function () { ... } ) اللي فيها route
//    `variation-stock/{id}` القديمة (اللي الويبهوك بينادي عليها) — لأنه بيستخدم نفس
//    $permission_check (hash_equals على هيدر X-EcomModa-Secret).
//    متمسحش القديمة ولا $permission_check.
//    لو اتلصق برّه الـ closure ده، $permission_check مش معرّف → الـ route بيرد 401 دايمًا
//    (fail-closed — مفيش وضع بيفتح من غير سر).
// ✅ اتأكد (21-11-2026) من سنيپت «Variation Stock Sync API» الحالي: $permission_check موجود بنفس الاسم
//    وبيفحص X-EcomModa-Secret مقابل EC_STOCK_SYNC_SECRET.
// ⚠️ مفيش سر في الملف ده.
//
// العقد:
//   body : { items: [{ variation_id, expected_sku, expected_gtin, quantity }] }   (≤ 50 item)
//   reply: { success, summary, results[] } — نتيجة لكل item **بنفس ترتيب المدخلات** (+ index)
//          status: updated | unchanged | sku_mismatch | gtin_mismatch | not_found | bad_request | save_failed
//          (HTTP 200 حتى لو فيه items فاشلة — الفشل الجزئي مش خطأ HTTP)
//   quantity: رقم صحيح — **سالب مسموح** (شوبيفاي available ممكن تنزل تحت الصفر عند أوفرسيلينج،
//             والويبهوك بيبعتها زي ما هي) — الـ Worker هو اللي بيمنع null/غير الرقمي قبل الإرسال.
// ══════════════════════════════════════════════════════════════════════

register_rest_route( 'ecommoda/v1', '/variation-stocks', array(
    'methods'             => 'POST',
    'permission_callback' => isset( $permission_check ) ? $permission_check : '__return_false',
    'callback'            => function ( WP_REST_Request $req ) {

        $items = $req->get_param( 'items' );
        if ( ! is_array( $items ) || empty( $items ) ) {
            return new WP_REST_Response( array( 'code' => 'ec_bad_request', 'message' => 'items مطلوبة (مصفوفة غير فاضية)' ), 400 );
        }
        if ( count( $items ) > 50 ) {
            return new WP_REST_Response( array( 'code' => 'ec_bad_request', 'message' => 'الحد الأقصى 50 item في النداء الواحد' ), 400 );
        }

        $results = array();   // نتيجة واحدة لكل item **بنفس ترتيب المدخلات** (الـ Worker بيطابق بالفهرس)
        $parents = array();   // parent_id => true — sync مرة واحدة لكل أب مش لكل مقاس
        $touched = array();   // variation ids اللي اتحدّثت فعلاً
        $summary = array(
            'total' => count( $items ), 'updated' => 0, 'unchanged' => 0, 'sku_mismatch' => 0,
            'gtin_mismatch' => 0, 'not_found' => 0, 'bad_request' => 0, 'save_failed' => 0,
        );

        // الكمية "عدد صحيح" (نص أرقام أو رقم). بيرجّع null لو الشكل غلط — مفيش تحويل صامت لصفر.
        $int = function ( $v ) {
            if ( is_int( $v ) ) { return $v; }
            if ( is_float( $v ) && floor( $v ) == $v ) { return (int) $v; }
            if ( is_string( $v ) && preg_match( '/^-?\d+$/', trim( $v ) ) ) { return (int) trim( $v ); }
            return null;
        };

        foreach ( array_values( $items ) as $idx => $it ) {
            $vid = ( is_array( $it ) && isset( $it['variation_id'] ) ) ? $it['variation_id'] : null;
            $row = array( 'index' => $idx, 'variation_id' => is_numeric( $vid ) ? (int) $vid : 0 );

            try {
                // 1) تحقق الشكل
                $valid_id = is_int( $vid ) || ( is_string( $vid ) && ctype_digit( $vid ) );
                $qty = ( is_array( $it ) && array_key_exists( 'quantity', $it ) ) ? $int( $it['quantity'] ) : null;
                if ( ! $valid_id || $qty === null ) {
                    $row['status']  = 'bad_request';
                    $row['message'] = 'variation_id رقم صحيح، quantity عدد صحيح';
                    $summary['bad_request']++;
                    $results[] = $row;
                    continue;
                }
                $vid = (int) $vid;
                $row['variation_id'] = $vid;

                // 2) المقاس لازم يكون WC_Product_Variation (0 مرفوض هنا — wc_get_product(0) مش آمنة)
                $v = $vid > 0 ? wc_get_product( $vid ) : false;
                if ( ! $v || ! ( $v instanceof WC_Product_Variation ) ) {
                    $row['status'] = 'not_found';
                    $summary['not_found']++;
                    $results[] = $row;
                    continue;
                }

                // 3) التحقق الثلاثي — نفس منطق الويبهوك بالحرف: trim + مقارنة نصية صارمة،
                //    SKU الأول ثم GTIN. الـ item ده ماتكتبش لو فشل.
                $wc_sku  = (string) $v->get_sku();
                $wc_gtin = method_exists( $v, 'get_global_unique_id' )
                    ? (string) $v->get_global_unique_id()
                    : (string) $v->get_meta( '_global_unique_id' );
                $exp_sku  = isset( $it['expected_sku'] )  ? (string) $it['expected_sku']  : '';
                $exp_gtin = isset( $it['expected_gtin'] ) ? (string) $it['expected_gtin'] : '';

                if ( trim( $exp_sku ) !== trim( $wc_sku ) ) {
                    $row['status']  = 'sku_mismatch';
                    $row['message'] = 'wc_sku=' . $wc_sku . ' expected_sku=' . $exp_sku;
                    $summary['sku_mismatch']++;
                    $results[] = $row;
                    continue;
                }
                if ( trim( $wc_gtin ) !== trim( $exp_gtin ) ) {
                    $row['status']  = 'gtin_mismatch';
                    $row['message'] = 'wc_gtin=' . $wc_gtin . ' expected_gtin=' . $exp_gtin;
                    $summary['gtin_mismatch']++;
                    $results[] = $row;
                    continue;
                }

                // 4) الكمية الحالية = المطلوبة؟ ← unchanged من غير save().
                //    لو إدارة المخزون مقفولة على المقاس، الكمية «غير معروفة» فبنكتب.
                $managed = (bool) $v->get_manage_stock( 'edit' );
                $old_raw = $v->get_stock_quantity( 'edit' );
                $old     = ( $old_raw === null || $old_raw === '' ) ? null : (int) $old_raw;
                if ( $managed && $old !== null && $old === $qty ) {
                    $row['status']       = 'unchanged';
                    $row['old_quantity'] = $old;
                    $row['new_quantity'] = $qty;
                    $summary['unchanged']++;
                    $results[] = $row;
                    continue;
                }

                // 5) كتابة WC CRUD — حالة المخزون (instock/outofstock) بتتحسب من الكمية في save()
                $v->set_manage_stock( true );
                $v->set_stock_quantity( $qty );
                $v->set_stock_status( $qty > 0 ? 'instock' : 'outofstock' );   // نفس سلوك POST variation-stock/{id} القديم
                $v->save();

                $row['status']       = 'updated';
                $row['old_quantity'] = $old;
                $row['new_quantity'] = $qty;
                $summary['updated']++;
                $results[] = $row;

                $touched[] = $vid;
                $pid = (int) $v->get_parent_id();
                if ( $pid > 0 ) { $parents[ $pid ] = true; }

            } catch ( Throwable $e ) {
                $row['status']  = 'save_failed';
                $row['message'] = $e->getMessage();
                $summary['save_failed']++;
                $results[] = $row;
            }
        }

        // بعد الحلقة — مرة واحدة لكل أب: sync + مسح الترانزيينتس (قاعدة PHP #4 — stylebox-mcp-access Step 6)
        foreach ( array_keys( $parents ) as $pid ) {
            if ( class_exists( 'WC_Product_Variable' ) ) { WC_Product_Variable::sync( $pid ); }
            wc_delete_product_transients( $pid );
        }
        foreach ( $touched as $tvid ) {
            wc_delete_product_transients( $tvid );
        }

        // HTTP 200 حتى لو فيه items فاشلة — الفشل الجزئي مش خطأ HTTP
        return new WP_REST_Response( array( 'success' => true, 'summary' => $summary, 'results' => $results ), 200 );
    },
) );
