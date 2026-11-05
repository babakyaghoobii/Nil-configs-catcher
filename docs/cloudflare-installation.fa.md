# انتشار خودکار NIL روی Cloudflare

این مسیر برای وب‌اپ و API عمومی کچر است. آدرس فقط پس از بررسی واقعی سایت و جمع‌آوری در `deployment.json` ثبت می‌شود. این مرحله نیازی به حساب Apple Developer یا کلید امضای اندروید ندارد.

## دو مقدار از صاحب حساب

۱. در [Cloudflare → API Tokens](https://dash.cloudflare.com/profile/api-tokens) گزینهٔ **Create Token → Create Custom Token** را بزنید و مثلاً نام `NIL GitHub Deploy` را انتخاب کنید:

| محدوده | مجوز | سطح |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |
| Account | Account Settings | Read |

در **Account Resources** فقط **Include → Specific account → حساب خودتان** را انتخاب کنید. برای این انتشار روی `workers.dev` مجوز Zone/DNS لازم نیست. IP ثابت محیط دستیار را به‌عنوان محدودیت IP وارد نکنید؛ اجرا از GitHub Actions است. مدت اعتبار دلخواه تعیین کنید؛ توکن بعداً قابل لغو است.

۲. در [Secrets مخزن](https://github.com/babakyaghoobii/Nil-configs-catcher/settings/secrets/actions)، زیر **Repository secrets** با **New repository secret** این دو مورد را بسازید:

| Name | Secret |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | توکن ساخته‌شده در مرحلهٔ قبل |
| `CLOUDFLARE_ACCOUNT_ID` | شناسهٔ ۳۲ کاراکتری حساب Cloudflare |

در داشبورد Cloudflare حساب خودتان را انتخاب کنید و **Account ID / Copy Account ID** را پیدا کنید. این شناسه در بسیاری از صفحه‌ها در ابتدای مسیر نوار نشانی، بعد از `dash.cloudflare.com/` هم دیده می‌شود. Account ID همان ایمیل یا Zone ID نیست.

توکن را در چت، Issue، README، فایل کد یا متغیر `VITE_...` قرار ندهید. Secretها فقط در مراحل استقرارِ Actions استفاده می‌شوند و وارد خروجی وب‌اپ نمی‌شوند. دستیار لازم نیست مقدار توکن را ببیند؛ اعلام «ثبت شد» کافی است. اتصال فعلی GitHub برای مدیریت Secrets خطای ۴۰۳ داده و ثبتشان باید توسط صاحب حساب انجام شود.

## اجرای انتشار

از [Actions → Deploy NIL to Cloudflare](https://github.com/babakyaghoobii/Nil-configs-catcher/actions/workflows/deploy-cloudflare.yml) گزینهٔ **Run workflow → main** قابل اجراست. بعد از ثبت Secretها، دستیار نیز می‌تواند همین workflow را اجرا و نتیجه را بررسی کند.

فرآیند خودکار:

1. بررسی Secretها، آزمون سورس و ساخت رابط؛
2. استفاده از زیردامنهٔ موجود `workers.dev`، یا ثبت نام مشخص و وابسته به همان حساب؛
3. ایجاد دیتابیس `nil-config-catcher-babakyaghoobii`، اعمال مهاجرت افزایشی و انتشار Worker با نام `nil-config-catcher`؛
4. بررسی HTTP عمومی، تطبیق HTML و لوگو، واردکردن دادهٔ واقعی گیت‌هاب، اجرای جمع‌آوری و تطبیق اشتراک با کانفیگ‌های واقعی؛
5. ثبت نشانی و زمان تأیید؛ سپس زمان‌بندی گیت‌هاب از همان رجیستری مشترک با دریافت دستی استفاده می‌کند.

Worker هم‌نامِ فاقد سابقهٔ انتشار این پروژه بازنویسی نمی‌شود. دیتابیس هم‌نام با جدول‌های نامرتبط تغییر نمی‌کند. هیچ منبعی حذف یا طرح پولی خودکار فعال نمی‌شود. محدودیت‌های CPU، دیتابیس، درخواست و سهمیهٔ Cloudflare برقرارند. دسترسی HTTP موفق، دسترسی از همهٔ شبکه‌های ایران را تضمین نمی‌کند؛ بررسی بیرونی پس از انتشار هم لازم است.

در صورت کمبود مجوز، تأییدنشده‌بودن حساب، عدم دسترسی به منابع عمومی یا شکست بررسی نهایی، workflow متوقف می‌شود و نشانی تأییدنشده را آماده معرفی نمی‌کند. اگر حفاظت شاخه جلوی ثبت کامیت را بگیرد، دادهٔ سرویس حذف نمی‌شود و دلیل شکست در Actions دیده می‌شود.
