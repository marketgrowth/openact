/*
 * The "Book a scoping call" side drawer on https://openact.ing/producer.
 * Links to #book open it as a modal dialog. The form posts to /api/producer (www/worker/producer.ts), which sends it with Resend.
 * Without this script, the drawer still opens through :target and the form still posts.
 */
(() => {
  const drawer = document.getElementById("book");
  if (!drawer || typeof drawer.showModal !== "function") return;
  const form = drawer.querySelector("[data-producer-form]");
  const done = drawer.querySelector("[data-done]");
  const lead = drawer.querySelector(".drawer-lead");
  const status = form.querySelector("[data-status]");
  const btn = form.querySelector('button[type="submit"]');
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let opener = null;

  // The script owns the drawer now, so the :target fallback must not show it too.
  document.documentElement.classList.add("js-drawer");

  const open = (from) => {
    opener = from || null;
    if (!done.hidden) {
      done.hidden = true;
      form.hidden = false;
      lead.hidden = false;
    }
    drawer.showModal();
    document.documentElement.classList.add("drawer-open");
    requestAnimationFrame(() => drawer.classList.add("is-open"));
    document.getElementById("b-name").focus();
  };
  const close = () => {
    drawer.classList.remove("is-open");
    const finish = () => {
      drawer.close();
      document.documentElement.classList.remove("drawer-open");
      if (location.hash === "#book") history.replaceState(null, "", location.pathname + location.search);
      if (opener) opener.focus();
    };
    reduce.matches ? finish() : setTimeout(finish, 200);
  };

  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href="#book"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    open(a);
  });
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer || e.target.closest("[data-close]")) {
      e.preventDefault();
      close();
    }
  });
  drawer.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  if (location.hash === "#book") open(null);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const need = [];
    let first = null;
    for (const [id, what] of [["b-name", "your name"], ["b-email", "a valid email"], ["b-app", "the app you want"]]) {
      const el = document.getElementById(id);
      const bad = !el.value.trim() || !el.checkValidity();
      el.setAttribute("aria-invalid", String(bad));
      if (bad) {
        need.push(what);
        first = first || el;
      }
    }
    if (first) {
      status.textContent = "Please fill in " + (need.length > 1 ? need.slice(0, -1).join(", ") + " and " + need.at(-1) : need[0]) + ".";
      first.focus();
      return;
    }
    const data = new FormData(form);
    btn.disabled = true;
    btn.textContent = "Sending";
    status.textContent = "";
    try {
      const res = await fetch(form.action, { method: "POST", body: data, headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.message || "We could not send your request. Try again in a minute.");
      const name = String(data.get("name") || "").trim().split(" ")[0];
      done.querySelector("[data-done-name]").textContent = name ? ", " + name : "";
      done.querySelector("[data-done-email]").textContent = String(data.get("email"));
      form.hidden = true;
      lead.hidden = true;
      done.hidden = false;
      drawer.querySelector(".drawer-panel").scrollTop = 0;
      done.focus({ preventScroll: true });
      form.reset();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : "We could not send your request. Try again in a minute.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Send my request";
    }
  });
})();
