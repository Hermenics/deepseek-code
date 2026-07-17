---
name: DeepSeek Code
description: A precise, keyboard-first AI coding assistant for the terminal
colors:
  primary-dark: "#00ffff"
  primary-light: "#0000ff"
  text-dark: "#f2f6f7"
  text-light: "#15191a"
  text-muted-dark: "#888888"
  text-muted-light: "#666666"
  surface-dark: "#111118"
  surface-light: "#f0f0f8"
  success-dark: "#4ade80"
  success-light: "#166534"
  warning-dark: "#facc15"
  warning-light: "#854d0e"
  error-dark: "#fb7185"
  error-light: "#be123c"
typography:
  title:
    fontFamily: "terminal monospace"
    fontWeight: 700
    lineHeight: 1
  body:
    fontFamily: "terminal monospace"
    fontWeight: 400
    lineHeight: 1
  label:
    fontFamily: "terminal monospace"
    fontWeight: 400
    lineHeight: 1
spacing:
  xs: "1 column"
  sm: "2 columns"
  md: "4 columns"
components:
  settings-selection:
    textColor: "{colors.primary-dark}"
    typography: "{typography.label}"
    padding: "0 1 column"
  settings-error-dark:
    textColor: "{colors.error-dark}"
    typography: "{typography.body}"
  settings-error-light:
    textColor: "{colors.error-light}"
    typography: "{typography.body}"
---

# Design System: DeepSeek Code

## 1. Overview

**Creative North Star: "The Instrument Panel"**

The interface behaves like a well-made developer instrument: compact, stable, and explicit about current state. The settings center uses the approved two-pane direction from probe B on wide terminals and progressively collapses into a sequential flow as width decreases. It should feel native to the terminal rather than imitate a graphical desktop application.

Hierarchy comes from position, weight, whitespace, and restrained accent use. Settings are rows and aligned regions, not cards. The active category and focused control receive the primary accent; semantic colors are reserved for success, warning, and error.

**Key Characteristics:**

- Keyboard-first, with contextual shortcut guidance.
- Stable viewport and internal scrolling without layout jumps.
- Effective value, source, and override state shown together.
- Restrained color and concise copy.
- Structural adaptation at content-driven terminal widths.

## 2. Colors

The six existing themes remain authoritative. The settings surface consumes semantic theme roles instead of introducing a separate palette.

### Primary

- **Terminal Cyan** (`#00ffff` in the default dark theme): current selection, focused input, and primary action.
- **Terminal Blue** (`#0000ff` in the default light theme): light-theme equivalent of the primary role.

### Neutral

- **Dark Ink** (`#111118`): elevated dark surface where the terminal supports background color.
- **Light Paper** (`#f0f0f8`): elevated light surface.
- **Muted Metadata** (`#888888` dark, `#666666` light): descriptions, paths, origins, and shortcut hints.

### Named Rules

**The One Accent Rule.** Primary color is used only for focus, selection, and a small number of actions. Inactive categories remain neutral.

**The Redundant Signal Rule.** Success, warning, and error always include text or a symbol in addition to color.

## 3. Typography

**Display Font:** terminal monospace
**Body Font:** terminal monospace
**Label/Mono Font:** terminal monospace

**Character:** The user's configured terminal font is the correct font. Hierarchy is created with bold weight, compact labels, alignment, and spacing rather than decorative typography.

### Hierarchy

- **Title** (bold): settings center title and current category.
- **Body** (regular): setting labels, values, and editor content.
- **Label** (regular or bold when focused): categories, scopes, and actions.
- **Metadata** (dim): source, inherited state, descriptions, paths, and shortcut hints.

### Named Rules

**The Stable Measure Rule.** Explanations wrap within the available detail pane and never force navigation or values off-screen.

## 4. Elevation

The TUI is flat. Depth is expressed through full-width dividers, surface tone where supported, and progressive navigation. No shadows or simulated floating cards are used.

### Named Rules

**The Flat Instrument Rule.** Every region belongs to one clear grid. Overlays are reserved for the full settings surface and destructive confirmations.

## 5. Components

### Settings Rows

- **Shape:** one terminal row in compact density, two or more rows only when description or validation requires it.
- **Selected:** leading pointer, primary text, and a full-row focus treatment where terminal capabilities allow.
- **Metadata:** effective value and source align consistently and truncate by priority on narrow terminals.

### Inputs / Fields

- **Style:** visible label, current value, cursor, and concise help.
- **Focus:** primary-colored pointer or border with no animation requirement.
- **Error / Disabled:** semantic symbol, plain-language explanation, and next action.

### Navigation

- **Wide:** category rail on the left and content/detail on the right.
- **Medium:** compact category rail and one content pane.
- **Narrow:** category, list, and detail become sequential views with a breadcrumb.
- **Footer:** only shortcuts valid in the current state are shown.

### Search

- `/` focuses search from list views.
- Results match labels, descriptions, categories, and aliases.
- Empty results explain how to broaden the query.

## 6. Do's and Don'ts

### Do:

- **Do** show the effective value and its source together.
- **Do** keep the selected item visible when navigating or resizing.
- **Do** test at narrow, standard, and wide terminal sizes.
- **Do** preserve complete keyboard workflows and colorblind-friendly status signals.
- **Do** use concise action labels such as “Save model” and “Disable hook”.

### Don't:

- **Don't** render nested cards or decorative panels.
- **Don't** use gradients, glass effects, or decorative motion.
- **Don't** depend on fixed terminal dimensions or mouse input.
- **Don't** expose credentials or silently execute repository hooks.
- **Don't** use color as the only indicator of selection, origin, or risk.
