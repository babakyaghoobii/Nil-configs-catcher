export type ThemeChoice = "light" | "dark" | "auto";

const systemTheme = matchMedia("(prefers-color-scheme: dark)");

export function themeChoice(): ThemeChoice {
  const value = document.documentElement.dataset.themeChoice;
  return value === "light" || value === "auto" ? value : "dark";
}

export function setTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "auto" && systemTheme.matches);
  const root = document.documentElement;
  root.dataset.themeChoice = choice;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#111110" : "#f4f0e8");
  try {
    localStorage.setItem("nil-theme", choice);
  } catch {
    /* Keep the in-memory choice. */
  }
  document
    .querySelectorAll<HTMLElement>("button[data-theme-choice]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.themeChoice === choice),
      );
    });
}

systemTheme.addEventListener("change", () => {
  if (themeChoice() === "auto") setTheme("auto");
});
