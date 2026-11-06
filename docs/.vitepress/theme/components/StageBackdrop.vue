<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useData } from "vitepress";

/*
 * A theater stage behind the home page hero: a back wall, side curtains, a valance, a wooden floor,
 * a spotlight and footlights. Every color is a theme token, so the house lights come up in the
 * light theme and go down in the dark theme, with a slow fade between them.
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

const scallops = Array.from({ length: 12 }, (_, i) => i * 120);
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
    <div class="stage-wall"></div>
    <div class="stage-glow"></div>
    <div class="stage-beam"></div>
    <div class="stage-floor">
      <div class="stage-planks"></div>
      <div class="stage-pool"></div>
    </div>
    <div class="stage-lip">
      <span v-for="n in lights" :key="n" class="stage-light"></span>
    </div>

    <svg class="stage-curtain left" viewBox="0 0 200 800" preserveAspectRatio="none">
      <path class="cloth" d="M0 0 H200 C176 190 104 360 78 470 C100 560 142 690 156 800 H0 Z" />
      <path class="fold" d="M46 0 C44 200 52 380 70 470 C66 580 52 700 40 800" />
      <path class="fold" d="M96 0 C92 200 82 380 74 470 C84 580 92 700 96 800" />
      <path class="fold" d="M146 0 C134 190 100 370 78 470 C110 570 128 690 136 800" />
      <path class="shine" d="M70 0 C70 200 70 380 74 470 C78 580 74 700 70 800" />
      <ellipse class="tie" cx="76" cy="472" rx="30" ry="9" />
    </svg>
    <svg class="stage-curtain right" viewBox="0 0 200 800" preserveAspectRatio="none">
      <path class="cloth" d="M0 0 H200 C176 190 104 360 78 470 C100 560 142 690 156 800 H0 Z" />
      <path class="fold" d="M46 0 C44 200 52 380 70 470 C66 580 52 700 40 800" />
      <path class="fold" d="M96 0 C92 200 82 380 74 470 C84 580 92 700 96 800" />
      <path class="fold" d="M146 0 C134 190 100 370 78 470 C110 570 128 690 136 800" />
      <path class="shine" d="M70 0 C70 200 70 380 74 470 C78 580 74 700 70 800" />
      <ellipse class="tie" cx="76" cy="472" rx="30" ry="9" />
    </svg>

    <svg class="stage-valance" viewBox="0 0 1440 96" preserveAspectRatio="none">
      <path
        class="cloth"
        :d="'M0 0 H1440 V56 ' + scallops.map((x) => `Q${1440 - x - 60} 96 ${1440 - x - 120} 56`).join(' ') + ' Z'"
      />
      <path class="fringe" :d="'M0 56 ' + scallops.map((x) => `Q${x + 60} 96 ${x + 120} 56`).join(' ')" />
    </svg>
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
    box-shadow 0.8s ease;
}

/* The back wall, with a soft glow where the spotlight lands */
.stage-wall { position: absolute; inset: 0; background-color: var(--stage-wall); }
.stage-glow {
  position: absolute; inset: 0;
  background: radial-gradient(60% 55% at 50% 52%, var(--stage-glow-color), transparent 70%);
  opacity: var(--stage-glow);
}
.stage-beam {
  position: absolute; left: 0; right: 0; top: var(--vp-nav-height); bottom: 18%;
  background: linear-gradient(to bottom, var(--stage-beam-color), transparent 92%);
  clip-path: polygon(44% 0, 56% 0, 78% 100%, 22% 100%);
  opacity: var(--stage-beam);
}

/* The floor: wooden planks that run toward the back */
.stage-floor {
  position: absolute; left: 0; right: 0; bottom: 18px; height: 22%;
  background-color: var(--stage-floor);
  overflow: hidden;
}
.stage-planks {
  position: absolute; inset: -40% -60% 0;
  background: repeating-linear-gradient(90deg, transparent 0 46px, rgba(0, 0, 0, 0.22) 46px 48px);
  transform: perspective(260px) rotateX(58deg);
  transform-origin: 50% 100%;
  opacity: var(--stage-planks);
}
.stage-pool {
  position: absolute; inset: 0;
  background: radial-gradient(36% 70% at 50% 40%, var(--stage-glow-color), transparent 72%);
  opacity: var(--stage-pool);
}

/* The front edge of the stage, with footlights */
.stage-lip {
  position: absolute; left: 0; right: 0; bottom: 0; height: 18px;
  background-color: var(--stage-lip);
  display: flex; justify-content: space-around; align-items: flex-start;
  padding: 0 12%;
}
.stage-light {
  width: 22px; height: 6px; margin-top: -3px; border-radius: 0 0 11px 11px;
  background-color: var(--stage-bulb);
  box-shadow: 0 -10px 24px 6px var(--stage-bulb-glow);
}

/* Curtains and valance */
/* The curtains and valance hang below the nav bar, so the site name and links stay clear. */
.stage-curtain {
  position: absolute; top: var(--vp-nav-height); bottom: 0;
  width: clamp(36px, 9vw, 150px); height: calc(100% - var(--vp-nav-height));
}
.stage-curtain.left { left: 0; }
.stage-curtain.right { right: 0; transform: scaleX(-1); }
.stage-valance { position: absolute; left: 0; right: 0; top: var(--vp-nav-height); width: 100%; height: clamp(40px, 6vw, 84px); }
.cloth { fill: var(--stage-curtain); }
.fold { fill: none; stroke: var(--stage-curtain-shade); stroke-width: 14; opacity: 0.7; }
.shine { fill: none; stroke: var(--stage-curtain-shine); stroke-width: 6; opacity: 0.6; }
.tie { fill: var(--stage-gold); }
.fringe { fill: none; stroke: var(--stage-gold); stroke-width: 3; stroke-dasharray: 2 4; }

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
}
@media (prefers-reduced-motion: reduce) {
  .stage * { transition: none; }
}
</style>
