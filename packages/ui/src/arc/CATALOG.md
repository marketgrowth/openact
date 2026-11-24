# Arc components in @openact/ui

Written by `npm run arc -- catalog`. Do not edit.

Source: [arc-library](https://github.com/kuratlielia/arc-library) at `8302b52ed9dc` (MIT). Live previews: https://uiarc.dev/components/<name>.

Import a component from `@openact/ui/arc/<name>`, for example `import { Button } from "@openact/ui/arc/button";`.
Read [docs/components.md](../../../../docs/components.md) before you pick a component.

## Actions

| Name | What it is | Import |
| --- | --- | --- |
| Action button | A compact button for frequent toolbar actions. | `@openact/ui/arc/action-button` |
| Action swap | Swap an action label while preserving its place and intent. | `@openact/ui/arc/action-swap` |
| Button | A clear, responsive action with quiet secondary states. | `@openact/ui/arc/button` |
| Button group | Related actions joined into one surface with hairline dividers: a hover highlight glides between segments, the pressed one answers in place, and an attached menu can close the row. | `@openact/ui/arc/button-group` |
| Confirm morph | A destructive button that morphs into an inline confirmation, a spinner, and a result with undo. | `@openact/ui/arc/confirm-morph` |
| Context menu | Secondary actions kept close to the selected object. | `@openact/ui/arc/context-menu` |
| Copy button | Copy a value with immediate confirmation. | `@openact/ui/arc/copy-button` |
| Dropdown menu | A focused list of actions anchored to a trigger. | `@openact/ui/arc/dropdown-menu` |
| Expanding button group | Icon buttons in a compact group: the one you point at or focus grows to reveal its label while its neighbours slide aside, and an action confirms in place. | `@openact/ui/arc/expanding-button-group` |
| Floating button group | Separate soft buttons in a quiet tray, with one shared highlight that morphs from button to button as you move, and a pressed state that settles in place. | `@openact/ui/arc/floating-button-group` |
| Hold to confirm | Confirm a destructive action by holding, not tapping. | `@openact/ui/arc/hold-to-confirm` |
| Icon morph | Icons that morph between states: menu to close, play to pause, copy to check, and more. | `@openact/ui/arc/icon-morph` |
| Reactions | Acknowledge a post in one tap, with counts that roll. | `@openact/ui/arc/reactions` |
| Split button | A primary action with a menu of nearby alternatives. | `@openact/ui/arc/split-button` |
| Swipe actions | Reveal row actions with a swipe, or from the same actions in a menu. | `@openact/ui/arc/swipe-actions` |
| Theme switcher | Four smooth ways to move between light and dark appearance. | `@openact/ui/arc/theme-switch` |
| Eclipse | The next appearance crosses the page like an eclipse. | `@openact/ui/arc/theme-switch` |
| Rise | The next appearance rises into place. | `@openact/ui/arc/theme-switch` |
| Split | The next appearance opens from a slim center seam. | `@openact/ui/arc/theme-switch` |
| User menu | Your account, settings, theme, and sign out behind the avatar. Opens as a bottom sheet on phones. | `@openact/ui/arc/user-menu` |

## Data

| Name | What it is | Import |
| --- | --- | --- |
| Activity heatmap | See a year of activity at a glance, one square per day. | `@openact/ui/arc/activity-heatmap` |
| Animated counter | Give changing totals a clear sense of movement. | `@openact/ui/arc/animated-counter` |
| Avatar | A compact identity marker for people and accounts. | `@openact/ui/arc/avatar` |
| Avatar group | Show a team or set of contributors in a small space. | `@openact/ui/arc/avatar-group` |
| Badge | A small label for status, category, or metadata. | `@openact/ui/arc/badge` |
| Bar chart | Compare one measure across days and scrub any bar for its value. | `@openact/ui/arc/bar-chart` |
| Brush chart | A dense time series with an overview strip: drag a window to zoom, resize it by its handles, and read events in place. | `@openact/ui/arc/brush-chart` |
| Card | A contained group of related content and actions. | `@openact/ui/arc/card` |
| Card stack | Review a deck one card at a time, with a throw and an undo. | `@openact/ui/arc/card-stack` |
| Carousel | Browse a row of slides by dragging, flicking, or arrowing through them. | `@openact/ui/arc/carousel` |
| Chat thread | A chat thread with grouped messages, reactions, read receipts, typing, and a composer with attachments. | `@openact/ui/arc/chat-thread` |
| Code block | Present code with legible hierarchy and copy access. | `@openact/ui/arc/code-block` |
| Comment thread | Threaded comments with replies, reactions, mentions, inline edit, and resolve. | `@openact/ui/arc/comment-thread` |
| Donut chart | A donut whose arcs morph between datasets, with the active value rolling into the center. | `@openact/ui/arc/donut-chart` |
| Empty state | A useful next step when there is nothing to show yet. | `@openact/ui/arc/empty-state` |
| Filter toolbar | Keep collection filters close and easy to reset. | `@openact/ui/arc/filter-toolbar` |
| Gauge | Show a value against a known range. | `@openact/ui/arc/gauge` |
| Image compare | Drag a divider across two images to see what changed. | `@openact/ui/arc/image-compare` |
| JSON viewer | A collapsible JSON tree with search, paging for long arrays, and copy value or path. | `@openact/ui/arc/json-viewer` |
| Line chart | A multi-series line chart with a gliding crosshair, legend toggles, and paths that morph between ranges. | `@openact/ui/arc/line-chart` |
| Metric card | A compact summary for a number that needs context. | `@openact/ui/arc/metric-card` |
| Pagination | Move through a long collection with clear bounds. | `@openact/ui/arc/pagination` |
| Reorderable list | Organize items with direct drag and drop. | `@openact/ui/arc/reorderable-list` |
| Ridgeline | Overlapping distributions, one ridge per group: hover to lift a ridge and read its quartiles, switch datasets and every curve morphs. | `@openact/ui/arc/ridgeline` |
| Slope chart | Before and after on two axes: lines draw in, rank moves sit beside each value, and switching datasets slides every line to its new slope. | `@openact/ui/arc/slope-chart` |
| Sortable data table | Compare structured records with sortable columns. | `@openact/ui/arc/sortable-data-table` |
| Sparkline | Show a compact trend beside a value. | `@openact/ui/arc/sparkline` |
| Streamgraph | Layered streams on a wiggle baseline that morph between ranges, with a layer you can isolate and read week by week. | `@openact/ui/arc/streamgraph` |
| Timeline | Follow what happened, newest first, grouped by day. | `@openact/ui/arc/timeline` |
| Tree table | A table with nested rows, tri-state selection, hierarchy-preserving sort, and lazy-loaded children. | `@openact/ui/arc/tree-table` |
| Tree view | Navigate nested folders and structured content. | `@openact/ui/arc/tree-view` |
| Treemap | A squarified treemap: click to drill and the tiles grow to fill the view, with a breadcrumb back and metrics that morph every tile. | `@openact/ui/arc/treemap` |
| Waffle chart | A ten by ten unit chart where every cell is one percent, and cells fly to their new group when the data changes. | `@openact/ui/arc/waffle-chart` |

## Disclosure

| Name | What it is | Import |
| --- | --- | --- |
| Accordion | Progressively reveal supporting information in place. | `@openact/ui/arc/accordion` |
| Bottom sheet | A sheet that rests at a peek or full height and follows your finger. | `@openact/ui/arc/bottom-sheet` |
| Breadcrumb | Show where a page sits in a hierarchy. | `@openact/ui/arc/breadcrumb` |
| Dialog | A focused surface for decisions that need attention. | `@openact/ui/arc/dialog` |
| Drawer | A temporary side surface for focused work. | `@openact/ui/arc/drawer` |
| Expandable card | Give a dense card more room when requested. | `@openact/ui/arc/expandable-card` |
| Expandable text | Long text clamped to a few lines with a soft fade that glides open with Read more and closes with Show less, shown only when the text overflows. | `@openact/ui/arc/expandable-text` |
| Hover card | Preview a person or link on hover or focus without leaving the page. | `@openact/ui/arc/hover-card` |
| Popover | A small anchored surface for contextual information. | `@openact/ui/arc/popover` |
| Resizable panels | Trade space between panes by dragging the divider between them. | `@openact/ui/arc/resizable-panels` |
| Scroll area | A native scroll container with thin overlay scrollbars and edge fades that appear only when content overflows. | `@openact/ui/arc/scroll-area` |
| Tabs | Switch between related content in the same context. | `@openact/ui/arc/tabs` |
| Tooltip | Short supporting text for unfamiliar controls. | `@openact/ui/arc/tooltip` |

## Feedback

| Name | What it is | Import |
| --- | --- | --- |
| Alert | A persistent message that helps people recover or continue. | `@openact/ui/arc/alert` |
| Announcement bar | A top banner that rotates messages, counts down, and collapses smoothly when dismissed. | `@openact/ui/arc/announcement-bar` |
| Cookie consent | A consent bar that morphs into preferences and folds into a reopen button. | `@openact/ui/arc/cookie-consent` |
| Countdown | A launch countdown with rolling digits that morphs into a live state at zero. | `@openact/ui/arc/countdown` |
| Onboarding checklist | Guide a new workspace through setup, one step at a time. | `@openact/ui/arc/onboarding-checklist` |
| Progress | Show how much of a known task is complete. | `@openact/ui/arc/progress` |
| Skeleton | Reserve space while content is still loading. | `@openact/ui/arc/skeleton` |
| Stepper | Show where a person is in a multi-step flow and what is done. | `@openact/ui/arc/stepper` |
| Toast | Brief confirmation for a completed background action. | `@openact/ui/arc/toast` |
| Toast stack | Stack short results at the edge until you reach for them. | `@openact/ui/arc/toast-stack` |
| Usage meter | Show what fills an allowance and how close it is to the limit. | `@openact/ui/arc/usage-meter` |

## Inputs

| Name | What it is | Import |
| --- | --- | --- |
| Billing toggle | A monthly and yearly switch with a savings badge and prices that roll to the new amount. | `@openact/ui/arc/billing-toggle` |
| Calendar | Browse dates in a clear, compact month view. | `@openact/ui/arc/calendar` |
| Checkbox | A binary choice with a precise, legible state. | `@openact/ui/arc/checkbox` |
| Chip group | Filter by a few facets with chips that morph as you pick them. | `@openact/ui/arc/chip-group` |
| Color picker | A swatch that grows into a picker with format morphing, eyedropper, saved swatches, and contrast readout. | `@openact/ui/arc/color-picker` |
| Combobox | Search and select from a list without leaving the field. | `@openact/ui/arc/combobox` |
| Date picker | Choose a date without losing context. | `@openact/ui/arc/date-picker` |
| Date range picker | A range picker that grows from its trigger into two months with presets and a stretching range highlight. | `@openact/ui/arc/date-range-picker` |
| Elastic slider | A slider that stretches like rubber past its ends, with a swaying value tag and detents the thumb clicks into. | `@openact/ui/arc/elastic-slider` |
| Expanding search | An icon that morphs into a search field with results beneath it. | `@openact/ui/arc/expanding-search` |
| File dropzone | A generous target for dropping one or more files. | `@openact/ui/arc/file-dropzone` |
| Inline edit | Rename in place: the text becomes a field without moving. | `@openact/ui/arc/inline-edit` |
| Input | A single line field with clear labels and useful states. | `@openact/ui/arc/input` |
| Mention input | A textarea with @people and #channel mentions that act as single tokens, with suggestions at the caret. | `@openact/ui/arc/mention-input` |
| Money input | A currency field with live grouping, stable width, rolling digits, and minor-unit output. | `@openact/ui/arc/money-input` |
| Morph select | A select whose trigger grows into the list, with a gliding highlight and type-ahead. | `@openact/ui/arc/morph-select` |
| Multi-select | Select several values while keeping the field readable. | `@openact/ui/arc/multi-select` |
| Number field | Enter a bounded number with clear increment controls. | `@openact/ui/arc/number-field` |
| Password field | Capture sensitive text with a visible reveal control. | `@openact/ui/arc/password-field` |
| Password strength | Show how strong a new password is while it is typed. | `@openact/ui/arc/password-strength` |
| Phone input | A phone field with a country picker, formatting as you type, and E.164 output. | `@openact/ui/arc/phone-input` |
| Radio cards | Selectable option cards with a sliding selection ring, price and description slots, and radio keyboard behavior. | `@openact/ui/arc/radio-cards` |
| Radio group | Choose one option from a visible set. | `@openact/ui/arc/radio-group` |
| Range histogram slider | A price range over a live histogram of the data, lighting the bars inside the range and settling on bar edges. | `@openact/ui/arc/range-histogram-slider` |
| Rating | A simple, accessible way to capture a numeric opinion. | `@openact/ui/arc/rating` |
| Rich text editor | A lightweight editor with markdown shortcuts, a floating toolbar, a slash menu, and HTML and markdown output. | `@openact/ui/arc/rich-text-editor` |
| Ruler slider | A tape of ticks that slides under a fixed needle, with momentum, snapping, and a rolling readout. | `@openact/ui/arc/ruler-slider` |
| Scrub input | A Figma-style number field: drag the label to scrub, or type values, units, and arithmetic. | `@openact/ui/arc/scrub-input` |
| Search field | A recognizable search entry point with clear affordances. | `@openact/ui/arc/search-field` |
| Segmented control | Switch between a small set of related views. | `@openact/ui/arc/segmented-control` |
| Select | A compact choice field with a keyboard friendly menu. | `@openact/ui/arc/select` |
| Shortcut recorder | Record key combinations into key caps, with conflict warnings, Kbd, and a searchable cheatsheet. | `@openact/ui/arc/shortcut-recorder` |
| Signature pad | Smooth ink that thins with speed, with undo, replay, and PNG or SVG export. | `@openact/ui/arc/signature-pad` |
| Slider | Pick a value or a range on a track that follows your finger. | `@openact/ui/arc/slider` |
| Switch | A tactile toggle for settings that take effect immediately. | `@openact/ui/arc/switch` |
| Tag input | Turn short text values into removable tags. | `@openact/ui/arc/tag-input` |
| Textarea | A multiline field for notes, descriptions, and longer text. | `@openact/ui/arc/textarea` |
| Time picker | Choose a time with sensible keyboard behavior. | `@openact/ui/arc/time-picker` |
| Toggle group | A row of icon or text toggles, single or multiple: one pressed fill glides between options, or each fades in on its own and neighbours join, as in a formatting toolbar. | `@openact/ui/arc/toggle-group` |

## Special

| Name | What it is | Import |
| --- | --- | --- |
| Slot text | Text and numbers that spin into their new value on staggered slot machine reels. | `@openact/ui/arc/slot-text` |

## Text

| Name | What it is | Import |
| --- | --- | --- |
| In-view title | Bring a section title in as it scrolls into view. | `@openact/ui/arc/in-view-title` |
| Text morph | Morph a label into its next state, letter by letter. | `@openact/ui/arc/text-morph` |
| Text reveal | Reveal a short piece of content with restrained motion. | `@openact/ui/arc/text-reveal` |
| Text shimmer | Show ongoing work with a calm light across the words. | `@openact/ui/arc/text-shimmer` |
