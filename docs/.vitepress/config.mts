import { defineConfig } from "vitepress";

/*
 * The OpenAct docs site, published at https://docs.openact.app.
 * The pages are the Markdown files in this folder, so they also read well on GitHub.
 */
export default defineConfig({
  title: "OpenAct",
  description: "An open source framework for agentic business apps on Cloudflare. Start with the Projects app, add apps from the directory, or build your own.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["README.md"],
  ignoreDeadLinks: "localhostLinks",
  sitemap: { hostname: "https://docs.openact.app" },
  head: [
    ["link", { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    ["link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Playfair+Display:ital,wght@0,700;0,800;0,900;1,700&display=swap" }],
    ["meta", { property: "og:site_name", content: "OpenAct docs" }]
  ],
  themeConfig: {
    logo: { light: "/logo.svg", dark: "/logo-dark.svg", alt: "OpenAct" },
    siteTitle: "OpenAct",
    nav: [
      { text: "Guide", link: "/getting-started", activeMatch: "^/(getting-started|companies|apps|permissions|docs-app)" },
      { text: "App directory", link: "/directory" },
      { text: "Reference", link: "/reference/sdk", activeMatch: "^/reference/" },
      { text: "Colophon", link: "/colophon" }
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Get started", link: "/getting-started" },
          { text: "Companies and access", link: "/companies" }
        ]
      },
      {
        text: "Apps",
        items: [
          { text: "App directory", link: "/directory" },
          { text: "Docs", link: "/docs-app" },
          { text: "Build an app", link: "/apps" },
          { text: "Permissions", link: "/permissions" }
        ]
      },
      {
        text: "Reference",
        items: [
          { text: "SDK", link: "/reference/sdk" },
          { text: "AG-UI agent protocol", link: "/reference/ag-ui" }
        ]
      },
      { text: "About", items: [{ text: "Contributions", link: "/contribute" }, { text: "Colophon", link: "/colophon" }] }
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/marketgrowth/openact" }],
    editLink: { pattern: "https://github.com/marketgrowth/openact/edit/main/docs/:path", text: "Edit this page on GitHub" },
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    footer: { message: "Apache License 2.0. Made by MarketGrowth.", copyright: "Copyright 2026 MarketGrowth" }
  }
});
