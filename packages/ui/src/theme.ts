export type ThemePref = "system" | "light" | "dark";
const KEY = "openact-theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage can be blocked */
  }
  return "system";
}

/** Sets the `.dark` class on <html> from the choice. "system" follows the device setting. */
function apply(t: ThemePref) {
  const dark = t === "dark" || (t === "system" && !!media?.matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(t: ThemePref) {
  apply(t);
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* storage can be blocked */
  }
}

// Follow the device when the person has not chosen a theme.
media?.addEventListener("change", () => {
  if (getTheme() === "system") apply("system");
});
