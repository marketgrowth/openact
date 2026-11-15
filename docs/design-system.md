---
title: Design system
description: The OpenAct Promptbook. The tokens, rules and checks that people and coding agents use to build OpenAct apps.
---

# Design system: the Promptbook

The Promptbook is the design system for OpenAct apps. Read it before you build a screen. Give it to your coding agent before it builds a screen.

In a theater, the prompt book is the stage manager's master copy of the show. It holds the script, every cue and every move. The crew works from it. The OpenAct Promptbook does the same job for apps. It holds the tokens, the rules and the checks in one place.

- The page for people: [openact.ing/design](https://openact.ing/design)
- The copy for agents: [openact.ing/design/promptbook.md](https://openact.ing/design/promptbook.md) and [promptbook.json](https://openact.ing/design/promptbook.json)
- The source: `packages/ui/promptbook.json` and `packages/ui/src/theme.css`

## Start with your agent

Paste this prompt into Claude Code, Codex or another coding agent before you build an OpenAct app:

```text
You build an app for OpenAct. Before you write UI code, read the OpenAct
Promptbook at https://openact.ing/design/promptbook.md and AGENTS.md.

- Pick colors by intent from the Promptbook tokens. Never write a hex value.
- Build screens from the blocking patterns and the @openact/ui components.
- Show agent work with the AgentState component and its five states.
- Write all text in ASD-STE100 style: short sentences, active voice.
- If the app needs an accent, run: npm run design -- seed <app-id> <hue>
- Before you finish, run: npm run design -- check, then npm test.
- In the pull request, list the cues that need a review by a person.
```

## Principles

1. **Written for agents first.** The source is a JSON file and a Markdown file, not a picture. An agent can read every rule. A person can read every rule too.
2. **Intent, not values.** Pick a token by what it means. Use `status-done` for a done task. Never pick a green because it looks good. The values can change. The meaning stays.
3. **Seeds, not palettes.** A new app gives one seed: a hue. The design script makes the light and dark values and tests their contrast. Agents do not invent palettes.
4. **Agents have their own states.** Agent work has five states: think, act, wait, done and fail. Each state has its own token and icon. A person can always see what the agent does.
5. **Every rule has a check.** A rule is a cue. Each cue has a check: a script, a test or a review by a person. The script runs with the unit tests.

## Tokens

Every color is a CSS custom property in `packages/ui/src/theme.css`. Each token has a light value and a dark value. Tailwind classes use the tokens, such as `bg-card`, `text-muted-foreground` and `text-agent-wait`.

| Group | What it holds | Examples |
| --- | --- | --- |
| Surface | The planes that content sits on. | `background`, `card`, `muted`, `border`, `scrim` |
| Action | Things a person can do. | `primary`, `secondary`, `accent`, `destructive` |
| Brand | The OpenAct identity: Playbill ink with a stage gold cue. | `brand`, `brand-gold` |
| Meaning | Colors that carry meaning. Never use them for decoration. | `status-doing`, `priority-high`, `live`, `warn` |
| Agent | The five states of agent work. | `agent-think`, `agent-act`, `agent-wait`, `agent-done`, `agent-fail` |
| Stage | Fixed surfaces that look the same in both themes. | `stage`, `paper`, `desk` |
| Identity | Colors that tell items apart. They have no meaning. | `--pc-teal`, `--av-3` |

The full list, with each value and its intent, is in [promptbook.json](https://openact.ing/design/promptbook.json).

### Pick a token

Ask what the color means, not what it looks like.

| You want to show | Use |
| --- | --- |
| A task that is done | `text-status-done` |
| A warning that needs no action now | `Notice tone="warn"` |
| An action that deletes data | `Button variant="destructive"` |
| An agent step that waits for a person | `AgentState state="wait"` |
| Secondary text, such as a date | `text-muted-foreground` |
| The shade behind a dialog | `bg-scrim` |

### Add a token

1. Add the light value to `:root` and the dark value to `.dark` in `theme.css`.
2. Add `--color-<name>: var(--<name>)` to `@theme inline`, so Tailwind makes the class.
3. Add the token and its intent to a group in `packages/ui/promptbook.json`.
4. If people read text in the color, add the pair to `contrast.text`. If it is a mark or a line, add it to `contrast.graphic`.
5. Run `npm run design -- check`.

### Give an app an accent

Most apps need no accent. The shared tokens are enough. If your app needs one, give a hue from 0 to 360:

```sh
npm run design -- seed advisory 160
```

The script makes a light value and a dark value for the hue. Each value has a contrast of 4.6:1 or more on the page and on cards. It also picks a text color for fills of the accent. Paste the output into `theme.css`. App tokens start with the app id, such as `--app-advisory-accent`.

## Agent states

OpenAct agents work in front of people. People must always see what the agent does. Every agent surface uses the same five states, so people learn one set of signs.

| State | Token | Icon | Use it when |
| --- | --- | --- | --- |
| think | `agent-think` | dots | The agent reads and plans. Say what it reads, such as "Reading 12 tasks". |
| act | `agent-act` | bot | The agent runs a tool. Name the tool in plain words, such as "Moving 3 tasks". |
| wait | `agent-wait` | lock | The agent needs a person. Show the change with Approve and Reject buttons. |
| done | `agent-done` | check | The step finished. Say what changed. |
| fail | `agent-fail` | x | The step failed or a person rejected it. Say what to do next. |

Use the `AgentState` component from `@openact/ui`:

```tsx
import { AgentState } from "@openact/ui";

<AgentState state="act">Moving 3 tasks to Review</AgentState>
<AgentState state="wait">Waiting for your approval</AgentState>
```

Deletes and people changes always wait for a person. The agent never goes past the wait state on its own. Agent states never use the brand colors, so agent work never looks like a brand message.

## Type, shape and motion

| Part | Rule |
| --- | --- |
| Type | Open Sans for text in apps. IBM Plex Mono for labels, code and ids. The website and the docs site use IBM Plex Sans. Use `tabular` for dates, counts and money. |
| Label | `font-mono text-[11px] uppercase tracking-wider text-muted-foreground` |
| Body | `text-sm` |
| Title | `text-base font-semibold` |
| Radius | `rounded-md` for controls, `rounded-lg` for cards, `rounded-full` for avatars and pills. |
| Enter | `ease-enter`, 200 ms (`--motion-base`) |
| Leave | `ease-exit`, 120 ms (`--motion-fast`). Leave faster than you enter. |
| Move | `ease-move` for reorder and drag. |

Every animation stops when the person asks for reduced motion. The theme does this for all elements.

## Blocking

Blocking is where the actors stand on the stage. In OpenAct, it is where the parts of a screen go. Every signed-in page starts with `SiteHeader` and puts its content in `PageBody`. Then pick one pattern:

| Pattern | Use it for | Parts |
| --- | --- | --- |
| Board | Items that move through stages. | Columns of cards |
| List and detail | A list of items and the open item. | A list and a `Sheet` |
| Document | Long text on a page. | The `desk` and a `paper` sheet |
| Form | Settings and new items. | `Field` rows |
| Agent panel | A chat with the agent beside the work. | Agent states and an approval group |

## Cues

A cue is a rule with a check. The script checks run with `npm test`. A person checks the review cues in the pull request.

| Cue | Rule | Check |
| --- | --- | --- |
| C01 | Use theme tokens for every color. Do not write hex, rgb or oklch values or fixed Tailwind palette classes in components. | script |
| C02 | Give every token a light value and a dark value. | script |
| C03 | Text has a contrast of 4.5:1 or more on its surface, in both themes. | script |
| C04 | Status marks, icons and lines that carry meaning have a contrast of 3:1 or more. | script |
| C05 | Pick a token by its intent. Do not pick a token by its color. | review |
| C06 | Use one primary action on a screen. | review |
| C07 | Every signed-in page starts with SiteHeader and puts its content in PageBody. | review |
| C08 | Build from the shadcn/ui components in @openact/ui. Use Lucide icons through Icon. | review |
| C09 | Show agent work with the five agent states and the AgentState component. Never show agent work in the brand colors. Agent states must look different from the brand and from each other. | script |
| C10 | An agent change that deletes data or changes people waits for a person. Show Approve and Reject. | test |
| C11 | Use the motion tokens. Stop every animation when the person asks for reduced motion. | review |
| C12 | Write text in ASD-STE100 style: short sentences, active voice, one idea per sentence, American spelling. | review |
| C13 | Do not use em dashes in text. | script |
| C14 | Start the name of an app token with the app id, such as --app-docs-accent. | script |
| C15 | Look at every new screen in light and dark, on a phone and on a desktop, before you open a pull request. | review |

If a line must have a literal color, such as an email template, add the comment `promptbook-allow` on that line. Say why in the pull request.

## The method: a design system for a new app

Use these six steps when you start an OpenAct app with a coding agent. The person decides. The agent does the work and runs the checks.

| Step | The person | The agent |
| --- | --- | --- |
| 01 Script | Writes one sentence about who uses the app and what they do. | Reads the Promptbook. Picks the blocking pattern for each screen. |
| 02 Cast | Picks one hue for the app accent, if the app needs one. | Runs `npm run design -- seed <app-id> <hue>`. Pastes the tokens into `theme.css`. |
| 03 Block | Approves the list of screens. | Builds each screen from the pattern and `@openact/ui` components. |
| 04 Cue | Says which agent actions need approval. | Shows agent work with `AgentState`. Writes all text in ASD-STE100 style. |
| 05 Rehearse | Looks at the screens in light and dark, on a phone and a desktop. | Runs `npm run design -- check` and `npm test`. Fixes every problem. |
| 06 Open | Reviews the pull request and merges it. | Opens a pull request. Lists the cues that need a review by a person. |

## Commands

| Command | What it does |
| --- | --- |
| `npm run design -- check` | Tests the script cues: tokens, contrast, literal colors, em dashes and app token names. |
| `npm run design -- seed <app-id> <hue>` | Makes an app accent from one hue. |
| `npm run design -- build` | Publishes the Promptbook to `landing/public/design` for openact.ing/design. |

`npm test` runs the check and fails if the published copy is out of date.
