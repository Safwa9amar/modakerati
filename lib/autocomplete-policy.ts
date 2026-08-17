import { useSettingsStore } from "@/stores/settings-store";
import { useBillingStore } from "@/stores/billing-store";

// Whether inline ghost-text autocomplete may run.
//
// Two inputs, and the order matters:
//
//   1. The student's own choice, once they have made one. It always wins, in
//      both directions — a free user who turns ghost text ON keeps it.
//   2. Otherwise the plan decides, and on the free plan the default is OFF.
//
// Why the free default is off is NOT the price of a completion: one costs about
// 0.0043 DZD, which is nothing next to a 2.85 DZD chat message. It is that
// autocomplete is the only AI feature that fires WITHOUT being asked — on every
// typing pause, for as long as the student writes — and the free tier's entire
// monthly AI budget is roughly 14 DZD. An unattended feature is the wrong thing
// to leave running inside a budget that small.
//
// The counter is untouched either way: editor tools are unmetered (they are 46×
// to 306× cheaper than a chat message, so counting them would create friction
// for no financial reason).

/** Imperative read, for the completion store's request path. */
export function autocompleteAllowed(): boolean {
  const { autocompleteEnabled, autocompleteTouched } = useSettingsStore.getState();
  if (autocompleteTouched) return autocompleteEnabled;
  return planAllowsByDefault(useBillingStore.getState().quota?.plan);
}

/**
 * Reactive read, for UI that shows autocomplete as on or off.
 *
 * Selects PRIMITIVES from both stores — a selector returning a fresh object
 * literal re-renders forever ("Maximum update depth exceeded").
 */
export function useAutocompleteAllowed(): boolean {
  const enabled = useSettingsStore((s) => s.autocompleteEnabled);
  const touched = useSettingsStore((s) => s.autocompleteTouched);
  const plan = useBillingStore((s) => s.quota?.plan);
  return touched ? enabled : planAllowsByDefault(plan);
}

/**
 * The default for an untouched setting.
 *
 * An unknown plan (the counter has not loaded yet) is treated as PAID: the
 * alternative is ghost text flickering off for a second on every launch while
 * the quota request is in flight, which reads as a bug. Being wrong here costs
 * a fraction of a dinar; being wrong the other way looks broken.
 */
function planAllowsByDefault(plan: string | undefined): boolean {
  return plan !== "free";
}
