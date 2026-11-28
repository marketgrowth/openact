/*
 * The theme switcher for openact.ing. It loads in <head>, before the page paints, so the page never flashes the wrong theme.
 * It puts .light or .dark on <html>. The choice is "light", "dark" or "system" (the default), kept in localStorage.
 * Buttons: [data-theme-toggle] flips light and dark. [data-theme-set="light|dark|system"] picks one, and gets aria-pressed.
 */
(function () {
  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var KEY = "openact-theme";

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) {
      return "system";
    }
  }

  function apply(choice) {
    var dark = choice === "dark" || (choice === "system" && media.matches);
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    root.setAttribute("data-theme", choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#121214" : "#fafafa");
  }

  function sync() {
    var choice = root.getAttribute("data-theme");
    var dark = root.classList.contains("dark");
    document.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-set") === choice));
    });
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", dark ? "Use the light theme" : "Use the dark theme");
      b.setAttribute("title", dark ? "Light theme" : "Dark theme");
    });
  }

  function set(choice) {
    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch (e) {}
    apply(choice);
    sync();
  }

  apply(stored());
  media.addEventListener("change", function () {
    if (stored() === "system") {
      apply("system");
      sync();
    }
  });
  document.addEventListener("click", function (e) {
    var b = e.target instanceof Element ? e.target.closest("[data-theme-toggle],[data-theme-set]") : null;
    if (!b) return;
    if (b.hasAttribute("data-theme-toggle")) set(root.classList.contains("dark") ? "light" : "dark");
    else set(b.getAttribute("data-theme-set"));
  });
  document.addEventListener("DOMContentLoaded", sync);
})();
