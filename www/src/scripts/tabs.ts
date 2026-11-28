// Tabs, from the Buio theme's developer tabs. Markup:
//   <div data-tabs> <button role="tab" data-tab="0" aria-selected="true"> ... <div role="tabpanel" data-panel="0"> ...
// Without JavaScript, the first panel shows and the tabs do nothing.
document.querySelectorAll<HTMLElement>("[data-tabs]").forEach((root) => {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  const panels = [...root.querySelectorAll<HTMLElement>("[data-panel]")];
  const select = (tab: HTMLButtonElement, focus = false) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab));
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.tabIndex = tab.getAttribute("aria-selected") === "true" ? 0 : -1;
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      select(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });
});
