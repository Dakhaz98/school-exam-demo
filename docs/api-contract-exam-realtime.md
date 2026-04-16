# عقد API — خدمة exam-realtime (Express)

**الإصدار:** `0.1` (مسودة أولى تلتزم بالسلوك الحالي في `server.js`)  
**القاعدة:** نفس أصل النشر (مثال Render) — لا مسار `/api/v1` بعد؛ أي إصدار لاحق يضيف بادئة أو رؤوس `Accept-Version`.

## المصادقة (اليوم)

- معظم مسارات الإدارة والطالب تعتمد على **معرفات في المسار** (`studentId`, `staffId`) وحالة الخادم في الذاكرة/SQLite — لا JWT موحّد بعد.
- **اتجاه الدمج مع `console-web`:** رؤوس اختيارية مستقبلية مثل `Authorization: Bearer <session>` أو `X-Exam-Session: <token>` مع رفض `401/403` موثّق — يُنفَّذ عند ربط Supabase.

## صحة النشر

| الطريقة | المسار | الاستجابة |
|---------|--------|-----------|
| GET | `/api/health` | JSON حالة الخدمة |

## واجهة الدخول (SPA) — معاملات استعلام من `console-web`

يستهلكها `public/app.js` عند التحميل ثم تُزال من شريط العنوان (`history.replaceState`).

| المعامل | إلزامي | الوصف |
|---------|--------|--------|
| `prefill_from_console` | نعم | يجب أن يكون `1` لتفعيل المسار الآمن. |
| `prefill_role` | نعم | `student` \| `proctor` \| `admin` |
| `prefill_student_id` | لدور student | يطابق عمود **Student ID** في Excel. |
| `prefill_staff_id` | لدور proctor | يطابق **Staff ID**. |
| `prefill_user_id` | بديل | يُستخدم إن لم يُرسل المعرف المخصص للدور. |
| `prefill_display` | لا | اسم العرض في النموذج. |
| `exam_ref` | لا | مُعرّف امتحان من لوحة Next (UUID) — يُعرض كتلميح فقط؛ الخادم لا يربطه بعد بجلسة SQLite. |

للطالب: يُصفّر `sessionStorage` للجلسة المحلية حتى لا يُستبدل المعرف القادم من الكونسول بجلسة قديمة.

## REST — مجموعات مختصرة (غير شاملة؛ المرجع هو الكود)

### قوالب ورفع

- `GET /api/admin/template/*` — قوالب Excel/CSV/أسئلة.
- `POST /api/admin/upload/students`, `teachers`, `question-model`
- `POST /api/teacher/:staffId/upload/question-model`

### جدولة الامتحان والإدارة

- `POST /api/admin/exam/*` — `schedule`, `publish`, `extend`, `access-key`, `seb-settings`, …
- `GET /api/admin/exam/access-key/status`, `seb-settings`, …

### الطالب والمراقب

- `GET /api/student/:studentId/room`, `entry-status`, `paper`, `exam-current`, `mcq-score`
- `POST /api/student/:studentId/request-entry`, `exam-submit`, `answer`, `exam-revoke`, `acknowledge-honesty`
- `GET /api/proctor/:staffId/room`, `room-waitlist`, `auto-grade-room`, `room-exam-progress`
- `POST /api/proctor/:staffId/admit-student`, `release-paper`

### تقارير الإدارة

- `GET /api/admin/answers-summary`, `auto-grade-summary`, `essay-results`, `item-analysis`, `results-report`, …

## Socket.IO — أحداث العميل → الخادم

| الحدث | الغرض |
|-------|--------|
| `register` | تسجيل الجلسة (مع callback) |
| `room:join` / `room:leave` | غرفة Socket |
| `chat:private` | دردشة خاصة |
| `integrity:signal` | إشارات سلامة |
| `exam:visibility` | رؤية الامتحان |
| `webrtc:relay` / `webrtc:student_cam_ready` | تتابع WebRTC |
| `incident:raise` | بلاغ |

الخادم يبث تحديثات الغرفة حسب التنفيذ الحالي في `server.js` (مرجع للمستهلكين: `public/app.js`).

## أخطاء موحّدة (مستهدفة)

حتى التطبيق الكامل، الاستجابات تبقى JSON نصية متنوعة. **الهدف:** `{ "error": "code", "message": "…", "requestId": "…" }` مع رمز HTTP مناسب.

## تغييرات متوافقة مع الإصدارات

1. إضافة حقول JSON اختيارية — مسموح.
2. إزالة حقول أو تغيير دلالة — يتطلب إصداراً جديداً في المسار أو الرأس.
3. دمج `console-web` يمر عبر **بوابة BFF** في Next إن لزم لتجنب CORS المعقّد على المتصفح.

---

*يُحدَّث عند تغيير مسارات حرجة في `server.js`.*
