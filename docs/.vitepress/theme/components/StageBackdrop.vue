<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useData } from "vitepress";

/*
 * A theater stage behind the home page hero, drawn in code: velvet legs and a pleated border with
 * shaded folds and nap, a black drape, a wood floor in perspective, a spotlight with drifting dust,
 * and footlights. Every color is a theme token. The light theme is the stage under work lights.
 * The dark theme is the show: house lights down and one spotlight. The change fades slowly.
 *
 * Footage: set `stage.video` and `stage.poster` in the home page frontmatter, such as
 * "/stage/stage.mp4" in docs/public. Then a photo or video of a real stage replaces the drawing.
 * The light theme brightens it, and the dark theme dims it to a spotlight.
 */

const { frontmatter } = useData();
const media = computed(() => (frontmatter.value.stage ?? null) as { video?: string; poster?: string } | null);
const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const height = ref<string>("100%");
const top = ref<string>("0px");
let observer: ResizeObserver | null = null;

onMounted(() => {
  const hero = document.querySelector<HTMLElement>(".VPHome .VPHero");
  if (!hero) return;
  // The hero starts under the nav bar. The stage covers the same box.
  const fit = () => {
    height.value = `${hero.offsetHeight}px`;
    top.value = `${hero.offsetTop}px`;
  };
  fit();
  observer = new ResizeObserver(fit);
  observer.observe(hero);
});
onBeforeUnmount(() => observer?.disconnect());

// A small seeded random, so the stage looks the same on every visit.
function seeded(seed: number) {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
}

// Velvet folds: each fold goes from shadow to cloth to highlight and back, with uneven widths.
function folds(count: number, seed: number) {
  const r = seeded(seed);
  const widths = Array.from({ length: count }, () => 0.7 + r() * 0.6);
  const total = widths.reduce((a, b) => a + b, 0);
  const stops: Array<{ o: number; c: string }> = [];
  let at = 0;
  for (const w of widths) {
    const span = w / total;
    stops.push({ o: at, c: "--velvet-shadow" });
    stops.push({ o: at + span * 0.28, c: "--velvet-base" });
    stops.push({ o: at + span * 0.5, c: r() > 0.35 ? "--velvet-light" : "--velvet-base" });
    stops.push({ o: at + span * 0.74, c: "--velvet-base" });
    at += span;
  }
  stops.push({ o: 1, c: "--velvet-shadow" });
  return stops.map((s) => ({ offset: `${(s.o * 100).toFixed(2)}%`, style: `stop-color: var(${s.c})` }));
}

const curtainFolds = folds(9, 11);
const borderFolds = folds(46, 29);

// Floor planks: slightly different tones and a few end joints.
const rp = seeded(7);
const planks = Array.from({ length: 44 }, (_, i) => ({
  x: i * 64,
  shade: (rp() * 0.22).toFixed(3),
  joint: 120 + Math.round(rp() * 260)
}));

// Dust in the spotlight beam.
const rd = seeded(5);
const dust = Array.from({ length: 34 }, () => ({
  left: `${40 + rd() * 20}%`,
  top: `${24 + rd() * 52}%`,
  size: `${1 + rd() * 2.2}px`,
  duration: `${9 + rd() * 10}s`,
  delay: `${-rd() * 18}s`
}));
const lights = Array.from({ length: 11 }, (_, i) => i);
</script>

<template>
  <div v-if="media?.video || media?.poster" class="stage stage-media" :style="{ height, top }" aria-hidden="true">
    <video
      v-if="media.video && !reduceMotion"
      class="stage-footage"
      :src="media.video"
      :poster="media.poster"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
    ></video>
    <img v-else class="stage-footage" :src="media.poster" alt="" />
    <div class="stage-house"></div>
    <div class="stage-spotlight"></div>
    <div class="stage-fade"></div>
  </div>
  <div v-else class="stage" :style="{ height, top }" aria-hidden="true">
    <svg class="stage-defs" width="0" height="0" focusable="false">
      <defs>
        <filter id="oa-velvet" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55 0.006" numOctaves="2" seed="4" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="table" tableValues="0 0.55" /></feComponentTransfer>
        </filter>
        <filter id="oa-grain-wood" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9 0.012" numOctaves="3" seed="9" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="table" tableValues="0 0.5" /></feComponentTransfer>
        </filter>
        <filter id="oa-film" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
    </svg>

    <!-- The back wall: a black drape in the show, a lit wall under work lights -->
    <div class="stage-wall"></div>
    <div class="stage-drape"></div>
    <div class="stage-cyc"></div>

    <!-- The spotlight beam, with dust that drifts through it -->
    <div class="stage-beam"></div>
    <div class="stage-beam core"></div>
    <div class="stage-dust">
      <span v-for="(d, i) in dust" :key="i" :style="{ left: d.left, top: d.top, width: d.size, height: d.size, animationDuration: d.duration, animationDelay: d.delay }"></span>
    </div>

    <!-- The floor: wood planks in perspective, a pool of light, and the front edge with footlights -->
    <div class="stage-floor">
      <svg class="stage-planks" viewBox="0 0 2816 600" preserveAspectRatio="none">
        <rect width="2816" height="600" style="fill: var(--stage-wood)" />
        <g v-for="p in planks" :key="p.x">
          <rect :x="p.x" y="0" width="64" height="600" :style="{ fill: 'var(--stage-wood-dark)', opacity: p.shade }" />
          <rect :x="p.x" y="0" width="2" height="600" style="fill: var(--stage-wood-dark); opacity: 0.9" />
          <rect :x="p.x" :y="p.joint" width="64" height="2" style="fill: var(--stage-wood-dark); opacity: 0.7" />
        </g>
        <rect width="2816" height="600" filter="url(#oa-grain-wood)" style="mix-blend-mode: multiply" />
      </svg>
      <div class="stage-floor-depth"></div>
      <div class="stage-pool"></div>
    </div>
    <div class="stage-lip">
      <span v-for="n in lights" :key="n" class="stage-light"></span>
    </div>

    <!-- The legs: velvet curtains at each side -->
    <svg v-for="side in ['left', 'right']" :key="side" :class="['stage-curtain', side]" viewBox="0 0 300 1000" preserveAspectRatio="none">
      <defs>
        <linearGradient :id="`oa-folds-${side}`" x1="0" x2="1" y1="0" y2="0">
          <stop v-for="(f, i) in curtainFolds" :key="i" :offset="f.offset" :style="f.style" />
        </linearGradient>
        <linearGradient :id="`oa-hang-${side}`" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style="stop-color: #000; stop-opacity: 0.55" />
          <stop offset="18%" style="stop-color: #000; stop-opacity: 0" />
          <stop offset="80%" style="stop-color: #000; stop-opacity: 0" />
          <stop offset="100%" style="stop-color: #000; stop-opacity: 0.45" />
        </linearGradient>
        <linearGradient :id="`oa-rim-${side}`" x1="0" x2="1" y1="0" y2="0">
          <stop offset="55%" style="stop-color: var(--velvet-rim); stop-opacity: 0" />
          <stop offset="100%" style="stop-color: var(--velvet-rim); stop-opacity: 1" />
        </linearGradient>
        <clipPath :id="`oa-leg-${side}`">
          <path d="M0 0 H300 C296 260 304 640 294 930 Q292 985 318 1000 H0 Z" />
        </clipPath>
      </defs>
      <g :clip-path="`url(#oa-leg-${side})`">
        <rect width="320" height="1000" :fill="`url(#oa-folds-${side})`" />
        <rect width="320" height="1000" filter="url(#oa-velvet)" class="velvet-nap" />
        <rect width="320" height="1000" :fill="`url(#oa-rim-${side})`" class="velvet-rim" />
        <rect width="320" height="1000" :fill="`url(#oa-hang-${side})`" />
      </g>
    </svg>

    <!-- The border at the top: a pleated velvet valance with gold braid and fringe -->
    <div class="stage-border">
      <svg viewBox="0 0 1440 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="oa-border-folds" x1="0" x2="1" y1="0" y2="0">
            <stop v-for="(f, i) in borderFolds" :key="i" :offset="f.offset" :style="f.style" />
          </linearGradient>
          <linearGradient id="oa-border-hang" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" style="stop-color: #000; stop-opacity: 0.5" />
            <stop offset="45%" style="stop-color: #000; stop-opacity: 0" />
            <stop offset="100%" style="stop-color: #000; stop-opacity: 0.25" />
          </linearGradient>
        </defs>
        <rect width="1440" height="100" fill="url(#oa-border-folds)" />
        <rect width="1440" height="100" filter="url(#oa-velvet)" class="velvet-nap" />
        <rect width="1440" height="100" fill="url(#oa-border-hang)" />
      </svg>
      <div class="stage-braid"></div>
      <div class="stage-fringe"></div>
    </div>

    <!-- The lens: a soft vignette and film grain -->
    <div class="stage-vignette"></div>
    <svg class="stage-film" width="100%" height="100%" preserveAspectRatio="none"><rect width="100%" height="100%" filter="url(#oa-film)" /></svg>
  </div>
</template>

<style scoped>
.stage {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.stage * {
  transition:
    background-color 0.8s ease,
    fill 0.8s ease,
    stroke 0.8s ease,
    opacity 0.8s ease,
    box-shadow 0.8s ease,
    stop-color 0.8s ease;
}

.stage-defs { position: absolute; width: 0; height: 0; }

/* The back wall */
.stage-wall { position: absolute; inset: 0; background-color: var(--stage-wall); }
.stage-drape {
  position: absolute; inset: var(--vp-nav-height) 0 0 0;
  background: repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.35) 0 14px, rgba(255, 255, 255, 0.05) 26px, rgba(0, 0, 0, 0.35) 40px);
  opacity: var(--stage-drape-o);
}
.stage-cyc {
  position: absolute; inset: 0;
  background: radial-gradient(52% 58% at 50% 46%, var(--stage-cyc), transparent 72%);
  opacity: var(--stage-cyc-o);
}

/* The spotlight beam */
.stage-beam {
  position: absolute; left: 0; right: 0; top: var(--vp-nav-height); bottom: 16%;
  background: linear-gradient(to bottom, var(--stage-beam-color), transparent 96%);
  clip-path: polygon(43% 0, 57% 0, 80% 100%, 20% 100%);
  filter: blur(22px);
  opacity: var(--stage-beam);
}
.stage-beam.core { clip-path: polygon(47% 0, 53% 0, 66% 100%, 34% 100%); filter: blur(14px); opacity: calc(var(--stage-beam) * 0.7); }
.stage-dust { position: absolute; inset: 0; opacity: var(--stage-dust); }
.stage-dust span {
  position: absolute; border-radius: 50%;
  background: var(--stage-beam-color);
  box-shadow: 0 0 6px var(--stage-beam-color);
  animation: oa-drift linear infinite;
}
@keyframes oa-drift {
  0% { transform: translate(0, 0); opacity: 0; }
  15% { opacity: 1; }
  85% { opacity: 1; }
  100% { transform: translate(18px, -70px); opacity: 0; }
}

/* The floor */
.stage-floor {
  position: absolute; left: 0; right: 0; bottom: 22px; height: 24%;
  overflow: hidden; perspective: 420px; perspective-origin: 50% 0%;
}
.stage-planks {
  position: absolute; left: -45%; width: 190%; bottom: 0; height: 260%;
  transform: rotateX(64deg); transform-origin: 50% 100%;
}
.stage-floor-depth { position: absolute; inset: 0; background: linear-gradient(to bottom, var(--stage-floor-depth), transparent 75%); box-shadow: 0 10px 18px -8px rgba(0, 0, 0, 0.55) inset; }
.stage-pool {
  position: absolute; inset: 0;
  background: radial-gradient(30% 85% at 50% 42%, var(--stage-pool-color), transparent 70%);
  mix-blend-mode: screen;
  opacity: var(--stage-pool);
}

/* The front edge of the stage, with footlight hoods */
.stage-lip {
  position: absolute; left: 0; right: 0; bottom: 0; height: 22px;
  background: linear-gradient(to bottom, var(--stage-trim-light), var(--stage-trim) 40%);
  box-shadow: 0 -1px 0 rgba(255, 255, 255, 0.08) inset;
  display: flex; justify-content: space-around; align-items: flex-start;
  padding: 0 12%;
}
.stage-light {
  position: relative; width: 28px; height: 9px; margin-top: -5px;
  border-radius: 6px 6px 3px 3px;
  background: linear-gradient(to bottom, #1a1410, #050403);
}
.stage-light::after {
  content: ""; position: absolute; left: 4px; right: 4px; top: -2px; height: 4px; border-radius: 4px;
  background: var(--stage-bulb);
  box-shadow: 0 -14px 34px 10px var(--stage-bulb-glow);
}

/* The velvet legs */
/* The legs and border hang below the nav bar, so the site name and links stay clear. */
.stage-curtain {
  position: absolute; top: var(--vp-nav-height); bottom: 0;
  width: clamp(40px, 10vw, 170px); height: calc(100% - var(--vp-nav-height));
  filter: drop-shadow(6px 0 14px rgba(0, 0, 0, 0.45));
}
.stage-curtain.left { left: 0; }
.stage-curtain.right { right: 0; transform: scaleX(-1); }
.velvet-nap { mix-blend-mode: overlay; }
.velvet-rim { mix-blend-mode: screen; }

/* The border */
.stage-border {
  position: absolute; left: 0; right: 0; top: var(--vp-nav-height);
  height: clamp(44px, 6.5vw, 96px);
  filter: drop-shadow(0 10px 14px rgba(0, 0, 0, 0.45));
}
.stage-border svg { display: block; width: 100%; height: 100%; }
.stage-braid {
  position: absolute; left: 0; right: 0; bottom: 0; height: 5px;
  background: linear-gradient(to bottom, var(--stage-gold), var(--stage-gold-dark));
}
.stage-fringe {
  position: absolute; left: 0; right: 0; bottom: -14px; height: 14px;
  background: repeating-linear-gradient(90deg, var(--stage-gold) 0 1.5px, var(--stage-gold-dark) 1.5px 2.5px, transparent 2.5px 4px);
  -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent);
  mask-image: linear-gradient(to bottom, #000 40%, transparent);
}

/* The lens */
.stage-vignette {
  position: absolute; inset: 0;
  background: radial-gradient(75% 85% at 50% 48%, transparent 55%, var(--stage-vignette));
}
.stage-film { position: absolute; inset: 0; opacity: var(--stage-grain); mix-blend-mode: overlay; }

/* Footage of a real stage. The house lights are a light wash in the light theme, and darkness in the dark theme. */
.stage-footage {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 40%;
  filter: var(--stage-footage-filter);
  transition: filter 0.8s ease;
}
.stage-house { position: absolute; inset: 0; background-color: var(--stage-house); }
.stage-spotlight {
  position: absolute; inset: 0;
  background: radial-gradient(48% 62% at 50% 46%, transparent 0 35%, var(--stage-dim) 100%);
  opacity: var(--stage-spot-dim);
}
.stage-fade {
  position: absolute; left: 0; right: 0; bottom: 0; height: 22%;
  background: linear-gradient(to bottom, transparent, var(--vp-c-bg));
}

@media (max-width: 640px) {
  .stage-light:nth-child(even) { display: none; }
  .stage-dust span:nth-child(odd) { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .stage * { transition: none; }
  .stage-dust span { animation: none; }
}
</style>
