---
title: Components
description: The UI components in @openact/ui. Look in Arc first, then shadcn/ui. Build a new component only when neither has one.
---

# Components

All OpenAct UI comes from one kit: `@openact/ui`. The core, the free apps, the Director apps and third-party apps use the same components. This keeps every screen uniform. The Promptbook tokens set the colors, so you can change the look later in one place.

`@openact/ui` holds two sets of components:

| Set | What it is | Import |
| --- | --- | --- |
| Arc | 118 React components with motion built in, from [Arc](https://uiarc.dev) (MIT). The full list is in [`packages/ui/src/arc/CATALOG.md`](https://github.com/marketgrowth/openact/blob/main/packages/ui/src/arc/CATALOG.md). | `@openact/ui/arc/<name>` |
| shadcn/ui | The components that the shell is built from: sidebar, sheet, table, input, label and more. | `@openact/ui/components/<name>` |

## Find a component

Do these steps in this order before you build UI.

1. **Look in Arc.** Read `packages/ui/src/arc/CATALOG.md`. If Arc has a component for the job, use it. Each row has a live preview at `https://uiarc.dev/components/<name>`.
2. **Look in shadcn/ui.** If Arc has no component for the job, use the one in `packages/ui/src/components`.
3. **Build a new component.** If neither set has one, build it in `packages/ui/src/components`, so every app can use it. Use Promptbook tokens for every color. Do not build a component inside one app.

Use one component for one job in a screen. For example, do not put an Arc button and a shadcn/ui button in the same toolbar. In a screen that uses shadcn/ui, keep shadcn/ui until the whole screen moves to Arc.

The shell layout does not change. Every signed-in page starts with `SiteHeader` and puts its content in `PageBody`. Show agent work with `AgentState`.

## Use an Arc component

```tsx
import { Button } from "@openact/ui/arc/button";
import { SegmentedControl } from "@openact/ui/arc/segmented-control";

<Button variant="secondary" loading={saving}>Save</Button>
<SegmentedControl label="View" value={view} onValueChange={setView} options={views} />
```

Every component has a named export. The props and the notes are in the component's file, `packages/ui/src/arc/<name>/<name>.tsx`.

## How Arc fits OpenAct

`npm run arc` copies Arc components into `packages/ui/src/arc` and changes them so they fit OpenAct:

- **Tokens.** Arc tokens get an `--arc-` prefix. `packages/ui/src/arc/arc.css` maps each one to a Promptbook token. For example, `--arc-accent` is `primary`, `--arc-success` is `status-done` and `--arc-surface` is `card`. Arc never changes a shadcn/ui token.
- **Shape and type.** Arc controls use the OpenAct radius and control heights, and the app font, Open Sans. Arc and shadcn/ui controls line up in one row.
- **Dark mode.** Arc follows the `.dark` class on `<html>`, as the rest of the app does.
- **Focus.** Arc classes get an `arc_` prefix in the build. A keyboard focus outline in the `ring` color applies only to Arc elements.
- **Motion.** Arc uses [Motion](https://motion.dev). Each animation has a reduced motion path, and the reduced motion rule in `theme.css` (cue C11) also applies.

To change how Arc components look, change the Promptbook token in `theme.css`. Do not change the files in `packages/ui/src/arc/<name>/`. `npm run arc -- update` writes over them.

## Commands

| Task | Command |
| --- | --- |
| List Arc components and see which are installed | `npm run arc -- list` |
| Install a component that a later Arc release adds | `npm run arc -- add <name>` |
| Move to a new Arc commit | `npm run arc -- update --ref <sha>` |
| Write the catalog again | `npm run arc -- catalog` |

The pinned Arc commit and the installed components are in `packages/ui/arc.json`. After an update, run `npm run typecheck`, `npm test` and `npm run build`, and look at the changed components in both themes.

## Components built here

These are in `packages/ui/src/components`, because neither Arc nor shadcn/ui has them.

| Component | Use | Import |
| --- | --- | --- |
| Radial cluster | Many small items in a few groups, as wedges around a hub, with a dot per item on rings. Colors come from the project identity tokens, one per group. Show a table view next to it. | `@openact/ui/components/radial-cluster` |

## What is not here

- **Arc blocks.** Arc also has page sections, such as hero sections and footers. Some need Next.js. They are not installed. Public pages are built with the Pages app.
- **Arc Pro.** The paid Arc Pro items are not in the Arc repository, so they are not here.
