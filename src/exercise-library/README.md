# Exercise Library Provider v0.1 (GA-006, pilot)

GymApp's consumer-side integration with
[`Ohtli-Admin/Gym-Exercise-Library`](https://github.com/Ohtli-Admin/Gym-Exercise-Library).
Consumers: **Calistenia** and **Entrenamiento especial → independiente**
(the shared on-demand session builder). Neither has a demo fallback.

```
../Gym-Exercise-Library/output/gym-exercise-library/catalog.json   (Library-owned export)
        |  node tools/sync-exercise-library.mjs   (local checkout, dev/build time only)
        v
src/exercise-library/generated/catalog.json + manifest.json   (GymApp-owned snapshot)
        |  provider.mjs  (fetch next to the module; no GitHub, no credentials)
        v
library-adapter.mjs  -> canonical-compatible exercise shape
        v
Compatibility Engine (context equipment mapped once by equipment-mapping.mjs;
        |               profile lesiones mapped by profile-restriction-mapping.mjs)
        v
session-variety-policy.mjs  (reorders candidates only)
        v
Workout Planner -> session
```

## Sync

```
node tools/sync-exercise-library.mjs [--source ../Gym-Exercise-Library] [--ref <commit>]
```

The generated snapshot is **committed** to GymApp, so a deploy (e.g. Vercel)
never needs the Library repository. The sync only runs manually, to refresh
the snapshot. By default it reads the Library's **committed** state
(`git show HEAD:<path>`), so the snapshot always matches a real Library
commit even while the Library's own pipelines have uncommitted work. Pass
`--working-tree` to read uncommitted files instead (development only; the
manifest records `readMode`).

Reads the Library's `catalog.json` plus `taxonomy/equipment.json` and
`taxonomy/training-types.json` (only to validate ids and to check the
Calisthenics policy has not drifted from the taxonomy). The Library checkout
is never modified. Writes:

- `generated/catalog.json` — the accepted records, **unmodified** Library
  payloads, one per line.
- `generated/manifest.json` — source repository/commit, the catalog file's
  last commit and dirty flag, schema versions, source/imported counts,
  timestamp, policy versions, the equipment/modality mappings, media
  notes, the full diagnostics block, and every rejected id with reasons.

## Pilot trust policy (`pilot-policy.mjs`, `ga006-pilot-v1`)

A record is admitted only if: schema `0.2`; `exercise_id` matches
`^[a-z0-9][a-z0-9_-]*$` and is unique; status is not `deprecated`;
`names.es` or `names.en` is non-blank; `setup.equipment_required` is a
**non-empty** array of known Library equipment ids;
`classification.training_types` is a non-empty array of known ids; the other
mapped arrays are well-formed (they may be empty).

An empty `equipment_required` is rejected, not treated as "bodyweight":
upstream it means unknown equipment, and Compatibility Engine would otherwise
read it as needing nothing.

Admitted records are tagged `library.trust = 'pilot'` and keep the upstream
`status` / `review.status`. At GA-006 time every record was `draft` /
`review_required`, so none of this is approved catalog.

## Field mapping (`library-adapter.mjs`)

| GymApp field | Library field |
|---|---|
| `exerciseId` | `exercise_id` (byte-for-byte) |
| `name` | `names.es`, else `names.en` |
| `equipmentRequired` / `equipmentOptional` | `setup.equipment_required` / `setup.equipment_optional` (Library ids) |
| `bodyRegions` | `classification.body_regions` |
| `primaryMuscles` | `classification.primary_muscles` |
| `jointActions` | `classification.joint_actions` |
| `movementPatterns` | `classification.movement_patterns` |
| `constraints` | `biomechanics.constraints` |
| `trainingModalities` | `modality-policy.mjs` |
| `library.*` | trust, status, review status, name language, training types, modality provenance, `media.primary_image` reference |

## Modality policy (`modality-policy.mjs`, `ga006-modality-v1`)

Canonical-derived: `strength`, `hypertrophy`, `muscular_endurance`, `power`,
`bodybuilding`, `powerlifting`, `olympic_weightlifting`, `strongman`,
`kettlebell_training` → `gym`; `calisthenics` → `calisthenics`; `cardio` →
`cardio`; `core_training` → `core`. Every other training type (e.g.
`stretching`, `plyometrics`, `mobility`) maps to no modality.

GymApp Calisthenics product policy (needed because the current export has
**zero** records typed `calisthenics`): a record is a Calisthenics candidate
when every `equipment_required` id is in the taxonomy's `bodyweight` or
`calisthenics` family **and** its training types include one of
`strength`, `hypertrophy`, `muscular_endurance`, `power`, `plyometrics`,
`gymnastics_strength`, `isometric_training`, `core_training`. Names are never
used. The result is recorded in `library.modalityProvenance` as
`gymapp_calisthenics_equipment_policy`, which keeps it separate from
canonical metadata. It is never written back to the Library.

## Equipment boundary (`equipment-mapping.mjs`)

This module is the only place that translates between GymApp and Library
equipment ids. It maps session equipment from Context Engine's vocabulary
to Library ids. Library ids on exercises are never collapsed.

| GymApp (Context Engine) | Library |
|---|---|
| `bodyweight` | `bodyweight` |
| `dumbbell` | `dumbbell` |
| `barbell` | `barbell` |
| `kettlebell` | `kettlebell` |
| `resistance_band` | `resistance_band` |
| `pull_up_bar` | `pullup_bar` |
| `bench`, `machine`, `cardio_machine`, `bike` | **unmapped** (generic/ambiguous; reported as `unmappedEquipment`) |

The profile's legacy vocabulary (`barra`, `mancuernas`, `polea`, `maquina`,
`peso_corporal`) feeds only the LLM generators. It is not on the Calistenia
path, so it is not mapped here.

## Session variety policy (`session-variety-policy.mjs`, `ga006-variety-v1`)

GymApp product policy. It runs after Compatibility Engine and before
Workout Planner, and only reorders `compatible` / `conditional`. It never
adds, drops or reclassifies a candidate.

1. **Level tier:** candidates whose Library `difficulty.overall` rank is at
   or below the user's experience level come first. Ranks follow the
   Library's `taxonomy/difficulty.json`: beginner 1, intermediate 2,
   advanced 3, expert 4. Harder candidates, and those of unknown
   difficulty, come after them. Nothing is excluded.
2. **Variety key:** the first `primaryMuscles` id, else the first
   `bodyRegions` id, else `unclassified`.
3. **Round-robin** across keys, so consecutive picks are from different
   groups.
4. **Seeded order:** groups and members are ordered by an FNV-1a hash of
   `seed|id`. The UI seed is `YYYY-MM-DD#n`: the local date, plus how
   many times "Generar" was pressed on that screen. The same seed always
   gives the same session, and pressing again gives the next variant.

Limitation: `movement_patterns` and `joint_actions` are empty on every
record in the current export. Variety is therefore by muscle/region only,
not by push/pull/squat pattern, and there is no split logic.

## Physical context and restrictions

GymApp is not a closed catalog of injuries. Library-backed sessions receive
three explicit inputs, assembled per generation by
`src/today-experience/physical-context.mjs`. That context is runtime only
and never written back to the profile.

| Input | Where it lives | How generation uses it |
|---|---|---|
| **User's own description** (persistent) | `perfiles.condiciones_medicas`, shown in Perfil as "Lesiones, molestias o limitaciones que quieras que GymApp tenga en cuenta". It's the same column as before, so the Fuerza/Core/Cardio generators keep reading it unchanged. | Passed verbatim as a Context Engine restriction with **no** `avoidTags`. It is shown back to the user as "no se puede evaluar automáticamente". It never excludes anything by itself. |
| **Zone shortcuts** (persistent, legacy) | `perfiles.lesiones` chips | Kept for compatibility, since `generate-routine` also reads them. Mapped to Library body regions (below). This is not the long-term model. |
| **Temporary session context** | Entrenamiento especial text | Passed as Context Engine `preferences.notes`, never as a restriction. It is stored only inside that session's own prepared/active record, and it is gone when the session ends. |

Free text (profile or session) is **never** parsed into anatomy, avoid-tags
or rules, and no name heuristics are used anywhere.

### Legacy zone shortcuts (`profile-restriction-mapping.mjs`)

Each chip becomes one Context Engine restriction whose `avoidTags` is the
Library body region that names that area. The severity is Context Engine's
default, `hard`, so matching exercises are excluded.

| Profile chip | Library body region |
|---|---|
| Hombro | `shoulder_girdle` |
| Muñeca | `forearm_hand` (broader: also forearm/hand) |
| Espalda baja | `posterior_core` |
| Cadera | `hip_pelvis` |
| Tobillo | `lower_leg_foot` (broader) |
| Rodilla | **none**: the Library has no knee region, so the chip is shown to the user as "no se puede verificar" |

Limitation: an exercise can only be avoided when its Library
`body_regions` list the region. Records with empty regions can't match, and
the Library has no movement patterns or joint actions. Example: with Hombro
declared, Chin-Up can still be selected, because the Library tags it
`back` / `latissimus_dorsi`, not `shoulder_girdle`. The UI therefore
never claims completeness or calls an exercise safe. It says: "GymApp
aplicó las restricciones que pudo verificar con la información disponible
del catálogo", and adds that some exercises involving the zone may not be
detected. The sync fails if a mapped region disappears from the Library
taxonomy.

## Prescription policy (`prescription-policy.mjs`, `ga006-prescription-v1`)

This replaces the planner's flat Calistenia default (3 × 12 for everything)
after planning, using only populated objective metadata. First match wins:

| Library metadata | Prescription |
|---|---|
| `training_types` contains `plyometrics` | 3 × 6–8 reps |
| `biomechanics.mechanic` = `isolation` | 3 × 12–15 reps |
| `biomechanics.mechanic` = `compound` | 3 × 8–12 reps |
| otherwise | 3 series, reps left to the user (no invented number) |

The Library has no field marking an exercise as isometric or timed, so this
policy never outputs seconds. The plan note tells the user to count seconds
for hold-type exercises. Time estimates stay the planner's.

## Media

`media.primary_image` is preserved as `library.primaryImage`, a
Library-relative path. Missing media never blocks a record. GymApp does not
copy, resolve or display it yet. No remote GitHub URLs are used.

## Tests

```
node --test src/exercise-library/exercise-library.test.mjs
```
