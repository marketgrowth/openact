export type ThemePref = "system" | "light" | "dark";
const KEY = "openact-theme";

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage can be blocked */
  }
  return "system";
}

export function setTheme(t: ThemePref) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* storage can be blocked */
  }
}
