import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import StageBackdrop from "./components/StageBackdrop.vue";
import HomeIntro from "./components/HomeIntro.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  // The home page hero stands on a theater stage. A short section follows it, before the feature cards.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "home-hero-before": () => h(StageBackdrop),
      "home-features-before": () => h(HomeIntro)
    })
};
