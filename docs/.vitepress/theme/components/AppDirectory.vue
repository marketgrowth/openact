<script setup lang="ts">
import { computed, ref } from "vue";
import data from "../../../../directory/apps.json";

/* The app directory, from directory/apps.json. */

interface DirApp {
  id: string;
  name: string;
  summary: string;
  category: string;
  status: "built-in" | "available" | "planned" | "example";
  publisher: string;
  reserved: boolean;
  source: string;
  repo: string;
}

const apps = data.apps as DirApp[];
const LABELS: Record<DirApp["status"], string> = { "built-in": "Built in", available: "Available", planned: "Planned", example: "Example" };
const filters = [
  { id: "all", label: "All" },
  { id: "built-in", label: "Built in" },
  { id: "available", label: "Available" },
  { id: "planned", label: "Planned" },
  { id: "example", label: "Examples" }
] as const;

const query = ref("");
const status = ref<(typeof filters)[number]["id"]>("all");
const copied = ref<string | null>(null);

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return apps.filter(
    (a) =>
      (status.value === "all" || a.status === status.value) &&
      (!q || [a.name, a.id, a.summary, a.category, a.publisher].some((s) => s.toLowerCase().includes(q)))
  );
});
const count = (id: string) => (id === "all" ? apps.length : apps.filter((a) => a.status === id).length);

const command = (a: DirApp) => (a.status === "available" || a.status === "example" ? `npm run openact -- add ${a.id}` : null);

async function copy(a: DirApp) {
  const text = command(a);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = a.id;
    setTimeout(() => (copied.value = null), 1500);
  } catch {
    /* The command stays on the page to select by hand. */
  }
}
</script>

<template>
  <div class="dir">
    <div class="dir-bar">
      <input v-model="query" class="dir-search" type="search" placeholder="Search apps" aria-label="Search apps" />
      <div class="dir-filters" role="group" aria-label="Status">
        <button
          v-for="f in filters"
          :key="f.id"
          type="button"
          :class="['dir-chip', { on: status === f.id }]"
          :aria-pressed="status === f.id"
          @click="status = f.id"
        >
          {{ f.label }} <span class="dir-count">{{ count(f.id) }}</span>
        </button>
      </div>
    </div>

    <p v-if="!shown.length" class="dir-empty">No apps match. Try another word.</p>

    <ul class="dir-grid">
      <li v-for="a in shown" :key="a.id" class="dir-card" :data-app="a.id">
        <div class="dir-head">
          <span class="dir-tile" :data-status="a.status" aria-hidden="true">{{ a.name.charAt(0) }}</span>
          <div class="dir-title">
            <a :href="a.repo" target="_blank" rel="noreferrer" class="dir-name">{{ a.name }}</a>
            <span class="dir-meta">{{ a.category }} · {{ a.publisher }}</span>
          </div>
          <span class="dir-badge" :data-status="a.status">{{ LABELS[a.status] }}</span>
        </div>
        <p class="dir-summary">{{ a.summary }}</p>
        <div class="dir-foot">
          <code class="dir-id">{{ a.id }}</code>
          <button v-if="command(a)" type="button" class="dir-copy" :title="command(a)!" @click="copy(a)">
            {{ copied === a.id ? "Copied" : "Copy install command" }}
          </button>
          <span v-else-if="a.status === 'planned'" class="dir-note">Name reserved</span>
          <span v-else class="dir-note">Installed with OpenAct</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.dir { margin-top: 24px; }
.dir-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 16px; }
.dir-search {
  flex: 1 1 220px; min-width: 0; height: 36px; padding: 0 12px; border: 1px solid var(--vp-c-divider);
  border-radius: 8px; background: var(--vp-c-bg); color: var(--vp-c-text-1); font-size: 14px;
}
.dir-search:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: -1px; }
.dir-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.dir-chip {
  height: 32px; padding: 0 12px; border: 1px solid var(--vp-c-divider); border-radius: 999px;
  font-size: 13px; color: var(--vp-c-text-2); background: var(--vp-c-bg);
}
.dir-chip.on { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); }
.dir-count { opacity: 0.7; margin-left: 2px; }
.dir-empty { color: var(--vp-c-text-2); }
.dir-grid { list-style: none; padding: 0 !important; margin: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.dir-card {
  margin: 0 !important; display: flex; flex-direction: column; gap: 10px; padding: 16px;
  border: 1px solid var(--vp-c-divider); border-radius: 12px; background: var(--vp-c-bg-soft);
}
.dir-head { display: flex; align-items: center; gap: 10px; }
.dir-tile {
  flex: none; width: 36px; height: 36px; border-radius: 9px; display: grid; place-items: center;
  font-weight: 600; color: #fff; background: var(--vp-c-brand-1);
}
.dir-tile[data-status="planned"] { background: var(--vp-c-default-soft); color: var(--vp-c-text-2); border: 1px dashed var(--vp-c-divider); }
.dir-tile[data-status="example"] { background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); }
.dark .dir-tile[data-status="built-in"], .dark .dir-tile[data-status="available"] { color: #0d1120; }
.dir-title { display: grid; min-width: 0; flex: 1; line-height: 1.3; }
.dir-name { font-weight: 600; color: var(--vp-c-text-1) !important; text-decoration: none !important; }
.dir-name:hover { color: var(--vp-c-brand-1) !important; }
.dir-meta { font-size: 12px; color: var(--vp-c-text-2); }
.dir-badge { flex: none; font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--vp-c-divider); color: var(--vp-c-text-2); }
.dir-badge[data-status="built-in"], .dir-badge[data-status="available"] { border-color: transparent; background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); }
.dir-summary { margin: 0 !important; font-size: 14px; line-height: 1.5; color: var(--vp-c-text-2); flex: 1; }
.dir-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dir-id { font-size: 12px !important; }
.dir-copy { font-size: 12px; font-weight: 500; color: var(--vp-c-brand-1); }
.dir-copy:hover { text-decoration: underline; }
.dir-note { font-size: 12px; color: var(--vp-c-text-3); }
</style>
