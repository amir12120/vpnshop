'use strict';

// ---------------------------------------------------------------- i18n (fa → en)
// English UI dictionary. Keys are Persian strings exactly as they appear in the
// rendered templates; ZWNJ (\u200c) is stripped from BOTH keys and the rendered
// HTML before matching, so keys may be written with or without ZWNJ. Longer keys
// are matched first so whole phrases win over their parts.

const I18N_EN = {
  // ---- brand / chrome ----
  'فروشگاه VPN': 'VPN Shop',
  'فروشگاه': 'Home',
  '🛒 فروشگاه VPN — پرداخت کارت به کارت · تحویل خودکار کانفیگ و لینک اشتراک':
    '🛒 VPN Shop — card-to-card payment · automatic config & subscription-link delivery',

  // ---- header nav ----
  'پلن‌ها': 'Plans',
  'پلن‌ها و خرید': 'Plans & buy',
  'خرید دلخواه': 'Custom purchase',
  'پنل کاربری': 'My panel',
  'پنل مدیریت': 'Admin panel',
  'خروج': 'Logout',
  'ورود': 'Login',
  'عضویت': 'Sign up',
  'خروج از حساب': 'Log out',

  // ---- homepage ----
  'اینترنت پرسرعت، ': 'High-speed internet, ',
  'فقط با چند کلیک': 'in just a few clicks',
  'خرید آنلاین کانفیگ VPN با پرداخت کارت به کارت؛ فیش واریزی را بارگذاری کنید و پس از تأیید مدیر، کانفیگ همراه با QR و لینک اشتراک تحویل بگیرید.':
    'Buy VPN configs online with card-to-card payment; upload your payment receipt and after admin approval receive your config with QR and subscription link.',
  '⚡ تحویل خودکار': '⚡ Auto delivery',
  '🛡 امن و پایدار': '🛡 Secure & stable',
  '📱 همه دستگاه‌ها': '📱 All devices',
  '💳 کارت به کارت': '💳 Card-to-card',
  'پرداخت کارت به کارت': 'Card-to-card payment',
  'مبلغ بسته را به کارت فروشگاه واریز و تصویر فیش را در سایت بارگذاری کنید.':
    'Transfer the plan amount to the shop card and upload the receipt image on the site.',
  'تحویل خودکار': 'Automatic delivery',
  'بعد از تأیید مدیر، کاربر روی پنل سنایی ساخته و کانفیگ به‌صورت خودکار تحویل می‌شود.':
    'After the admin approves, your account is created on the Sanayi panel and the config is delivered automatically.',
  'QR و لینک اشتراک': 'QR & subscription link',
  'با اسکن QR یا لینک اشتراک، روی هر اپ و هر دستگاهی وصل شوید.':
    'Scan the QR or use the subscription link to connect on any app and device.',
  'بسته‌های اینترنتی': 'Internet plans',
  '🧮 حجم دلخواه می‌خواهید؟': '🧮 Want a custom volume?',
  'خرید کانفیگ به مقدار دلخواه': 'Buy a custom-volume config',
  '🧮 خرید کانفیگ به مقدار دلخواه': '🧮 Buy a custom-volume config',
  'هر گیگ ترافیک ماهانه ': 'per GB monthly: ',
  ' — هر مقداری که لازم دارید سفارش دهید.': ' — order as much as you need.',
  ' — هر مقداری که لازم دارید سفارش دهید؛ پس از تأیید مدیر، کانفیگ با همان حجم و نام دلخواه شما ساخته و تحویل می‌شود.':
    ' — order any volume you need; after admin approval, a config with exactly that volume and your chosen name is created and delivered.',
  'پرفروش': 'Best-seller',
  'حالت تاریک': 'Dark mode',
  'حالت روشن': 'Light mode',
  'نحوه خرید': 'How to buy',
  'انتخاب بسته': 'Choose a plan',
  'بسته متناسب با حجم و زمان دلخواه را انتخاب کنید.': 'Pick the plan that fits your volume and duration.',
  'واریز و ارسال فیش': 'Pay & upload receipt',
  'مبلغ را کارت به کارت کنید و تصویر فیش را در سایت بارگذاری کنید.':
    'Transfer the amount card-to-card and upload the receipt image.',
  'تأیید مدیر': 'Admin approval',
  'پس از بررسی فیش، سفارش شما تأیید و کانفیگ ساخته می‌شود.':
    'After checking the receipt, your order is approved and the config is created.',
  'تحویل کانفیگ': 'Config delivery',
  'QR، لینک اشتراک و لینک کانفیگ‌ها را دریافت و وصل شوید.':
    'Get the QR, subscription link and config links, and connect.',
  'هنوز پلنی تعریف نشده است — به‌زودی.': 'No plans defined yet — coming soon.',
  'حجم: ': 'Volume: ',
  'زمان: ': 'Duration: ',
  'تعداد دستگاه: ': 'Devices: ',
  'نامحدود': 'Unlimited',
  'گیگابایت': 'GB',
  'گیگ': 'GB',
  ' روزه': ' days',
  ' روز': ' days',
  'روز': ' days',
  'تومان': 'Toman',
  'خرید (کارت به کارت)': 'Buy (card-to-card)',

  // ---- auth pages ----
  'نام کاربری': 'Username',
  'رمز عبور': 'Password',
  'ثبت‌نام': 'Sign up',
  'قبلاً عضو هستید؟ ': 'Already a member? ',
  'عضو نیستید؟ ': 'Not a member? ',
  'نام کاربری یا رمز عبور کوتاه است': 'Username or password too short',
  'این نام کاربری قبلاً ثبت شده است': 'This username is already taken',
  'نام کاربری یا رمز عبور اشتباه است': 'Wrong username or password',

  // ---- buy flow ----
  'خرید: ': 'Buy: ',
  'قیمت: ': 'Price: ',
  'مرحله ': 'Step ',
  ' — واریز کارت به کارت': ' — Card-to-card transfer',
  ' — ارسال فیش واریزی': ' — Upload the payment receipt',
  'مبلغ ': 'Transfer ',
  ' را به کارت زیر واریز کنید:': ' to the card below:',
  'مبلغ فاکتور را به کارت زیر واریز کنید:': 'Transfer the invoice amount to the card below:',
  'به نام: ': 'In the name of: ',
  'شماره کارت توسط مدیر تنظیم نشده است. با پشتیبانی تماس بگیرید.':
    'The shop card number has not been set by the admin yet. Contact support.',
  'تصویر فیش واریزی (jpg / png / webp — حداکثر ۸ مگابایت)': 'Payment receipt image (jpg / png / webp — max 8 MB)',
  'نام کاربری دلخواه برای کانفیگ (اختیاری — مثلاً ': 'Desired config username (optional — e.g. ',
  ' یا ': ' or ',
  'اگر خالی بگذارید، خودکار ساخته می‌شود': 'Leave empty for auto-generation',
  'توضیح (اختیاری — مثلاً ': 'Note (optional — e.g. ',
  '۴ رقم آخر کارت واریزکننده)': 'last 4 digits of your card)',
  'ثبت سفارش و ارسال فیش': 'Submit order & upload receipt',
  'در حال ارسال فیش…': 'Uploading receipt…',
  'فرم نامعتبر است': 'Invalid form',
  'فقط تصویر jpg/png/webp پذیرفته می‌شود': 'Only jpg/png/webp images are accepted',
  'حجم فایل بیش از ۸ مگابایت است': 'File exceeds 8 MB',
  'تصویر فیش الزامی است': 'Receipt image is required',
  'شما قبلاً درخواستی برای این بسته ثبت کرده‌اید و در انتظار تأیید مدیر است.':
    'You already have a pending request for this plan.',
  'شما قبلاً درخواست مقدار دلخواه ثبت کرده‌اید و در انتظار تأیید مدیر است.':
    'You already have a pending custom-volume request.',
  'سفارش ثبت شد. پس از تأیید مدیر، کانفیگ‌ها تحویل داده می‌شود.':
    'Order placed. Configs will be delivered after the admin approves.',
  'سفارش ': 'Order ',
  ' گیگ ثبت شد (فاکتور ': ' GB placed (invoice ',
  ' تومان). پس از تأیید مدیر، کانفیگ تحویل می‌شود.': ' Toman). The config will be delivered after the admin approves.',

  // ---- custom-volume page ----
  'خرید به مقدار دلخواه': 'Custom-volume purchase',
  'این روش فروش هنوز توسط مدیر فعال نشده است — قیمت هر گیگ ترافیک در «پنل مدیریت ← تنظیمات فروشگاه» تعیین می‌شود.':
    'This selling method is not activated yet — the price per GB is set under “Admin panel ← Shop settings”.',
  'تا آن زمان می‌توانید از ': 'Meanwhile you can use our ',
  'بسته‌های آماده': 'ready-made plans',
  ' استفاده کنید.': ' until then.',
  ' — مقدار ترافیک و مدت': ' — Traffic volume & duration',
  'حجم ترافیک (گیگابایت — عدد صحیح)': 'Traffic volume (GB — whole number)',
  'مدت (روز — خالی = ۳۰ روز)': 'Duration (days — empty = 30 days)',
  'حجم را وارد کنید…': 'Enter a volume…',

  // ---- orders ----
  'سفارش‌های من': 'My orders',
  'سفارش #': 'Order #',
  'کانفیگ دلخواه (': 'Custom config (',
  'در انتظار تأیید مدیر': 'Awaiting approval',
  'در انتظار تأیید': 'Awaiting approval',
  'در انتظار پرداخت': 'Awaiting payment',
  'تأیید شد': 'Approved',
  'رد شد': 'Rejected',
  'در حال ساخت': 'Provisioning',
  'تحویل شده': 'Delivered',
  'خطا در ساخت': 'Provisioning failed',
  'خطا': 'Error',
  'ثبت: ': 'Placed: ',
  '| بررسی: ': '| Reviewed: ',
  'فاکتور: ': 'Invoice: ',
  'فاکتور ': 'Invoice ',
  'دلیل رد: ': 'Rejection reason: ',
  'تحویل سفارش': 'Order delivery',
  'نام اکانت کانفیگ (ایمیل): ': 'Config account name (email): ',
  'لینک اشتراک (برای اپ‌های V2rayNG / Streisand / ...)': 'Subscription link (for V2rayNG / Streisand / ... apps)',
  '📋 کپی': '📋 Copy',
  'لینک کانفیگ‌ها': 'Config links',
  '📋 کپی همه لینک‌ها (اشتراک + کانفیگ)': '📋 Copy all links (subscription + configs)',
  'سفارشی ثبت نشده است.': 'No orders yet.',
  'سفارش‌ها و کانفیگ‌ها': 'Orders & configs',
  '✓ کپی شد': '✓ Copied',

  // ---- user panel / dashboard ----
  'داشبورد مصرف': 'Usage dashboard',
  'داشبورد': 'Dashboard',
  'وضعیت کلی کانفیگ‌ها، حجم و مصرف شما': 'Overview of your configs, volume and usage',
  'ساعتی': 'Hourly',
  'روزانه': 'Daily',
  'ماهانه': 'Monthly',
  '🔄 بروزرسانی زنده': '🔄 Live refresh',
  'در حال دریافت…': 'Fetching…',
  'کانفیگ‌های خریداری‌شده': 'Purchased configs',
  'کل مصرف (دانلود + آپلود)': 'Total usage (download + upload)',
  'کل حجم خریداری‌شده': 'Total purchased volume',
  'حجم باقی‌مانده': 'Remaining volume',
  '📈 نمودار مصرف': '📈 Usage chart',
  '۲۴ ساعت گذشته': 'Last 24 hours',
  '۳۰ روز گذشته': 'Last 30 days',
  '۱۲ ماه گذشته': 'Last 12 months',
  '🔌 کانفیگ‌های شما': '🔌 Your configs',
  '+ خرید بسته جدید': '+ Buy a new plan',
  'خرید بسته جدید': 'Buy a new plan',
  'پنل‌های سنایی متصل': 'Connected Sanayi panels',
  'پنل‌های سنایی متصل: ': 'Connected Sanayi panels: ',
  ' سفارش در انتظار تأیید مدیر است — ': ' order(s) awaiting admin approval — ',
  'مشاهده و پیگیری': 'View & track',
  'هنوز کانفیگی تحویل نشده است. اولین بسته را بخرید تا کانفیگ شما اینجا همراه با نمودار مصرف نمایش داده شود.':
    'No configs delivered yet. Buy your first plan and your config will appear here with the usage chart.',
  'هنوز کانفیگی تحویل نشده است.': 'No configs delivered yet.',
  'مشاهده بسته‌ها و خرید': 'View plans & buy',
  '⛔ منقضی شده': '⛔ Expired',
  '⛔ غیرفعال': '⛔ Disabled',
  '⚠ نزدیک اتمام': '⚠ Almost exhausted',
  '● فعال': '● Active',
  'مصرف: ': 'Usage: ',
  ' از ': ' of ',
  'باقی‌مانده: ': 'Remaining: ',
  'انقضا: ': 'Expires: ',
  'بدون انقضا': 'No expiry',
  'هنوز داده‌ای ثبت نشده — چند دقیقه پس از استفاده از کانفیگ، نمودار ظاهر می‌شود.':
    'No data recorded yet — the chart appears a few minutes after using your config.',
  'مجموع این بازه: ': 'Total for this period: ',
  'آخرین بروزرسانی: ': 'Last updated: ',
  'متر مصرف فعال است': 'Usage meter is active',

  // ---- account ----
  'پروفایل': 'Profile',
  'اطلاعات حساب و تغییر رمز ورود': 'Account info & password change',
  'نقش: ': 'Role: ',
  'مدیر فروشگاه': 'Shop admin',
  'مشتری': 'Customer',
  ' · عضو از ': ' · member since ',
  'رمز فعلی': 'Current password',
  'رمز جدید (حداقل ۶ کاراکتر)': 'New password (min 6 characters)',
  'تکرار رمز جدید': 'Repeat new password',
  '🔑 ذخیره رمز جدید': '🔑 Save new password',
  'رمز ورود با موفقیت تغییر کرد': 'Password changed successfully',
  'رمز فعلی اشتباه است': 'Current password is incorrect',
  'رمز جدید باید حداقل ۶ کاراکتر باشد': 'New password must be at least 6 characters',
  'تکرار رمز جدید مطابقت ندارد': 'Passwords do not match',

  // ---- admin ----
  'سفارش در انتظار تأیید': 'orders awaiting approval',
  'کل سفارش‌ها': 'Total orders',
  'کاربران': 'Users',
  'مشاهده': 'View',
  'مدیریت': 'Manage',
  'مدیریت پلن‌ها': 'Manage plans',
  'تنظیمات فروشگاه (شماره کارت و...)': 'Shop settings (card & more)',
  'پنل‌های سنایی': 'Sanayi panels',
  'سفارش‌ها': 'Orders',
  'همه': 'All',
  'تحویل‌شده': 'Delivered',
  'ردشده': 'Rejected',
  'نام کاربری دلخواه کانفیگ: ': 'Desired config username: ',
  '🧮 سفارش مقدار دلخواه: ': '🧮 Custom-volume order: ',
  ' یک‌ماهه': ' 1-month',
  'قیمت هر گیگ: ': 'price per GB: ',
  '(قیمت هر گیگ: ': '(price per GB: ',
  'توضیح مشتری: ': 'Customer note: ',
  'فیشی بارگذاری نشده': 'No receipt uploaded',
  'لینک تحویل‌شده:': 'Delivered link:',
  'پنل سنایی': 'Sanayi panel',
  'Inboundها (با ویرگول جدا کنید؛ خالی = پیش‌فرض پنل/پلن)': 'Inbounds (comma-separated; empty = panel/plan default)',
  'مثلاً 1,2,3 — چند اینباند مجاز است': 'e.g. 1,2,3 — multiple inbounds allowed',
  '✨ همه Inboundهای این پنل را انتخاب کن': '✨ Select all inbounds of this panel',
  '✓ تأیید و تحویل خودکار': '✓ Approve & auto-deliver',
  'دلیل رد (به مشتری نمایش داده می‌شود)': 'Rejection reason (shown to the customer)',
  '✗ رد سفارش': '✗ Reject order',
  'سفارشی نیست.': 'No orders.',
  'نام': 'Name',
  'آدرس پنل (Base URL — از طریق تونل: http://127.0.0.1:PORT)': 'Panel address (Base URL — via tunnel: http://127.0.0.1:PORT)',
  'آدرس پنل (از طریق تونل: http://127.0.0.1:PORT)': 'Panel address (via tunnel: http://127.0.0.1:PORT)',
  'API Token (پنل سنایی → تنظیمات → API Tokens)': 'API Token (Sanayi panel → Settings → API Tokens)',
  'توکن — برای v3 الزامی است': 'Token — required for v3',
  'Inbound پیش‌فرض': 'Default inbound',
  'آدرس عمومی لینک اشتراک (sub) — برای مشتری‌ها': 'Public subscription (sub) link — for customers',
  'مثل https://Domain:2096/amirr/ (با همان مسیر پیکربندی‌شده در پنل)': 'e.g. https://Domain:2096/amirr/ (with the same path configured in the panel)',
  'مثل https://Domain:2096/amirr/ (خالی = آدرس پنل)': 'e.g. https://Domain:2096/amirr/ (empty = panel address)',
  '(خالی = آدرس پنل)': '(empty = panel address)',
  'ذخیره': 'Save',
  'تست اتصال': 'Test connection',
  'حذف': 'Delete',
  'آخرین تست (': 'Last test (',
  '): ': '): ',
  'اتصال پنل سنایی جدید': 'Connect a new Sanayi panel',
  'مثلاً سرور خارج': 'e.g. foreign server',
  'مثلاً ۲': 'e.g. 2',
  'مثلاً ': 'e.g. ',
  'افزودن پنل': 'Add panel',
  'نکته ۱: ': 'Note 1: ',
  'نکته ۲: ': 'Note 2: ',
  'نکته ۳: ': 'Note 3: ',
  'اتصال با API Token انجام می‌شود — نام کاربری و رمز مدیر پنل دیگر لازم نیست. ':
    'Connection uses the API Token — the panel admin username/password are no longer needed. ',
  'اگر پنل سنایی فقط از طریق تونل در دسترس است، آدرس را به شکل ': 'If the Sanayi panel is only reachable via a tunnel, enter the address as ',
  'وارد کنید. نکته ۳: در آدرس sub، مسیر پیکربندی‌شده در پنل (مثل ': 'Note 3: In the sub address, include the path configured in the panel (e.g. ',
  ') را هم بنویسید.': ').',
  'پلن‌ها': 'Plans',
  'تنظیمات': 'Settings',
  'خرید ': 'Buy ',
  'حجم (GB)': 'Volume (GB)',
  'زمان (روز)': 'Duration (days)',
  'حجم (GB — خالی=نامحدود)': 'Volume (GB — empty=unlimited)',
  'زمان (روز — خالی=نامحدود)': 'Duration (days — empty=unlimited)',
  'قیمت (تومان)': 'Price (Toman)',
  'دستگاه': 'Devices',
  'Inbound پیش‌فرض (خالی=پنل)': 'Default inbound (empty=panel)',
  'فعال': 'Active',
  'بله': 'Yes',
  'خیر': 'No',
  'پلن جدید': 'New plan',
  'افزودن': 'Add',
  'تنظیمات فروشگاه': 'Shop settings',
  'شماره کارت برای واریز کارت به کارت': 'Card number for card-to-card transfers',
  'به نامِ صاحب کارت': 'Card holder name',
  'پیام در صفحه خرید (اختیاری)': 'Message on the purchase page (optional)',
  '🧮 فروش به مقدار دلخواه (قیمت هر گیگ) — ': '🧮 Custom-volume selling (price per GB) — ',
  '✅ فعال': '✅ Active',
  '⛔ خاموش': '⛔ Off',
  'به‌جای (یا در کنار) بسته‌های ثابت، به مشتری اجازه دهید هر مقدار ترافیک دلخواه را سفارش دهد. قیمت هر گیگ ترافیک ماهانه را اینجا تعیین کنید؛ مثلاً ':
    'Instead of (or alongside) fixed plans, let customers order any traffic volume they want. Set the monthly price per GB here; e.g. ',
  ' یعنی سفارش ۲۰ گیگ = فاکتور ۱۰۰٫۰۰۰ تومان. ': ' means ordering 20 GB = a 100,000 Toman invoice. ',
  '۰ یا خالی = این روش فروش خاموش است': '0 or empty turns this selling method off',
  ' و صفحه «خرید به مقدار دلخواه» مخفی می‌شود.': ' and the “Custom-volume purchase” page is hidden.',
  'قیمت هر گیگ ترافیک ماهانه (تومان — ۰ = خاموش)': 'Monthly price per GB (Toman — 0 = off)',
  'انتخاب مدت توسط مشتری': 'Customer chooses duration',
  'خیر — همیشه یک‌ماهه (۳۰ روز)': 'No — always 1 month (30 days)',
  'بله — مشتری مدت (روز) را هم وارد می‌کند (قیمت = حجم × هر گیگ × روز/۳۰)':
    'Yes — customer also enters a duration in days (price = volume × per-GB × days/30)',
  'ذخیره تنظیمات مقدار دلخواه': 'Save custom-volume settings',
  'شماره کارت و تنظیمات فروشگاه ذخیره شد.': 'Card number and shop settings saved.',
  'فروش به مقدار دلخواه فعال شد (هر گیگ: ': 'Custom-volume selling enabled (per GB: ',
  'فروش به مقدار دلخواه خاموش شد': 'Custom-volume selling disabled',
  'پنل انتخاب نشده است': 'No panel selected',
  'Inbound مشخص نشده است (در فرم بنویسید، مثلاً 1,2,3)': 'No inbound specified (enter it in the form, e.g. 1,2,3)',
  'خطا در ساخت: ': 'Provisioning error: ',
  'خطا در اتصال به پنل: ': 'Error connecting to the panel: ',
  'تأیید و تحویل شد': 'approved & delivered',
  'پنل یافت نشد': 'Panel not found',
  'دسترسی': 'Access',
  'فقط مدیر. اگر مدیر هستید، با حساب ادمین ': 'Admins only. If you are an admin, ',
  'وارد شوید': 'log in',

  // ---- misc / errors ----
  'صفحه یافت نشد.': 'Page not found.',
  'پلن یافت نشد.': 'Plan not found.',
  'یافت نشد': 'Not found',
  'فیش': 'receipt',

  // ---- client JS strings ----
  'بستن': 'Close',
  '🛎 سفارش جدید #': '🛎 New order #',
  'کانفیگ دلخواه ': 'Custom config ',
  'بررسی و تحویل': 'Review & deliver',
  '🛎 سفارش جدید — ': '🛎 New order — ',
  'در حال خواندن پنل…': 'Reading panel…',
  '✓ هر ': '✓ ',
  ' اینباند انتخاب شد': ' inbounds selected',
  'خطا: ': 'Error: ',
  'inboundای یافت نشد': 'no inbounds found',
  'خطا در اتصال به پنل': 'Error connecting to the panel',
};

// Build a single alternation regex once (longest keys first, ZWNJ-insensitive).
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const NORM = (s) => String(s).replace(/\u200c/g, '');
const KEYS = Object.keys(I18N_EN).sort((a, b) => b.length - a.length);
const RE = new RegExp(KEYS.map((k) => escapeRe(NORM(k))).join('|'), 'g');
// Lookup map keyed by the NORMALIZED form (regex matches normalized HTML).
const EN_MAP = new Map(KEYS.map((k) => [NORM(k), I18N_EN[k]]));

// Translate a fully rendered page to English. Dictionary first (so keys with
// Persian digits still match), then Persian digits/punctuation → Latin, then
// SQLite "YYYY-MM-DD HH:MM:SS" timestamps → a readable English date.
function enify(html) {
  html = NORM(html);
  html = html.replace(RE, (m) => EN_MAP.get(NORM(m)) ?? m);
  html = html.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  html = html.replace(/٬/g, ',').replace(/٫/g, '.');
  html = html.replace(/،/g, ', ').replace(/؛/g, '; ').replace(/؟/g, '?');
  html = html.replace(/\b(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?\b/g,
    (m, y, mo, d, h, mi) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const date = `${months[Number(mo) - 1]} ${Number(d)}, ${y}`;
      return h ? `${date} ${h}:${mi}` : date;
    });
  return html;
}

module.exports = { I18N_EN, enify };