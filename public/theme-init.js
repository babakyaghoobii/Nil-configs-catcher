/* Apply the saved NIL appearance before the first paint. No network access. */
(() => {
  let choice = "dark";
  try {
    const saved = localStorage.getItem("nil-theme");
    if (["light", "dark", "auto"].includes(saved)) choice = saved;
  } catch {
    /* Appearance still works when browser storage is unavailable. */
  }
  const dark =
    choice === "dark" ||
    (choice === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
