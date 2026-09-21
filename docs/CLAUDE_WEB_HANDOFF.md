# GymApp — Claude Web Historical Handoff

## Status

This document preserves historical context from the Claude Web development conversation that previously drove GymApp development.

It is **not** the specification for the next version of GymApp. The GitHub repository and the deployed Supabase project are authoritative for implementation state.

## Post-Handoff Context

A substantial product and UX reengineering is now being considered. Historical decisions documented here should be preserved as context and evidence, but should not automatically constrain the future architecture unless explicitly marked as a decision that remains applicable.

A separate repository named `Gym-Exercise-Library` now exists. It was created outside the Claude Web conversation after exercise-media licensing and quality limitations became clear. It is intended to evolve independently as a controlled exercise knowledge/media source.

GymApp currently has no approved integration contract with `Gym-Exercise-Library`. Future integration must be designed explicitly; GymApp should not directly depend on the library repository's internal structure.

Specific medical conditions previously used during development were historical test cases that exposed weaknesses in GymApp's safety architecture. They must not become hard-coded product assumptions. Future architecture should generalize physical constraints, movement restrictions and rehabilitation lifecycle concepts.

## Historical Product Purpose

GymApp began as a personal fitness application intended to generate tailored training from profile information such as goals, experience, available equipment and physical limitations. Development and validation primarily used a single reference user, but future architecture should not unnecessarily assume permanent single-user use.

Historical capabilities included AI-generated routines, per-set weight/repetition/RIR logging, exercise references, alternatives, progress/history and basic plateau/progression logic.

## Historical Architecture Decisions

- Frontend migrated from React Native/Expo experimentation to a vanilla HTML/CSS/JavaScript PWA.
- Supabase provides Auth, PostgreSQL persistence and Edge Functions.
- Vercel became the frontend deployment path after GitHub Pages/service-worker caching friction.
- Claude is called server-side from Supabase Edge Functions; the client does not hold the Anthropic secret.
- Routine generation is catalog-constrained rather than allowing the model to invent arbitrary exercises.
- Short numeric references are sent to the model and translated back to canonical exercise IDs.
- Safety-critical constraints should be validated deterministically in code rather than trusted only to prompts.
- Exercise media without confirmed appropriate licensing should not be incorporated.
- Perfil and Generador were separated as the product evolved.

## Historical Routine Model

Three routine types evolved:

- `fuerza`
- `abdominales`
- `cardio`

Strength and abdominal routines select from the exercise catalog. Cardio uses a separate plan structure rather than the exercise catalog.

Four Supabase Edge Functions were deployed historically:

- `generate-routine`
- `regenerate-day`
- `generate-cardio-plan`
- `regenerate-cardio-day`

At the time this handoff was reconciled, these functions existed in the deployed Supabase project but were not versioned in the GitHub repository.

## Historical Data and Media

The application used an `ejercicios` catalog with fields including ID, name, muscle group, equipment, level and contraindications, plus `ejercicio_imagenes` for external image references.

Historical imports included Wger and Free Exercise DB material. Muscle taxonomy was not fully normalized and contraindication metadata remained incomplete.

Media licensing constraints were a major reason for avoiding arbitrary third-party exercise clips. The newer `Gym-Exercise-Library` repository supersedes the earlier idea of a vague custom clip-generation engine and should be treated as an independent upstream project, not as a GymApp internal module.

## Historical UX

The interface grew incrementally around Perfil, Generador, Rutina, Abdomen, Cardio, Extra and Historial. This structure reflects implementation history, not an approved future information architecture.

The product accumulated capabilities faster than the UX was redesigned around the user's primary question: what training is appropriate today?

## Known Historical Debt

- Edge Function source was deployed manually in Supabase rather than versioned with GymApp.
- Database changes were made directly in Supabase without a reproducible migration history.
- Exercise muscle taxonomy was mixed/inconsistent.
- Exercise contraindication metadata was largely incomplete.
- Frontend logic accumulated in a large vanilla JavaScript application.
- Automated test coverage and deployment automation were absent or minimal.
- Exercise/media integration remained incomplete.
- Password-reset completion flow required further validation.
- Safety logic evolved reactively after unsafe recommendations exposed weaknesses.

## Decisions That Should Not Be Silently Reversed

These are historical engineering principles worth preserving until explicitly reassessed:

1. Do not introduce exercise media without appropriate licensing/provenance.
2. Do not let the LLM freely invent exercise IDs outside the controlled catalog.
3. Do not rely exclusively on prompt text for safety-critical compatibility decisions.
4. Do not introduce live mid-workout AI regeneration without revalidating cost, latency, connectivity and safety.
5. Keep secrets such as provider API keys server-side.
6. Treat `Gym-Exercise-Library` as an independent upstream source with an explicit integration contract.

## Reconciliation Requirement

This handoff must always be interpreted against:

1. the current `Ohtli-Admin/gym-app` repository;
2. the deployed Supabase `GYM-APP` project;
3. subsequent architecture/reengineering decisions.

Where these disagree, record the discrepancy rather than silently treating this historical document as authoritative.
