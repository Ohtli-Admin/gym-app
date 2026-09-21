# GymApp Reengineering Decision Frame

Status: PROPOSED — based on the reconciled pre-reengineering baseline.

This document does not redesign implementation yet. It defines what the next architecture must preserve, replace, separate, and introduce.

## Product direction

GymApp should evolve from a collection of routine screens into a personal exercise companion centered on the question:

> What can and should I do today, given my goals, context, progress and current physical constraints?

The existing application proves several useful capabilities, but its information architecture reflects incremental feature growth rather than that user journey.

## Preserve

- Supabase Auth and persistent user-owned training data.
- Logged set history, weight history and completed routine history.
- Catalog-constrained generation: an AI model may compose/select exercises but should not invent exercise identity outside the approved catalog.
- Numeric/internal exercise identifiers in model prompts where they reduce ambiguity, with deterministic mapping back to catalog records.
- Deterministic safety validation outside the language model.
- Routine alternatives/substitutions as a first-class concept.
- Separation of identity/profile information from configurable training preferences.
- Existing historical GymApp exercise IDs for records that already reference them until a verified crosswalk exists.
- The principle that media must have a controlled/licensed provenance.

## Replace or refactor

- The monolithic `app.js` architecture.
- Navigation that exposes implementation categories as peer destinations (Perfil / Generador / Rutina / Abdomen / Cardio / Extra / Historial).
- Free-text medical context as the principal safety mechanism.
- Substring-based muscle/injury exclusion as the deterministic safety layer.
- Hard-coded assumption that the user has all equipment.
- Hard-coded intermediate training level.
- The legacy mixed exercise/equipment/muscle taxonomy as the long-term canonical catalog.
- External image URLs in GymApp as the long-term canonical media source.
- Manually deployed Supabase Edge Functions with no GitHub source of truth.
- Client-side duplicated calculations where server/domain rules should be authoritative.

## Separate responsibilities

### Gym-Exercise-Library owns

- canonical exercise identity;
- objective exercise names and aliases;
- anatomical classification;
- movement patterns and biomechanics;
- equipment requirements;
- training-domain classifications;
- difficulty metadata;
- objective compatibility-relevant movement attributes;
- media and media provenance;
- source provenance;
- controlled vocabularies;
- a versioned consumer export/contract.

### GymApp owns

- authenticated users;
- profile and preferences;
- goals and priorities;
- available environments and equipment;
- current physical constraints;
- rehabilitation/restriction lifecycle;
- exercise compatibility interpretation for a user at a point in time;
- routine planning/generation;
- routine execution and set logging;
- substitutions;
- progress/history;
- user experience and notifications.

GymApp must consume a stable Gym-Exercise-Library contract. It must not depend on the library repository's internal directory structure.

## New domain concepts required

### Current training context

Routine selection needs an explicit context, not only a static profile. At minimum it should be capable of representing:

- intended training domain;
- location/environment;
- equipment actually available;
- time available;
- user-selected focus;
- current constraints relevant to the session.

### Physical constraint

A physical constraint is not a diagnosis. It represents a user-declared or externally guided limitation that GymApp can operationalize.

A constraint needs a lifecycle rather than a permanent text field. Candidate attributes include:

- status: active / review_due / resolved;
- effective date;
- optional review date;
- movements or characteristics to avoid;
- movements explicitly allowed where useful;
- affected region;
- severity/strictness as a user instruction, not a medical diagnosis;
- source type: user-reported / professional guidance / rehabilitation instruction;
- notes;
- resolution or extension event.

At the review date GymApp should ask the user whether to resolve, extend or modify the constraint. It must not silently infer recovery.

### Rehabilitation activity

Rehabilitation exercises should be distinguishable from ordinary training exercises while still referencing canonical exercise/movement identity when applicable. A rehabilitation plan may coexist with training and affect routine compatibility.

### Compatibility decision

Compatibility should be an explainable result of:

canonical exercise attributes + user constraint + current context -> allowed / excluded / conditional

The language model may help compose a routine from allowed candidates, but it should not be the authority that decides whether a prohibited movement is safe.

## Target user journey

The target journey should be organized around the session rather than around database/routine types:

1. User identity and durable profile.
2. Goals and training preferences.
3. Current state/context.
4. Active constraints and rehabilitation requirements.
5. Determine compatible exercises.
6. Propose what to do today.
7. Execute training and record results.
8. Adapt future work from history/progress.

Gym, calisthenics, core, cardio and specialized performance work should be modeled as training capabilities/domains. They do not automatically need permanent peer navigation items.

## Catalog migration rule

Do not replace the current `ejercicios` rows in place.

Build an explicit legacy-to-canonical crosswalk. Historical rows in `rutina_ejercicios` and `series_registradas` must remain interpretable even when a canonical Gym-Exercise-Library exercise becomes the source for future routines.

The migration can therefore be incremental:

1. import/publish a versioned canonical catalog contract;
2. create mappings from legacy GymApp exercise IDs to canonical IDs where confidence is high;
3. preserve unmatched legacy records;
4. generate new routines from canonical IDs only after the compatibility layer is ready;
5. keep historical display resolvable through the mapping/legacy snapshot.

## First implementation slice

The first implementation slice should NOT be a visual redesign and should NOT replace the generator.

It should establish the foundations that every later feature depends on:

1. version the four currently deployed Edge Functions in GitHub;
2. define the Gym-Exercise-Library consumer contract/version;
3. add a legacy-to-canonical exercise crosswalk structure without deleting legacy data;
4. introduce structured current-context and physical-constraint domain models;
5. implement a deterministic compatibility service against a representative canonical subset;
6. add tests for compatibility and historical-ID preservation.

Only after this slice is proven should the routine generator be moved to canonical compatible candidates and the main UX be redesigned around “what should I do today?”

## Explicit non-goals for the first slice

- no deletion of the legacy exercise catalog;
- no migration of historical exercise IDs in place;
- no diagnosis or inferred medical recovery;
- no broad visual redesign;
- no automatic production deployment;
- no direct coupling to Gym-Exercise-Library repository internals;
- no requirement to finish media for all canonical exercises before integration begins.
