import "@fontsource-variable/vazirmatn";
import "./style.css";
import "./creator.css";
import "./nil.css";
import "./app-shell.css";
import { icon } from "./icons";
import { setTheme, themeChoice, type ThemeChoice } from "./theme";
import { serviceData, serviceMeasurements, subscriptionURL, ServiceError } from "./service";
import {
  isDesktop,
  repositoryDataURL,
  writeNativeClipboard,
  saveNativeExport,
  openNativeGitHubLink,
} from "./desktop";

type Protocol = "vless" | "vmess" | "trojan" | "ss" | "hysteria2" | "tuic";
type View = "dashboard" | "configs" | "saved" | "sources" | "history";
type Source = { id: string; name: string; url: string };
type Config = {
  id: string;
  uri: string;
  protocol: Protocol;
  name: string;
  host: string;
  port: number;
  firstSeenAt: string;
  sources: Source[];
};
type SourceReport = Source & {
  status: string;
  candidates: number;
  valid: number;
  invalid: number;
  added: number;
  error: string | null;
};
type Status = {
  schemaVersion: number;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessfulAt: string | null;
  added: number;
  target: number;
  totalUnique: number;
  duplicateCount: number;
  invalidCount: number;
  snapshotLimit: number;
  sources: SourceReport[];
  errors: string[];
};
type Snapshot = {
  schemaVersion: number;
  generatedAt: string | null;
  totalUnique: number;
  configs: Config[];
};
const repository = "https://github.com/babakyaghoobii/Nil-configs-catcher";
const usesRepositoryData = isDesktop || import.meta.env.MODE === "hosted";
const repositoryCacheKey = isDesktop
  ? "nil-desktop-data-v1"
  : "nil-web-data-v1";
const brandLogo = `${import.meta.env.BASE_URL}branding/nil-04-blue-peach.svg`;
const appIcon = `${import.meta.env.BASE_URL}branding/nil-04-blue-peach.svg`;
const protocols: Protocol[] = [
  "vless",
  "vmess",
  "trojan",
  "ss",
  "hysteria2",
  "tuic",
];
const protocolLabels: Record<Protocol, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  ss: "Shadowsocks",
  hysteria2: "Hysteria2",
  tuic: "TUIC",
};
const app = document.querySelector<HTMLDivElement>("#app")!;
if (isDesktop) document.documentElement.dataset.runtime = "desktop";
const number = (n: number) => n.toLocaleString("fa-IR");
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const date = (value: string | null, short = false) =>
  value && !Number.isNaN(Date.parse(value))
    ? new Intl.DateTimeFormat("fa-IR", {
        month: "short",
        day: "numeric",
        ...(short ? {} : { hour: "2-digit", minute: "2-digit" }),
      }).format(new Date(value))
    : "هنوز اجرا نشده";
function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password
      ? escape(url.href)
      : repository;
  } catch {
    return repository;
  }
}
function loadSaved(): Set<string> {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem("nil-saved") || "[]",
    );
    return new Set(
      Array.isArray(value)
        ? value
            .filter(
              (v): v is string =>
                typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
            )
            .slice(0, 1000)
        : [],
    );
  } catch {
    return new Set();
  }
}
const state = {
  view: "dashboard" as View,
  protocol: "all",
  query: "",
  sort: "newest",
  saved: loadSaved(),
  loading: true,
  error: "",
  offlineCache: false,
  snapshot: null as Snapshot | null,
  status: null as Status | null,
  history: [] as Status[],
  refreshing: false,
  collecting: false,
  collectionSettings: false,
  perProtocol: 10,
  pickedProtocols: new Set<Protocol>(protocols),
};
let toastTimer: ReturnType<typeof setTimeout>;
let refreshController: AbortController | null = null;

const navItems: { view: View; label: string; icon: string }[] = [
  { view: "dashboard", label: "خانه", icon: "grid" },
  { view: "configs", label: "کانفیگ‌ها", icon: "layers" },
  { view: "saved", label: "نشان‌شده‌ها", icon: "bookmark" },
  { view: "sources", label: "منابع دریافت", icon: "layers" },
  { view: "history", label: "تاریخچهٔ دریافت", icon: "clock" },
];

function shell() {
  app.innerHTML = `
    <aside class="sidebar" aria-label="ناوبری اصلی">
      <a class="brand" href="#" data-view="dashboard" aria-label="نیل، داشبورد"><img class="brand-image" src="${brandLogo}" alt="لوگوی NIL، ساختهٔ babakyaghoobii" width="196" height="112"/><span class="brand-caption" dir="ltr">NIL CONFIG CATCHER</span></a>
      <div class="workspace-label">NIL CONFIG CATCHER</div>
      <nav class="desktop-nav">${navItems.map((item) => `<button data-view="${item.view}" class="nav-item">${icon(item.icon)}<span>${item.label}</span>${item.view === "dashboard" ? '<span class="nav-dot"></span>' : ""}</button>`).join("")}</nav>
      
    </aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumb"><img class="mobile-brand" src="${appIcon}" alt="" width="32" height="32"/>NIL <span>/</span> <strong id="breadcrumb-name">خانه</strong></div><div class="topbar-actions"><div class="theme-switch" role="group" aria-label="رنگ برنامه">${(
      [
        ["dark", "تیره", "moon"],
        ["light", "روشن", "sun"],
        ["auto", "خودکار", "monitor"],
      ] as const
    )
      .map(
        ([choice, label, image]) =>
          `<button type="button" data-theme-choice="${choice}" data-action="theme" aria-label="پوستهٔ ${label}" aria-pressed="${themeChoice() === choice}" title="${label}">${icon(image)}<span>${label}</span></button>`,
      )
      .join(
        "",
      )}</div><span class="local-time">${icon("clock")} <span>${date(new Date().toISOString(), true)}</span></span><a class="icon-button github-link" href="${repository}" aria-label="ریپازیتوری گیت‌هاب" target="_blank" rel="noopener noreferrer">${icon("github")}</a><img class="avatar" src="${appIcon}" alt="لوگوی نیل" width="32" height="32"/></div></header>
    <main id="main" tabindex="-1"></main><footer class="page-footer" dir="ltr"><span>Owned by <b>NIL Group</b></span><span>Created by <b>B. YAGHOOBI</b></span></footer></div>
    <nav class="mobile-nav" aria-label="ناوبری موبایل">${navItems.map((item) => `<button data-view="${item.view}" aria-label="${item.label}">${icon(item.icon)}<span>${item.label.replace(" دریافت", "")}</span></button>`).join("")}</nav>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <dialog id="subscription-dialog" aria-labelledby="subscription-title"><button class="icon-button dialog-close" data-action="close-subscription" aria-label="بستن">${icon("close")}</button><h2 id="subscription-title">مجموعهٔ نیل، در یک لینک</h2><p>کانفیگ‌های هم‌پروتکل یا هم‌منبع را یک‌جا اضافه کن. این اشتراک با هر دریافت جدید، به‌روز می‌شود.</p><div class="subscription-options"><label>نام مجموعه <input id="subscription-name" maxlength="80" value="NIL — مجموعهٔ نیل" /></label><label>پروتکل <select id="subscription-protocol"><option value="all">همهٔ پروتکل‌ها</option>${protocols.map((protocol) => `<option value="${protocol}">${protocolLabels[protocol]}</option>`).join("")}</select></label><label>منبع <select id="subscription-source"><option value="all">همهٔ منابع</option></select></label><label>جستجو <input id="subscription-search" maxlength="200" placeholder="نام یا سرور؛ اختیاری" /></label><label>قالب <select id="subscription-format"><option value="base64">Base64 — مناسب کلاینت‌های اشتراک</option><option value="plain">فهرست متنی URI</option></select></label></div><label for="subscription-link">لینک اشتراک</label><input id="subscription-link" class="subscription-link" dir="ltr" readonly /><p class="muted">این لینک شامل کانفیگ‌های عمومی است؛ کانفیگ شخصی به سرور فرستاده نمی‌شود.</p><div class="dialog-actions"><button class="button primary" data-action="copy-subscription">${icon("copy")} کپی لینک اشتراک</button><button class="button secondary" data-action="close-subscription">بستن</button></div></dialog>
    <dialog id="install-dialog" aria-labelledby="install-title"><button class="icon-button dialog-close" data-action="close-install" aria-label="بستن">${icon("close")}</button><img class="brand-image install-brand-image" src="${brandLogo}" alt="لوگوی NIL" width="220" height="140"/><h2 id="install-title">نیل، همیشه دم دست</h2><p>در Safari روی دکمهٔ اشتراک‌گذاری بزنید، سپس <b dir="ltr">Add to Home Screen</b> را انتخاب کنید.</p><p class="muted">در مرورگرهای دیگر، از گزینهٔ نصب برنامه در منوی مرورگر استفاده کنید. بعد از اولین بازدید، رابط و آخرین دادهٔ ذخیره‌شده آفلاین در دسترس‌اند.</p><button class="button primary" data-action="close-install">متوجه شدم ${icon("check")}</button></dialog>
  `;
  render();
}

function isStale(): boolean {
  const value = state.status?.lastSuccessfulAt;
  return Boolean(
    value && Date.now() - Date.parse(value) > 4.5 * 60 * 60 * 1000,
  );
}
function statusLabel(status = state.status): string {
  return (
    {
      success: "دریافت موفق",
      partial: "دریافت ناقص",
      failed: "دریافت ناموفق",
      never: "در انتظار اولین دریافت",
    }[status?.state || "never"] || "وضعیت نامشخص"
  );
}

function creatorCredit(): string {
  return `<section class="creator-credit" aria-labelledby="creator-title">
    <img class="creator-logo" src="${brandLogo}" alt="لوگوی رسمی NIL متعلق به babakyaghoobii" width="220" height="142"/>
    <div class="creator-copy"><span class="creator-label">سازندهٔ این برنامه</span>
      <h2 id="creator-title">ایده‌پردازی، برنامه‌نویسی و ساخت توسط <bdi>babakyaghoobii</bdi></h2>
      <p class="creator-free">این برنامه برای استفادهٔ عموم، به‌رایگان در دسترس است.</p>
    </div>
    <p class="creator-english" lang="en" dir="ltr">Conceived, coded, and built by <strong>babakyaghoobii</strong>. Free for everyone to use.</p>
  </section>`;
}

function render() {
  const item = navItems.find((item) => item.view === state.view)!;
  document.querySelector("#breadcrumb-name")!.textContent = item.label;
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((element) => {
    const active = element.dataset.view === state.view;
    element.classList.toggle("active", active);
    if (active) element.setAttribute("aria-current", "page");
    else element.removeAttribute("aria-current");
  });
  document.title = `${item.label} — NIL Config Catcher`;
  const main = document.querySelector("#main")!;
  main.innerHTML = `
    <section class="page-heading"><div><h1>${state.view === "dashboard" ? "NIL Config Catcher" : item.label}</h1></div><button class="button secondary install-button" data-action="install">${icon("download")} نصب اپلیکیشن ${icon("external")}</button></section>
    ${state.error ? `<div class="notice error" role="alert">${icon("info")}<span>${escape(state.error)}</span><button data-action="refresh" class="text-button">تلاش دوباره</button></div>` : ""}
    ${state.status?.errors.length ? `<div class="notice error" role="alert">${icon("info")}<span>خطای تنظیمات جمع‌آوری: <b dir="auto">${escape(state.status.errors.join(" · "))}</b></span></div>` : ""}
    ${!navigator.onLine || state.offlineCache ? `<div class="notice warning">${icon("wifi")} حالت آفلاین؛ آخرین نسخهٔ ذخیره‌شده نمایش داده می‌شود.</div>` : ""}
    ${isStale() ? `<div class="notice warning">${icon("clock")} بیش از ۴٫۵ ساعت از آخرین دریافت گذشته است. زمان‌بندی گیت‌هاب ممکن است با تأخیر اجرا شود.</div>` : ""}
    ${state.view === "dashboard" ? dashboard() : state.view === "configs" ? configsHub() : state.view === "saved" ? catalog() : state.view === "sources" ? sourcesView() : historyView()}
  `;
  if (state.view === "dashboard" || state.view === "saved") renderResults();
}

function dashboard() {
  return `<section class="nil-command" aria-labelledby="nil-command-title">
      <div class="nil-command-logo"><img src="${brandLogo}" alt="آیکون رسمی NIL شماره 04" width="76" height="76" /></div>
      <button class="nil-collect-orb" type="button" data-action="open-settings" aria-label="تنظیمات و شروع جمع‌آوری">
        <span class="nil-orb-icon">${icon("rocket")}</span>
        <strong id="nil-command-title">جمع‌آوری هوشمند<br />کانفیگ‌ها</strong>
      </button>
      <p class="nil-command-summary">${state.loading ? "در حال بارگذاری…" : number(state.snapshot?.configs.length || 0) + " کانفیگ در فهرست"} <span>·</span> ${statusLabel()}</p>
      <div class="nil-command-buttons">
        <button class="button primary" data-action="open-settings">${icon("layers")} تنظیمات جمع‌آوری</button>
        <button class="button secondary" data-action="subscription">${icon("link")} لینک اشتراک</button>
      </div>
    </section>
    ${state.collectionSettings ? collectionSettings() : ""}
    ${catalog()}`;
}

function collectionSettings() {
  return `<section class="nil-collection-settings" aria-label="تنظیمات جمع‌آوری">
    <div class="nil-panel-head"><h2>تنظیمات جمع‌آوری</h2><button class="icon-button" data-action="close-settings" aria-label="بستن">${icon("close")}</button></div>
    <h3>انتخاب پروتکل‌ها</h3>
    <div class="nil-protocol-picks">${protocols.map((p) => `<button type="button" data-action="pick-protocol" data-value="${p}" class="${state.pickedProtocols.has(p) ? "active" : ""}" aria-pressed="${state.pickedProtocols.has(p)}"><span dir="ltr">${protocolLabels[p]}</span> ${state.pickedProtocols.has(p) ? icon("check") : icon("plus")}</button>`).join("")}</div>
    <h3>تعداد کانفیگ از هر پروتکل</h3>
    <p>تعداد کانفیگ‌های جدیدتر برای نمایش و خروجی</p>
    <div class="nil-amounts" role="group" aria-label="تعداد کانفیگ">${[5,10,20,50,100].map((n) => `<button data-action="set-amount" data-value="${n}" class="${state.perProtocol === n ? "active" : ""}" aria-pressed="${state.perProtocol === n}">${number(n)}</button>`).join("")}</div>
    <button class="button primary nil-start" data-action="start-collection">${icon("rocket")} ${state.collecting ? "در حال جمع‌آوری…" : "شروع جمع‌آوری"}</button>
    <p class="nil-hint">منابع عمومی بررسی می‌شوند؛ نتیجه برای هر پروتکل به تعداد انتخابی محدود می‌شود. سلامت اتصال فقط در صورت انجام آزمون واقعی گزارش می‌شود.</p>
  </section>`;
}


// Independent NIL Proxy configuration workspace. Latency results are sourced
// from the collector's measured report, not generated by the UI.
let selectedProxyId: string | null = null;
function configsHub() {
  const configs = filteredConfigs();
  const measuredAt = probeReport?.measuredAt;
  return `<section class="nil-proxy-hub">
    <header class="nil-hub-header">
      <div><span class="nil-hub-kicker">NIL PROXY / SMART CONFIG HUB</span><h2>مدیریت کانفیگ‌ها <span class="count-badge">${number(configs.length)}</span></h2><p>جمع‌آوری‌شده · نام‌گذاری‌شده · آماده بررسی</p></div>
      <button class="button secondary" data-action="reload-ping">${icon("refresh")} به‌روزرسانی نتایج تست</button>
    </header>
    <div class="nil-hub-tools"><div class="search-field">${icon("search")}<input id="hub-search" type="search" maxlength="200" placeholder="جست‌وجوی کانفیگ یا سرور…" value="${escape(state.query)}" /></div>
    <label class="sort-field">مرتب‌سازی <select id="hub-sort"><option value="latency" ${state.sort === "latency" ? "selected" : ""}>کمترین تأخیر</option><option value="newest" ${state.sort === "newest" ? "selected" : ""}>جدیدترین</option><option value="name" ${state.sort === "name" ? "selected" : ""}>نام</option></select></label></div>
    <div class="nil-hub-chips">${protocols.map((p) => `<span class="nil-hub-chip">${protocolLabels[p]} · ${number(configs.filter((c) => c.protocol === p).length)}</span>`).join("")}</div>
    <div class="nil-hub-measure-note" role="status">${measuredAt ? `آخرین گزارش اندازه‌گیری: ${date(measuredAt, true)} · نتایج تاریخی‌اند و Ping زنده نیستند.` : "هنوز هیچ گزارش اندازه‌گیری معتبر دریافت نشده است. نمایش عدد ساختگی ممنوع است."}</div>
    <div class="nil-hub-list">${configs.length ? configs.map((item) => {
      const m = probeReport?.measurements.get(item.id);
      const latency = m?.state === "reachable" ? `${number(m.latencyMs)} ms` : m?.state === "failed" ? "Timeout / Failed" : "تست‌نشده";
      const tone = m?.state === "reachable" ? (m.latencyMs < 500 ? "good" : "slow") : m?.state === "failed" ? "failed" : "unknown";
      return `<article class="nil-hub-node ${selectedProxyId === item.id ? "selected" : ""}">
        <button class="nil-hub-pick" data-action="select-proxy" data-id="${item.id}" aria-pressed="${selectedProxyId === item.id}" aria-label="انتخاب ${escape(item.name)}">
          <span class="nil-hub-protocol">${protocolLabels[item.protocol]}</span><span class="nil-hub-name"><strong dir="auto">${escape(item.name)}</strong><small dir="ltr">${escape(item.host)}:${item.port}</small></span>
        </button><span class="nil-hub-ping ${tone}">${latency}</span>
        <button class="nil-hub-retest" data-action="retest-proxy" data-id="${item.id}" aria-label="تست مجدد ${escape(item.name)}" title="تست بومی هنوز متصل نیست">${icon("refresh")}</button>
        <button class="nil-hub-pin" data-action="save" data-id="${item.id}" aria-label="نشان کردن">${icon("bookmark")}</button>
      </article>`;
    }).join("") : '<div class="empty-state">کانفیگی برای نمایش موجود نیست.</div>'}</div>
    <div class="nil-hub-connect"><div><strong>اتصال NIL Proxy</strong><small>${selectedProxyId ? escape(configs.find((c) => c.id === selectedProxyId)?.name || "کانفیگ انتخاب‌شده") : "یک کانفیگ انتخاب کن"}</small></div><button data-action="connect-proxy" class="button primary">${icon("bolt")} Connect</button></div>
  </section>`;
}

function catalog() {
  return `<section id="catalog" class="catalog"><div class="section-heading"><div><h2>${state.view === "saved" ? "کانفیگ‌های نشان‌شده" : "کانفیگ‌ها"} <span class="count-badge" id="result-total">۰</span></h2></div><div class="heading-actions"><button class="button secondary export-button" data-action="export">${icon("download")} دریافت فایل</button><button class="button primary" data-action="subscription">${icon("link")} لینک اشتراک</button></div></div><div class="filter-toolbar"><div class="search-field">${icon("search")}<input id="search" type="search" autocomplete="off" maxlength="200" placeholder="جستجوی نام، سرور یا منبع…" aria-label="جستجوی کانفیگ" value="${escape(state.query)}"/></div><label class="sort-field">${icon("layers")}<span class="sr-only">مرتب‌سازی</span><select id="sort" aria-label="مرتب‌سازی"><option value="newest" ${state.sort === "newest" ? "selected" : ""}>جدیدترین اول</option><option value="oldest" ${state.sort === "oldest" ? "selected" : ""}>قدیمی‌ترین اول</option><option value="name" ${state.sort === "name" ? "selected" : ""}>بر اساس نام</option><option value="latency" ${state.sort === "latency" ? "selected" : ""}>کمترین زمان پاسخ آزمون</option></select></label></div><div class="protocol-tabs" role="group" aria-label="فیلتر پروتکل"><button class="protocol-tab ${state.protocol === "all" ? "selected" : ""}" data-protocol="all" aria-pressed="${state.protocol === "all"}">همه پروتکل‌ها <span>${number(baseConfigs().length)}</span></button>${protocols.map((protocol) => `<button class="protocol-tab ${state.protocol === protocol ? "selected" : ""}" data-protocol="${protocol}" aria-pressed="${state.protocol === protocol}"><i class="protocol-dot ${protocol}"></i><b dir="ltr">${protocolLabels[protocol]}</b><span>${number(baseConfigs().filter((item) => item.protocol === protocol).length)}</span></button>`).join("")}</div><div class="list-meta"><span id="list-description" role="status" aria-live="polite"></span></div><div id="config-list" class="config-grid" aria-busy="${state.loading}"></div><div id="load-more"></div></section>`;
}
function baseConfigs() {
  return (state.snapshot?.configs || []).filter(
    (item) => state.view !== "saved" || state.saved.has(item.id),
  );
}
function filteredConfigs() {
  const query = state.query.toLocaleLowerCase();
  const ordered = baseConfigs()
    .filter(
      (item) =>
        (state.protocol === "all" || item.protocol === state.protocol) &&
        `${item.name} ${item.host} ${item.protocol} ${item.sources.map((source) => source.name).join(" ")}`
          .toLocaleLowerCase()
          .includes(query),
    )
    .sort((a, b) =>
      state.sort === "latency"
        ? (measuredLatency(a.id) - measuredLatency(b.id) || Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt))
        : state.sort === "name"
        ? a.name.localeCompare(b.name, "fa")
        : (Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt)) *
          (state.sort === "oldest" ? -1 : 1),
    );
  const counts = new Map<Protocol, number>();
  return ordered.filter((item) => {
    if (!state.pickedProtocols.has(item.protocol)) return false;
    const seen = counts.get(item.protocol) || 0;
    if (seen >= state.perProtocol) return false;
    counts.set(item.protocol, seen + 1);
    return true;
  });
}
let probeReport: Awaited<ReturnType<typeof serviceMeasurements>> = null;
function measuredLatency(id: string) {
  const result = probeReport?.measurements.get(id);
  return result?.state === "reachable" ? result.latencyMs : Infinity;
}
let visibleLimit = 24;
function renderResults() {
  const list = document.querySelector("#config-list");
  if (!list) return;
  document
    .querySelectorAll<HTMLButtonElement>("[data-protocol]")
    .forEach((button) => {
      const protocol = button.dataset.protocol!;
      const selected = state.protocol === protocol;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      const count = button.querySelector("span");
      if (count)
        count.textContent = number(
          baseConfigs().filter(
            (item) => protocol === "all" || item.protocol === protocol,
          ).length,
        );
    });
  const configs = filteredConfigs();
  document.querySelector("#result-total")!.textContent = number(configs.length);
  document.querySelector("#list-description")!.textContent = state.loading
    ? "در حال دریافت…"
    : `${number(configs.length)} کانفیگ ${state.protocol === "all" ? "در همهٔ پروتکل‌ها" : protocolLabels[state.protocol as Protocol]}`;
  list.innerHTML = state.loading
    ? Array.from(
        { length: 6 },
        () => '<div class="skeleton" aria-hidden="true"></div>',
      ).join("")
    : configs.length
      ? configs.slice(0, visibleLimit).map(configCard).join("")
      : `<div class="empty-state">${icon(state.view === "saved" ? "bookmark" : "search")}<h3>${state.query || state.protocol !== "all" ? "نتیجه‌ای پیدا نشد" : state.view === "saved" ? "انتخاب‌های تو از اینجا شروع می‌شود" : "منتظر اولین کانفیگ"}</h3><p>${state.view === "saved" && !state.query ? "روی نشانِ کنار هر کانفیگ بزن تا اینجا نگهش داری." : "فیلترها را تغییر بده یا بعد از اجرای جمع‌آوری دوباره سر بزن."}</p>${state.query || state.protocol !== "all" ? '<button class="button secondary" data-action="clear-filters">پاک کردن فیلترها</button>' : ""}</div>`;
  document.querySelector("#load-more")!.innerHTML =
    configs.length > visibleLimit
      ? `<button class="button secondary load-more-button" data-action="load-more">نمایش بیشتر (${number(configs.length - visibleLimit)} مورد) ${icon("arrow")}</button>`
      : "";
  const exportButton = document.querySelector<HTMLButtonElement>(
    '[data-action="export"]',
  );
  if (exportButton) exportButton.disabled = !configs.length;
}
function configCard(item: Config) {
  const saved = state.saved.has(item.id);
  const isNew = state.status?.startedAt === item.firstSeenAt;
  const measurement = probeReport?.measurements.get(item.id);
  const connection = measurement?.state === "reachable"
    ? `پاسخ HTTPS در ${number(measurement.latencyMs)} میلی‌ثانیه`
    : measurement?.state === "failed" ? "آزمون اتصال ناموفق" : "اتصال آزموده نشده";
  return `<article class="config-card"><div class="card-top"><div class="card-identity"><span class="protocol-symbol ${item.protocol}">${icon(item.protocol === "hysteria2" || item.protocol === "tuic" ? "bolt" : item.protocol === "trojan" ? "shield" : "globe")}</span><div><h3 dir="auto" title="${escape(item.name)}">${escape(item.name)}</h3><span class="server-address" dir="ltr">${escape(item.host)}<span>:${item.port}</span></span></div></div><button class="icon-button save-button ${saved ? "is-saved" : ""}" data-action="save" data-id="${item.id}" aria-label="${saved ? "حذف نشان" : "نشان کردن"}" aria-pressed="${saved}">${icon("bookmark")}</button></div><div class="card-tags"><span class="protocol-badge ${item.protocol}" dir="ltr">${protocolLabels[item.protocol]}</span><span class="syntax-badge">${connection}</span>${isNew ? '<span class="new-badge">جدید</span>' : ""}</div><div class="card-meta"><span class="source-name" title="${escape(item.sources.map((source) => source.name).join("، "))}">${icon("github")} <b dir="auto">${escape(item.sources[0]?.name || "GitHub")}</b></span><time datetime="${escape(item.firstSeenAt)}">${date(item.firstSeenAt, true)}</time></div><div class="card-actions"><button class="button copy-button" data-action="copy" data-id="${item.id}">${icon("copy")} کپی</button><button class="button share-button" data-action="share" data-id="${item.id}" aria-label="اشتراک‌گذاری ${escape(item.name)}">${icon("share")}</button></div></article>`;
}
function sourcesView() {
  const sources = state.status?.sources || [];
  return `<section class="panel"><div class="section-heading"><div><h2>شفاف، از منبع تا کانفیگ</h2><p>تنها فایل‌های عمومی روی raw.githubusercontent.com دریافت می‌شوند.</p></div><a class="button secondary" href="${repository}/edit/main/sources.json" target="_blank" rel="noopener noreferrer">ویرایش منابع ${icon("external")}</a></div><div class="source-list">${sources.length ? sources.map((source) => `<article class="source-card"><span class="source-logo">${icon("github")}</span><div class="source-details"><h3 dir="auto">${escape(source.name)}</h3><a href="${safeLink(source.url)}" target="_blank" rel="noopener noreferrer">مشاهدهٔ فایل منبع ${icon("external")}</a>${source.error ? `<p class="error-text" dir="auto">${escape(source.error)}</p>` : ""}</div><div class="source-numbers"><strong>${number(source.added)}<small>جدید</small></strong><span class="source-status ${source.status === "success" ? "success" : "failed"}">${source.status === "success" ? "دریافت موفق" : "دریافت ناموفق"}</span></div><div class="source-summary">${number(source.valid)} قالب معتبر <span>·</span> ${number(source.invalid)} ورودی نامعتبر</div></article>`).join("") : '<div class="empty-state"><h3>هنوز گزارشی از منابع نداریم</h3><p>منابع در sources.json تعریف می‌شوند؛ گزارش بعد از اولین اجرا ظاهر می‌شود.</p></div>'}</div><div class="notice neutral">${icon("shield")} آزمون اتصال برای بخشی از نودهای عمومی جداگانه انجام می‌شود. تغییر منابع از طریق ریپازیتوری انجام می‌شود.</div></section>`;
}
function historyView() {
  return `<section class="panel"><div class="section-heading"><div><h2>نبض جمع‌آوری</h2><p>۱۲۰ اجرای اخیر در این صفحه؛ تاریخچهٔ کامل در کامیت‌های گیت‌هاب.</p></div><a class="button secondary" href="${repository}/actions" target="_blank" rel="noopener noreferrer">GitHub Actions ${icon("external")}</a></div><div class="history-list">${state.history.length ? state.history.map((status) => `<article class="history-item"><span class="history-icon ${status.state}">${icon(status.state === "success" ? "check" : "info")}</span><div><h3>${statusLabel(status)}</h3><time datetime="${escape(status.startedAt)}">${date(status.startedAt)}</time></div><div class="history-stat"><strong>+${number(status.added)}</strong><span>کانفیگ جدید</span></div><div class="history-extra"><span>${number(status.duplicateCount)} تکراری</span><span>${number(status.invalidCount)} نامعتبر</span></div></article>`).join("") : '<div class="empty-state"><h3>اولین فصل هنوز نوشته نشده</h3><p>بعد از اجرای جمع‌آوری، گزارش واقعی اینجا ثبت می‌شود.</p></div>'}</div></section>`;
}

function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid snapshot");
  const data = value as Snapshot;
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.configs) ||
    data.configs.length > 1000
  )
    throw new Error("Invalid snapshot");
  for (const item of data.configs) {
    if (
      !item ||
      !/^[a-f0-9]{64}$/.test(item.id) ||
      !protocols.includes(item.protocol) ||
      typeof item.uri !== "string" ||
      item.uri.length > 16384 ||
      !/^(vless|vmess|trojan|ss|hysteria2|hy2|tuic):\/\//i.test(item.uri) ||
      typeof item.name !== "string" ||
      typeof item.host !== "string" ||
      !Number.isInteger(item.port) ||
      item.port < 1 ||
      item.port > 65535 ||
      Number.isNaN(Date.parse(item.firstSeenAt)) ||
      !Array.isArray(item.sources) ||
      item.sources.some(
        (source) =>
          !source ||
          typeof source.name !== "string" ||
          typeof source.url !== "string",
      )
    )
      throw new Error("Invalid record");
  }
  return data;
}
function validateStatus(value: unknown): Status {
  if (!value || typeof value !== "object") throw new Error("Invalid status");
  const status = value as Status;
  if (
    status.schemaVersion !== 1 ||
    !["never", "success", "partial", "failed"].includes(status.state) ||
    !Array.isArray(status.sources) ||
    !Array.isArray(status.errors) ||
    !Number.isInteger(status.totalUnique) ||
    !Number.isInteger(status.added)
  )
    throw new Error("Invalid status");
  return status;
}

function validateDataBatch(values: unknown) {
  if (!Array.isArray(values) || values.length !== 3)
    throw new Error("Invalid data batch");
  const snapshot = validateSnapshot(values[0]),
    status = validateStatus(values[1]);
  const rawHistory: unknown = values[2];
  if (!Array.isArray(rawHistory) || rawHistory.length > 120)
    throw new Error("Invalid history");
  const history = rawHistory.map(validateStatus);
  if (status.totalUnique !== snapshot.totalUnique)
    throw new Error("Snapshot deployment is in progress");
  return { snapshot, status, history };
}

async function fetchDataBatch(base: string, signal?: AbortSignal) {
  const responses = await Promise.all(
    ["configs", "status", "history"].map((name) =>
      fetch(`${base}${name}.json`, { cache: "no-store", signal }),
    ),
  );
  if (responses.some((response) => !response.ok))
    throw new Error("Data unavailable");
  return {
    ...validateDataBatch(
      await Promise.all(responses.map((response) => response.json())),
    ),
    offline: responses.some(
      (response) => response.headers.get("X-Nil-Cache") === "offline",
    ),
  };
}

async function repositoryOfflineData() {
  try {
    const cached = localStorage.getItem(repositoryCacheKey);
    if (cached)
      return { ...validateDataBatch(JSON.parse(cached)), offline: true };
  } catch {
    /* A corrupt or unavailable cache must not replace valid bundled data. */
  }
  return {
    ...(await fetchDataBatch(`${import.meta.env.BASE_URL}data/`)),
    offline: true,
  };
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  state.error = "";
  render();
  refreshController?.abort();
  refreshController = new AbortController();
  const controller = refreshController;
  const timeout = setTimeout(() => controller.abort(), 15000);
  const measurements = serviceMeasurements(controller.signal).then((report) => {
    if (!controller.signal.aborted) {
      probeReport = report;
      if (!state.refreshing) render();
    }
  });
  try {
    let data;
    try {
      data = {
        ...validateDataBatch(await serviceData(false, controller.signal)),
        offline: false,
      };
    } catch {
      try {
        data = await fetchDataBatch(
          usesRepositoryData
            ? repositoryDataURL
            : `${import.meta.env.BASE_URL}data/`,
          controller.signal,
        );
      } catch (error) {
        if (!usesRepositoryData || state.snapshot) throw error;
        data = await repositoryOfflineData();
      }
    }
    const { snapshot, status, history } = data;
    state.snapshot = snapshot;
    state.status = status;
    state.history = history;
    state.offlineCache = data.offline;
    if (usesRepositoryData && !data.offline) {
      try {
        localStorage.setItem(
          repositoryCacheKey,
          JSON.stringify([snapshot, status, history]),
        );
      } catch {
        /* Current data still works when the browser storage quota is exhausted. */
      }
    }
  } catch {
    state.error = state.snapshot
      ? "دریافت دادهٔ تازه ممکن نشد؛ آخرین دادهٔ این صفحه نمایش داده می‌شود."
      : "دریافت داده‌ها ممکن نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.";
  } finally {
    void measurements.finally(() => clearTimeout(timeout));
    state.loading = false;
    state.refreshing = false;
    render();
  }
}
function toast(message: string) {
  const element = document.querySelector("#toast")!;
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), 3500);
}
async function copy(text: string) {
  if (isDesktop) {
    await writeNativeClipboard(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.className = "clipboard-fallback";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const success = document.execCommand("copy");
  textarea.remove();
  if (!success) throw new Error("Clipboard unavailable");
}
async function exportConfigs() {
  const configs = filteredConfigs().filter((row) => state.pickedProtocols.has(row.protocol)).filter((row, index, array) => array.slice(0, index).filter((previous) => previous.protocol === row.protocol).length < state.perProtocol);
  if (!configs.length) return;
  const filename = `nil-${state.protocol}-${new Date().toISOString().slice(0, 10)}.txt`;
  const text = configs.map((item) => item.uri).join("\n") + "\n";
  if (isDesktop) {
    if (await saveNativeExport(filename, text))
      toast(`خروجی ${number(configs.length)} کانفیگ ذخیره شد`);
    return;
  }
  const url = URL.createObjectURL(
    new Blob([text], {
      type: "text/plain;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`خروجی ${number(configs.length)} کانفیگ آماده شد`);
}

function updateSubscriptionLink() {
  const value = (id: string) =>
    document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!
      .value;
  const output =
    document.querySelector<HTMLInputElement>("#subscription-link")!;
  try {
    output.value = subscriptionURL(
      value("subscription-protocol"),
      value("subscription-source"),
      value("subscription-search"),
      value("subscription-format"),
      value("subscription-name"),
      state.perProtocol,
      [...state.pickedProtocols],
    );
  } catch {
    output.value = "";
  }
}

function openSubscription() {
  document.querySelector<HTMLSelectElement>("#subscription-protocol")!.value =
    state.protocol;
  const source = document.querySelector<HTMLSelectElement>(
    "#subscription-source",
  )!;
  source.innerHTML =
    '<option value="all">همهٔ منابع</option>' +
    (state.status?.sources || [])
      .filter((item) => /^[A-Za-z0-9_-]{1,100}$/.test(item.id))
      .map(
        (item) =>
          `<option value="${escape(item.id)}">${escape(item.name)}</option>`,
      )
      .join("");
  document.querySelector<HTMLInputElement>("#subscription-search")!.value =
    state.query;
  updateSubscriptionLink();
  document
    .querySelector<HTMLDialogElement>("#subscription-dialog")!
    .showModal();
}

async function collectNow() {
  if (state.collecting || state.refreshing) return;
  state.collecting = true;
  state.error = "";
  render();
  try {
    const data = validateDataBatch(await serviceData(true));
    state.snapshot = data.snapshot;
    state.status = data.status;
    state.history = data.history;
    state.offlineCache = false;
    state.loading = false;
    try {
      localStorage.setItem(
        repositoryCacheKey,
        JSON.stringify([data.snapshot, data.status, data.history]),
      );
    } catch {
      /* Current results remain usable. */
    }
    if (data.status.state === "failed")
      state.error =
        "جمع‌آوری تازه موفق نشد؛ داده‌های قبلی حفظ شده‌اند. گزارش منابع را بررسی کن.";
    else
      toast(
        data.status.added
          ? `${number(data.status.added)} کانفیگ تازه دریافت شد؛ اشتراک‌ها به‌روز شدند.`
          : "جمع‌آوری انجام شد؛ کانفیگ تازهٔ یکتایی پیدا نشد.",
      );
    window.dispatchEvent(
      new CustomEvent("nil-data-updated", {
        detail: {
          lastSuccessfulAt: data.status.lastSuccessfulAt,
          added: data.status.added,
        },
      }),
    );
  } catch (error) {
    state.error =
      error instanceof ServiceError && error.status === 429
        ? `یک دریافت دیگر در حال انجام است؛ ${number(error.retryAfter || 60)} ثانیهٔ دیگر دوباره تلاش کن.`
        : "دریافت فوری از سرور انجام نشد؛ کانفیگ‌های فعلی حفظ شده‌اند. دوباره تلاش کن.";
  } finally {
    state.collecting = false;
    render();
  }
}

app.addEventListener("click", async (event) => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>(
    "a[href]",
  );
  if (isDesktop && anchor?.href.startsWith("https://")) {
    event.preventDefault();
    try {
      await openNativeGitHubLink(anchor.href);
    } catch {
      toast("باز کردن این پیوند ممکن نشد.");
    }
    return;
  }
  const button = (event.target as Element).closest<HTMLElement>(
    "[data-action], [data-view], [data-protocol]",
  );
  if (!button) return;
  if (button.dataset.view) {
    event.preventDefault();
    state.view = button.dataset.view as View;
    state.query = "";
    state.protocol = "all";
    visibleLimit = 24;
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  if (button.dataset.protocol) {
    state.protocol = button.dataset.protocol;
    visibleLimit = 24;
    // Preserve the horizontal tab scroll, focus, and search input on iOS.
    renderResults();
    return;
  }
  const action = button.dataset.action;
  if (action === "select-proxy") { selectedProxyId = button.dataset.id || null; render(); return; }
  if (action === "connect-proxy") { toast("اتصال واقعی به موتور VPN بومی هنوز پیاده‌سازی نشده است؛ اتصال جعلی نمایش داده نمی‌شود."); return; }
  if (action === "retest-proxy") { toast("تست مستقل هر سرور به موتور بومی نیاز دارد؛ نتیجه قبلی بدون اندازه‌گیری تغییر نمی‌کند."); return; }
  if (action === "reload-ping") { void refresh(); return; }
  if (action === "theme") {
    const choice = button.dataset.themeChoice;
    if (choice === "light" || choice === "dark" || choice === "auto")
      setTheme(choice as ThemeChoice);
    return;
  }
  if (action === "open-settings") { state.collectionSettings = true; render(); return; }
  if (action === "close-settings") { state.collectionSettings = false; render(); return; }
  if (action === "set-amount") { state.perProtocol = Number(button.dataset.value); render(); return; }
  if (action === "pick-protocol") { const p = button.dataset.value as Protocol; if (state.pickedProtocols.has(p)) { if (state.pickedProtocols.size > 1) state.pickedProtocols.delete(p); } else state.pickedProtocols.add(p); render(); return; }
  if (action === "start-collection") { await collectNow(); return; }
  if (action === "collect-now") {
    await collectNow();
    return;
  }
  if (action === "subscription") {
    openSubscription();
    return;
  }
  if (action === "close-subscription") {
    document.querySelector<HTMLDialogElement>("#subscription-dialog")!.close();
    return;
  }
  if (action === "copy-subscription") {
    const link =
      document.querySelector<HTMLInputElement>("#subscription-link")!.value;
    if (!link) return;
    try {
      await copy(link);
      toast("لینک اشتراک کپی شد؛ در کلاینت اضافه کن.");
    } catch {
      toast("کپی انجام نشد؛ لینک را انتخاب و کپی کن.");
    }
    return;
  }
  if (action === "refresh") {
    await refresh();
    return;
  }
  if (action === "export") {
    try {
      await exportConfigs();
    } catch {
      toast("ذخیرهٔ فایل انجام نشد؛ دوباره تلاش کن.");
    }
    return;
  }
  if (action === "install") {
    document.querySelector<HTMLDialogElement>("#install-dialog")!.showModal();
    return;
  }
  if (action === "close-install") {
    document.querySelector<HTMLDialogElement>("#install-dialog")!.close();
    return;
  }
  if (action === "clear-filters") {
    state.query = "";
    state.protocol = "all";
    visibleLimit = 24;
    render();
    return;
  }
  if (action === "load-more") {
    visibleLimit += 24;
    renderResults();
    return;
  }
  const item = state.snapshot?.configs.find(
    (item) => item.id === button.dataset.id,
  );
  if (!item) return;
  try {
    if (action === "save") {
      if (state.saved.has(item.id)) state.saved.delete(item.id);
      else state.saved.add(item.id);
      try {
        localStorage.setItem("nil-saved", JSON.stringify([...state.saved]));
      } catch {
        toast(
          "ذخیره‌سازی مرورگر در دسترس نیست؛ نشان‌ها فقط در این صفحه می‌مانند.",
        );
      }
      renderResults();
    } else if (action === "copy") {
      await copy(item.uri);
      toast("کانفیگ کپی شد؛ در برنامهٔ VPN وارد کن.");
    } else if (action === "share") {
      if (navigator.share)
        await navigator.share({ title: "NIL Config Catcher", text: item.uri });
      else {
        await copy(item.uri);
        toast("لینک کانفیگ برای اشتراک‌گذاری کپی شد.");
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      toast("این عملیات انجام نشد؛ دسترسی مرورگر را بررسی کن.");
  }
});
app.addEventListener("input", (event) => {
  if ((event.target as Element).closest("#subscription-dialog")) {
    updateSubscriptionLink();
    return;
  }
  if ((event.target as HTMLElement).id === "search") {
    state.query = (event.target as HTMLInputElement).value;
    visibleLimit = 24;
    renderResults();
  }
});
app.addEventListener("change", (event) => {
  if ((event.target as Element).closest("#subscription-dialog")) {
    updateSubscriptionLink();
    return;
  }
  if ((event.target as HTMLElement).id === "sort") {
    state.sort = (event.target as HTMLSelectElement).value;
    renderResults();
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector<HTMLInputElement>("#search")?.focus();
  }
});
window.addEventListener("offline", () => {
  render();
});
window.addEventListener("online", () => {
  void refresh();
});
shell();
void refresh();
setInterval(() => {
  if (
    !document.hidden &&
    !state.refreshing &&
    !state.collecting &&
    !(document.activeElement instanceof HTMLInputElement) &&
    !(document.activeElement instanceof HTMLSelectElement)
  )
    void refresh();
}, 120000);
if (!isDesktop && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch(() =>
        toast("ذخیرهٔ آفلاین فعال نشد؛ برنامهٔ آنلاین در دسترس است."),
      );
  });
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled)
      toast("نسخهٔ جدید آماده است؛ برای استفاده صفحه را دوباره باز کن.");
    controlled = true;
  });
}
