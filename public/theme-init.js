// Apply the saved theme before the first paint, so the page does not flash.
// This is a file, not an inline script, so the Content-Security-Policy can block inline scripts.
try {
  var t = localStorage.getItem("openact-theme");
  var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
} catch (e) {}
