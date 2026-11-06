<script setup lang="ts">
import { useData } from "vitepress";

/* A short section between the home hero and the feature cards. The text comes from `intro` in the home page frontmatter. */
const { frontmatter } = useData();
</script>

<template>
  <section v-if="frontmatter.intro" class="home-intro">
    <h2 class="home-intro-title">{{ frontmatter.intro.title }}</h2>
    <p class="home-intro-text">{{ frontmatter.intro.text }}</p>
  </section>
</template>

<style scoped>
.home-intro {
  position: relative; z-index: 1;
  max-width: 760px; margin: 0 auto; padding: 72px 24px 8px;
  text-align: center;
}
.home-intro-title {
  font-family: var(--oa-display-font);
  font-weight: 800; font-size: clamp(34px, 5vw, 56px); line-height: 1.05; letter-spacing: -0.01em;
  color: var(--vp-c-text-1); margin: 0; border: 0; padding: 0;
}
.home-intro-text {
  margin: 18px auto 0; max-width: 620px;
  font-size: clamp(17px, 1.7vw, 20px); line-height: 1.6; color: var(--vp-c-text-2);
  text-wrap: balance;
}
</style>
