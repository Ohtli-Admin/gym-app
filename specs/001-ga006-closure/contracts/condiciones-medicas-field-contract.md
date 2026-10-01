# Contract: `condiciones_medicas` field description (Fuerza/Core/Cardio Edge Functions)

This is the one "interface" this feature changes: the natural-language description of
`perfiles.condiciones_medicas` given to the Claude API's tool-use schema inside
`generate-routine/index.ts` and `regenerate-day/index.ts`. It is a prompt contract, not a code API, but it
governs model behavior, so it is specified explicitly.

## Before (current production behavior)

The field is described to the model as a real, serious medical condition requiring conservative
treatment — written when the Perfil UI itself called the field something closer to "condición médica"
without the softer Calistenia-era relabelling.

## After (this feature's change)

The description MUST:
1. Still instruct the model to treat any stated restriction conservatively — this requirement does not
   loosen.
2. Explicitly acknowledge that the UI now invites softer, more casual phrasing (because of the Calistenia
   relabel), so the model should not assume brevity or casual wording means the restriction is minor.
3. NOT change anything about the deterministic validation path (`grupos_excluidos`,
   `validarRutina`/`validarDia`) — this contract covers only the descriptive text surfaced to the model,
   never the code that validates the model's output.

## Verification

- Manual read-through diff of the before/after description text in both files.
- Existing `diagnostico.test.mjs`/`reintentos.test.mjs` suites re-run unchanged (they test validation
  logic, not prompt wording, so they are expected to keep passing untouched — a failure would indicate an
  accidental change outside this contract's scope).
- No new automated test is introduced for prompt wording itself, since there is no harness in this project
  for asserting LLM behavior from text changes; this is explicitly a human-reviewed wording change,
  validated by the product owner reading the new text, not by a test.
