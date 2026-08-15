/**
 * When a run should fire, as a handful of choices rather than a picker.
 *
 * WHY NOT A DATE/TIME PICKER
 * --------------------------
 * @react-native-community/datetimepicker is a NATIVE module. Adding it changes
 * the fingerprint, and runtimeVersion is {"policy":"fingerprint"} — every
 * installed binary would stop being offered OTA updates until rebuilt and
 * reinstalled. Presets keep this feature JS-only and shippable over the air,
 * and on a phone they beat a spinner anyway.
 *
 * All arithmetic is on the DEVICE's clock, so "tonight" means tonight where the
 * student is. The server stores what we send as a timestamptz.
 *
 * PURE MODULE — no React, no IO.
 */

export type SchedulePresetId = "in_an_hour" | "tonight" | "late_tonight" | "tomorrow_morning";

export interface SchedulePreset {
  id: SchedulePresetId;
  /** i18n key under `tasks.when`. */
  labelKey: string;
  /** Hour of day in local time, or null for a relative offset. */
  hour: number | null;
  /** Days ahead. 0 = today, 1 = tomorrow. Ignored when `hour` is null. */
  dayOffset: number;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { id: "in_an_hour", labelKey: "tasks.when.inAnHour", hour: null, dayOffset: 0 },
  { id: "tonight", labelKey: "tasks.when.tonight", hour: 23, dayOffset: 0 },
  { id: "late_tonight", labelKey: "tasks.when.lateTonight", hour: 2, dayOffset: 1 },
  { id: "tomorrow_morning", labelKey: "tasks.when.tomorrowMorning", hour: 8, dayOffset: 1 },
];

/**
 * The concrete moment a preset means, from `now` (injected so this stays pure
 * and so it can be checked against a fixed clock).
 *
 * A fixed-hour preset that has already passed rolls forward a day — picking
 * "Tonight 23:00" at 23:30 must not schedule a run 30 minutes in the past,
 * which the server would claim on the very next tick and run immediately.
 */
export function resolvePreset(preset: SchedulePreset, now: Date = new Date()): Date {
  if (preset.hour === null) return new Date(now.getTime() + 60 * 60 * 1000);

  const d = new Date(now);
  d.setDate(d.getDate() + preset.dayOffset);
  d.setHours(preset.hour, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** "23:00" for the chip's subtitle. 24-hour: what Algerian students read. */
export function presetClock(preset: SchedulePreset, now: Date = new Date()): string {
  const d = resolvePreset(preset, now);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
