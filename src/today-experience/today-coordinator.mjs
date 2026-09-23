// The "Today Coordinator": combines each product's already-generated
// today items (from legacy-adapter.mjs, or a Workout Planner plan's own
// exercises) into one overview and one combined session-item list. It
// does NOT generate, evaluate compatibility, or decide anything about
// exercises itself — it only aggregates what each product already
// produced. Pure, no DOM, no Supabase.
//
//   SEPARATE PLANS (Fuerza/Cardio/Core/...)
//         v
//   buildTodayOverview()   <- this file
//         v
//   TODAY'S SESSION (workout-session.mjs's createSessionFromItems)

// `components` is a plain object keyed by product id, each value either
// `null` (no plan/nothing scheduled today) or `{ label, items }` where
// `items` is already shaped per workout-session.mjs's session-item
// contract (see legacy-adapter.mjs).
export function buildTodayOverview(components) {
  const entries = Object.entries(components).filter(
    ([, value]) => value && Array.isArray(value.items) && value.items.length > 0,
  );

  const summaries = entries.map(([product, value]) => ({
    product,
    label: value.label,
    itemCount: value.items.length,
    estimatedDurationMinutes: value.items.reduce((sum, item) => sum + item.estimatedDurationMinutes, 0),
  }));

  const combinedItems = entries.flatMap(([, value]) => value.items);

  return {
    components: summaries,
    combinedItems,
    totalEstimatedDurationMinutes: combinedItems.reduce((sum, item) => sum + item.estimatedDurationMinutes, 0),
    hasAnything: combinedItems.length > 0,
  };
}
