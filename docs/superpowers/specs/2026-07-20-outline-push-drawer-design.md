# Outline Push-Drawer — Design

**Date:** 2026-07-20
**Status:** Approved, ready for implementation

## Summary

Replace the Thesis Structure **bottom sheet** (`ThesisStructureSheet`, a gorhom
`BottomSheetModal`) with a **push-drawer**: a side panel that, when opened, slides
the entire current screen sideways as one piece (header + document + tab bar) and
is revealed in the vacated space — a "slide"/"push" navigation drawer, not an
overlay.

### Locked decisions (from brainstorming)

- **Motion:** push / slide — screen and drawer move together on a track.
- **Side:** opens from the **right** (RTL-native; the reading/start side for the
  Arabic thesis content). Screen pushes **left**.
- **Width:** drawer **72%**, leaving a **28% dimmed peek** of the pushed screen.
- **Scope:** both the **workspace** and the **chat** tab.
- **Open:** the existing outline buttons (the one next to ✦ Ask AI, and header
  ⋯ → Outline) **plus** a right-edge swipe.
- **Close:** tap the dimmed peek, swipe right, toggle the button, or Android back.

## Architecture — one root-level drawer

A single `<PushDrawer>` mounts at the **root** (`app/_layout.tsx`), wrapping the
whole navigator tree. Opening it pushes **everything** (header, document, chat tab
bar) uniformly — this is why it lives at the root: it removes the "what happens to
the tab bar" problem and gives one shared instance for both screens instead of a
per-screen wrapper.

- **Track (right side):** closed = `translateX(0)` (app fills the screen, drawer
  parked off the right edge); open = `translateX(-72%w)` (app slides left, 28%
  dimmed peek remains, drawer shown on the right).
- Driven by a Reanimated `progress` shared value (0 = closed → 1 = open) animated
  on the UI thread; a scrim over the pushed screen fades in with `progress`.
- Gated so it is inert outside the thesis surfaces (see Gesture gating).

## Components

- **`components/PushDrawer.tsx`** (new): the track + transform + scrim + gesture +
  Android-back + keyboard handling. Renders `children` (the app) and the drawer
  panel. Reads open state from `nav-drawer-store`; owns the `progress` shared value.
- **`components/workspace/ThesisOutlinePanel.tsx`** (new): the drawer's contents —
  the virtualized outline list already built for the sheet (flatten tree →
  `OutlineRow` → `FlatList`, with the title + section/chapter counts as the list
  header), reading the cached `outline-store`. No bottom-sheet wrapper. Owns the
  heading-tap handler.
- **`stores/nav-drawer-store.ts`** (new): `{ open, openDrawer(), closeDrawer(),
  toggleDrawer() }`. The boolean is the settled source of truth; the gesture drives
  `progress` live and commits the boolean on release.
- **`components/ThesisStructureSheet.tsx`** (removed): the `BottomSheetModal`
  version is deleted; its inner list logic moves to `ThesisOutlinePanel`.

## Data flow

- The panel renders the current thesis's outline from `outline-store` (unchanged:
  `hydrate()` on open = cache-only; `sync()` on thesis-enter / heading change). No
  new fetch path.
- **Open triggers** call `openDrawer()` instead of `openSheet("structure")`:
  - `BlockContextBar` outline button (`openOutline`).
  - `WorkspaceHeaderMenu` ⋯ → Outline (`onOpenOutline` → the workspace handler).
  - The chat screen's outline trigger.
- **Heading tap** (in `ThesisOutlinePanel`) keeps the built logic: `closeDrawer()`
  + `selectBlock(index, title)` + `requestScrollToBlock(index)`, and navigates to
  the workspace only when not already there (`usePathname`).

## Gesture & motion

- **Edge-swipe (open):** a `Gesture.Pan()` whose activation is restricted to the
  rightmost ~24px when closed, with `activeOffsetX` requiring horizontal intent —
  so it never steals the document's vertical scroll, the reorderable list's
  long-press drag, or WebView taps. While open, a drag on the peek/drawer closes.
  On release, spring to 0 or 1 and commit the boolean via `runOnJS`.
- **Programmatic:** an effect watches `nav-drawer-store.open` and animates
  `progress` to match (buttons / back / heading-tap).
- **Gating:** the edge gesture and back handler are active only when a current
  thesis exists **and** the route is the workspace or chat (`usePathname`) — inert
  on settings/home/auth/onboarding.

## Close / back / keyboard

- Close: tap the dimmed peek scrim, swipe right, the toggle button, or **Android
  hardware back** (a `BackHandler` intercepts while open instead of leaving the
  screen).
- Opening (button or swipe) calls `Keyboard.dismiss()` so the drawer never fights
  an open keyboard.

## Removed / rewired

- Remove `ThesisStructureSheet` mounts in `app/(app)/thesis-workspace.tsx` and
  `app/(tabs)/chat.tsx`.
- Remove the `bottom-sheet-store` `"structure"` key usage and the
  `activePanel === "outline"` gating tied to the sheet (repurpose or drop
  `activePanel: "outline"`).
- Reuse unchanged: `outline-store`, `outline-cache`, the flatten + `OutlineRow` +
  virtualized list, the scroll-to-block plumbing (`workspace-store.scrollTarget`).

## Risks / edge cases

- **Gesture conflicts** — mitigated by the thin right-edge activation zone +
  `activeOffsetX`; verify against doc scroll, reorder-drag, and the WebView.
- **Root transform** — pushing the whole tree is a single UI-thread transform
  (cheap), but must sit inside `GestureHandlerRootView` and wrap the
  `BottomSheetModalProvider` + `Stack` so sheets/modals push with it.
- **RTL correctness** — the track math assumes right-side; verify the app also
  renders correctly when the app UI language is LTR (drawer stays on the right per
  the decision, since it follows the RTL document).

## Testing / verification

No JS test runner in this app → `npx tsc --noEmit` + device QA:
open/close via button, edge-swipe, tap-peek, Android back; keyboard dismiss;
heading-tap scroll + close; right-side push in RTL; **both** workspace and chat;
and no gesture conflict with doc scroll / reorder-drag / WebView.
