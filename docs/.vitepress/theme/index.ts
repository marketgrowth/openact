import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import StageBackdrop from "./components/StageBackdrop.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  // The home page hero stands on a theater stage.
  Layout: () => h(DefaultTheme.Layout, null, { "home-hero-before": () => h(StageBackdrop) })
};
