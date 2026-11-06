import "@fontsource-variable/vazirmatn";
import "./style.css";
import { validateSnapshot, type Config } from "../src/config-snapshot";
import {
  primaryOrigin,
  ServiceError,
  serviceData,
  serviceMeasurements,
  type Measurement,
} from "../src/service";
import { PROTOCOLS, tryParseConfig } from "../service/protocols";

type Entry = Pick<Config, "id" | "uri" | "name" | "host" | "port" | "protocol">;
type LocalEntry = Entry & { pinned: boolean };
type TcpMeasurement =
  | { state: "open"; latencyMs: number }
  | { state: "failed" | "unsupported" | "unavailable" };

const key = "nil-proxy-web-v1";
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const $$ = (selector: string) => [
  ...document.querySelectorAll<HTMLElement>(selector),
];
const dataPath = (file: string) =>
  new URL(`../data/${file}.json`, location.href).href;
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const api = new URL("/api/", local ? location.origin : primaryOrigin).href;
const publicProfile = new URL("/api/profile", primaryOrigin);
let incomingId = new URLSearchParams(location.search).get("id");
let saved: LocalEntry[] = [];
try {
  const previous: unknown = JSON.parse(localStorage.getItem(key) || "[]");
  if (Array.isArray(previous))
    saved = previous.filter(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.uri === "string" &&
        typeof entry.name === "string" &&
        typeof entry.host === "string" &&
        PROTOCOLS.includes(entry.protocol),
    );
} catch {
  /* Private browsing or invalid stored data. */
}

let collected = new Map<string, Config>();
let selected: string | null = null;
let filter = "all";
let visible = 60;
let collectorBusy = false;
let measurements = new Map<string, Measurement>();
const tcpResults = new Map<string, TcpMeasurement | "running">();
const logs: string[] = [];
const search = $<HTMLInputElement>("#search");
const sort = $<HTMLSelectElement>("#sort");
const sheetSelect = $<HTMLSelectElement>("#connectConfigSelect");
const handoff = $<HTMLAnchorElement>("#startConnection");

function log(message: string) {
  logs.unshift(`${new Date().toLocaleTimeString("fa-IR")} — ${message}`);
  logs.splice(100);
  $("#logList").textContent = logs.join("\n");
}

function persist() {
  try {
    localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    log("ذخیرهٔ محلی در دسترس نیست.");
  }
}

function entries(): Entry[] {
  const publicUris = new Set([...collected.values()].map(({ uri }) => uri));
  return [
    ...collected.values(),
    ...saved.filter(({ uri }) => !publicUris.has(uri)),
  ];
}

function timestamp(value: unknown) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time)
    ? new Date(time).toLocaleString("fa-IR")
    : "زمان نامشخص";
}

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

function select(id: string | null) {
  selected = id;
  render();
  if (!$("#connectSheet").classList.contains("hidden")) renderConnect();
}

function statusFor(id: string) {
  const xray = measurements.get(id);
  const measurement = tcpResults.get(id);
  const tcp = measurement === "running" ? undefined : measurement;
  const labels: string[] = [];
  if (xray?.state === "reachable") labels.push(`Xray: ${xray.latencyMs} ms`);
  if (xray?.state === "failed") labels.push("Xray: ناموفق");
  if (xray?.state === "skipped") labels.push("Xray: رد شد");
  if (measurement === "running") labels.push("TCP: در حال آزمون");
  if (tcp?.state === "open") labels.push(`TCP: ${tcp.latencyMs} ms`);
  if (tcp?.state === "failed") labels.push("TCP: دسترسی ناموفق");
  if (tcp?.state === "unsupported") labels.push("TCP: پشتیبانی نمی‌شود");
  if (tcp?.state === "unavailable") labels.push("TCP: سرویس در دسترس نیست");
  return labels.join(" · ") || "تست‌نشده";
}

function render() {
  const all = entries();
  const pinned = new Set(
    saved.filter(({ pinned }) => pinned).map(({ uri }) => uri),
  );
  const protocols = [
    "all",
    ...PROTOCOLS.filter((protocol) =>
      all.some((item) => item.protocol === protocol),
    ),
  ];
  if (!protocols.includes(filter)) filter = "all";
  $("#filters").innerHTML = protocols
    .map(
      (protocol) =>
        `<button data-filter="${protocol}" class="${filter === protocol ? "active" : ""}">${protocol === "all" ? "All" : protocol.toUpperCase()} ${all.filter((item) => protocol === "all" || protocol === item.protocol).length}</button>`,
    )
    .join("");
  const query = search.value.trim().toLowerCase();
  const field = sort.value === "protocol" ? "protocol" : "name";
  const rows = all
    .filter(
      (item) =>
        (filter === "all" || filter === item.protocol) &&
        `${item.name} ${item.host}`.toLowerCase().includes(query),
    )
    .sort(
      (a, b) =>
        a[field].localeCompare(b[field], undefined, { numeric: true }) ||
        a.name.localeCompare(b.name),
    );
  $("#nodes").innerHTML =
    rows
      .slice(0, visible)
      .map((item) => {
        const id = escape(item.id);
        const canProbe =
          collected.has(item.id) &&
          !["hysteria2", "tuic"].includes(item.protocol);
        return `<div class="node ${selected === item.id ? "selected" : ""}"><span class="protocol">${item.protocol.toUpperCase()}</span>
      <button type="button" class="nodeinfo" data-select="${id}" aria-pressed="${selected === item.id}"><strong>${escape(item.name)}</strong><small dir="ltr">${escape(item.host)}</small></button>
      <span class="latency" aria-live="polite">${statusFor(item.id)}</span><button data-ping="${id}" title="آزمون زندهٔ TCP از سرور NIL" aria-label="آزمون زندهٔ TCP از سرور NIL" ${!canProbe || tcpResults.get(item.id) === "running" ? "disabled" : ""}>⟳</button>
      <button class="${pinned.has(item.uri) ? "pinned" : ""}" data-pin="${id}" aria-label="نشان‌کردن کانفیگ" aria-pressed="${pinned.has(item.uri)}">♧</button></div>`;
      })
      .join("") || '<div class="empty">کانفیگی در این فهرست نیست.</div>';
  $("#loadMore").classList.toggle("hidden", rows.length <= visible);
  $("#selectedName").textContent =
    all.find(({ id }) => id === selected)?.name || "کانفیگی انتخاب نشده";
  $("#pinnedNodes").textContent =
    saved
      .filter(({ pinned }) => pinned)
      .map(({ name }) => name)
      .join(" · ") || "کانفیگ نشان‌شده‌ای وجود ندارد.";
}

function renderConnect() {
  const all = entries();
  const entry = all.find(({ id }) => id === selected);
  sheetSelect.replaceChildren(new Option("کانفیگ را انتخاب کن", ""));
  for (const item of all)
    sheetSelect.add(
      new Option(`${item.protocol.toUpperCase()} — ${item.name}`, item.id),
    );
  sheetSelect.value = entry?.id ?? "";
  const publicEntry = !!entry && collected.has(entry.id);
  handoff.classList.toggle("hidden", !publicEntry);
  $("#copyConfig").classList.toggle("hidden", !entry);
  handoff.removeAttribute("href");
  if (publicEntry) {
    const profile = new URL(publicProfile);
    profile.searchParams.set("id", entry.id);
    const native = new URL("hiddify://import/");
    native.searchParams.set("url", profile.href);
    handoff.href = native.href;
  }
  $("#connectStatus").textContent = !entry
    ? "کانفیگی انتخاب نشده."
    : publicEntry
      ? "برای وارد کردن همین پروفایل، کلاینت بومی را باز کن."
      : "کانفیگ دستی روی این دستگاه ذخیره شده است.";
}

let previousFocus: HTMLElement | null = null;
function openConnect() {
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  renderConnect();
  $("#connectOverlay").classList.remove("hidden");
  $("#connectSheet").classList.remove("hidden");
  $("#closeConnectSheet").focus();
}

function closeConnect() {
  $("#connectOverlay").classList.add("hidden");
  $("#connectSheet").classList.add("hidden");
  previousFocus?.focus();
}

function tab(name: string) {
  $$("main>section").forEach((section) =>
    section.classList.toggle("hidden", section.id !== name),
  );
  $$("[data-tab]").forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === name),
  );
  if (name === "connect") openConnect();
}

async function loadCollector(collect = false) {
  if (collectorBusy) return;
  collectorBusy = true;
  for (const id of ["#refreshConfigs", "#collectConfigs"])
    $<HTMLButtonElement>(id).disabled = true;
  const status = $("#collectorStatus");
  status.textContent = collect
    ? "Collector در حال بررسی منابع عمومی…"
    : "در حال خواندن Collector…";
  try {
    const [snapshot, report] = await serviceData(collect, undefined, api);
    const data = validateSnapshot(snapshot);
    const result = report as {
      state?: string;
      added?: number;
      lastSuccessfulAt?: string;
    } | null;
    setSnapshot(data.configs);
    const refresh =
      result?.state === "failed"
        ? "آخرین جمع‌آوری ناموفق؛ داده‌های قبلی"
        : result?.state === "partial"
          ? "جمع‌آوری با خطا در بخشی از منابع"
          : "Collector زنده";
    const added =
      collect && typeof result?.added === "number"
        ? ` · ${result.added} کانفیگ تازه`
        : "";
    status.textContent = `${refresh} · ${collected.size} در فهرست / ${data.totalUnique} در آرشیو${added} · آخرین موفقیت: ${timestamp(result?.lastSuccessfulAt)}`;
    if (collect) log(status.textContent);
  } catch (error) {
    if (collect) {
      status.textContent =
        error instanceof ServiceError && error.status === 429
          ? "Collector در حال اجراست یا هنوز در بازهٔ انتظار است."
          : "جمع‌آوری تازه انجام نشد؛ فهرست قبلی نگه داشته شد.";
    } else {
      try {
        const response = await fetch(dataPath("configs"), {
          cache: "no-store",
          signal: AbortSignal.timeout(7000),
        });
        if (!response.ok) throw new Error("Snapshot unavailable");
        const data = validateSnapshot(await response.json());
        setSnapshot(data.configs);
        status.textContent = `آخرین اسنپ‌شات منتشرشده · ${collected.size} کانفیگ · ${timestamp(data.generatedAt)}`;
      } catch {
        status.textContent = collected.size
          ? "دریافت ناموفق؛ فهرست قبلی نگه داشته شد."
          : "Collector و اسنپ‌شات در دسترس نیستند.";
      }
    }
  } finally {
    collectorBusy = false;
    for (const id of ["#refreshConfigs", "#collectConfigs"])
      $<HTMLButtonElement>(id).disabled = false;
  }
}

function setSnapshot(configs: Config[]) {
  const current = entries().find(({ id }) => id === selected);
  collected = new Map(configs.map((item) => [item.id, item]));
  for (const id of tcpResults.keys())
    if (!collected.has(id)) tcpResults.delete(id);
  selected = current
    ? (entries().find(({ id, uri }) => id === current.id || uri === current.uri)?.id ?? null)
    : null;
  if (incomingId && collected.has(incomingId)) {
    selected = incomingId;
    if (location.hash !== "#connect") search.value = collected.get(incomingId)!.name;
    incomingId = null;
  }
  select(selected);
  if (location.hash === "#connect" && $("#connectSheet").classList.contains("hidden")) {
    history.replaceState(null, "", location.pathname + location.search);
    tab("connect");
  }
}

async function loadMeasurements() {
  const button = $<HTMLButtonElement>("#pingAll");
  if (button.disabled) return;
  button.disabled = true;
  $("#measurementStatus").textContent = "در حال دریافت نتایج Xray…";
  try {
    const result = await serviceMeasurements(new AbortController().signal, [
      `${api}measurements`,
      dataPath("measurements"),
    ]);
    measurements = result?.measurements ?? new Map();
    $("#measurementStatus").textContent = result
      ? `تست HTTPS از داخل Xray در CI · ${timestamp(result.measuredAt)} · ${measurements.size} نتیجه`
      : "نتیجهٔ تازهٔ Xray در دسترس نیست.";
    render();
  } finally {
    button.disabled = false;
  }
}

async function probe(id: string) {
  if (!collected.has(id) || tcpResults.get(id) === "running") return;
  tcpResults.set(id, "running");
  render();
  let result: TcpMeasurement = { state: "unavailable" };
  try {
    const url = new URL("latency", api);
    url.searchParams.set("id", id);
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        state?: string;
        latencyMs?: number;
      };
      if (
        data.state === "open" &&
        Number.isInteger(data.latencyMs) &&
        data.latencyMs! > 0 &&
        data.latencyMs! <= 6000
      )
        result = { state: "open", latencyMs: data.latencyMs! };
      if (data.state === "failed" || data.state === "unsupported")
        result = { state: data.state };
    } else if (response.status === 429) {
      log("سقف آزمون TCP رسیده است؛ کمی بعد دوباره امتحان کن.");
    }
  } catch {
    /* Unavailable is separate from a failed socket connection. */
  }
  if (collected.has(id)) tcpResults.set(id, result);
  render();
}

$$("[data-tab]").forEach(
  (button) => (button.onclick = () => tab(button.dataset.tab!)),
);
$("#searchToggle").onclick = () => {
  tab("configs");
  search.focus();
};
$("#settingsToggle").onclick = () => tab("settings");
$("#addToggle").onclick = () => tab("subscriptions");
$("#connectBtn").onclick = $("#openConnectSheet").onclick = openConnect;
$("#connectOverlay").onclick = $("#closeConnectSheet").onclick = closeConnect;
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    !$("#connectSheet").classList.contains("hidden")
  )
    closeConnect();
});
sheetSelect.onchange = () => select(sheetSelect.value || null);
handoff.onclick = () => {
  $("#connectStatus").textContent =
    "در کلاینت بومی، وارد کردن پروفایل و سپس اتصال را تأیید کن.";
};
$("#copyConfig").onclick = async () => {
  const entry = entries().find(({ id }) => id === selected);
  if (!entry) return;
  try {
    await navigator.clipboard.writeText(entry.uri);
    $("#connectStatus").textContent = "کانفیگ کپی شد.";
  } catch {
    $("#connectStatus").textContent = "مرورگر اجازهٔ کپی نداد.";
  }
};
$("#refreshConfigs").onclick = () => void loadCollector();
$("#collectConfigs").onclick = () => void loadCollector(true);
$("#pingAll").onclick = () => void loadMeasurements();
$("#loadMore").onclick = () => {
  visible += 60;
  render();
};
search.oninput = sort.onchange = () => {
  visible = 60;
  render();
};
$("#filters").onclick = (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-filter]",
  );
  if (button) {
    filter = button.dataset.filter!;
    visible = 60;
    render();
  }
};
$("#nodes").onclick = (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!button) return;
  if (button.dataset.select) select(button.dataset.select);
  if (button.dataset.ping) void probe(button.dataset.ping);
  if (button.dataset.pin) {
    const item = entries().find(({ id }) => id === button.dataset.pin);
    if (!item) return;
    const existing = saved.find(({ uri }) => uri === item.uri);
    if (existing) existing.pinned = !existing.pinned;
    else saved.push({ ...item, pinned: true });
    persist();
    render();
  }
};

$("#importBtn").onclick = async () => {
  const input = $<HTMLTextAreaElement>("#importText");
  const button = $<HTMLButtonElement>("#importBtn");
  button.disabled = true;
  try {
    const known = new Set(entries().map(({ id }) => id));
    let added = 0;
    for (const uri of input.value.trim().split(/\s+/).slice(0, 1000)) {
      const item = await tryParseConfig(uri);
      if (!item || known.has(item.id)) continue;
      known.add(item.id);
      saved.push({ ...item, pinned: false });
      added++;
    }
    persist();
    input.value = "";
    log(`${added} کانفیگ معتبر وارد شد.`);
    tab("configs");
    render();
  } finally {
    button.disabled = false;
  }
};
$("#exportBtn").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([saved.map(({ uri }) => uri).join("\n")], { type: "text/plain" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "NIL-Proxy-Configs.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("#clearBtn").onclick = () => {
  if (!confirm("همهٔ کانفیگ‌های محلی پاک شوند؟")) return;
  saved = [];
  if (selected && !collected.has(selected)) selected = null;
  persist();
  render();
  log("داده‌های محلی پاک شدند.");
};

render();
void loadCollector();
void loadMeasurements();
