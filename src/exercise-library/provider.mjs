// Gym-Exercise-Library exercise provider (GA-006 pilot).
//
// Reads ONLY the GymApp-owned generated snapshot
// (src/exercise-library/generated/, written by
// tools/sync-exercise-library.mjs). It never fetches the Library repository
// and never falls back to the demo catalog: a missing or stale snapshot is
// an explicit LibrarySnapshotError.
import { adaptLibraryRecord, LibraryRecordRejectedError } from './library-adapter.mjs';
import { PILOT_POLICY_VERSION } from './pilot-policy.mjs';

export const SYNC_COMMAND = 'node tools/sync-exercise-library.mjs';

export class LibrarySnapshotError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'LibrarySnapshotError';
    if (cause) this.cause = cause;
  }
}

// Builds a provider from already-parsed snapshot JSON. Pure (no I/O), so
// the browser loader and the Node tests share it.
export function buildLibraryProvider({ catalog, manifest }) {
  if (!Array.isArray(catalog) || typeof manifest !== 'object' || manifest === null) {
    throw new LibrarySnapshotError(`Gym-Exercise-Library snapshot is malformed. Re-run: ${SYNC_COMMAND}`);
  }
  if (manifest.filteringPolicy?.version !== PILOT_POLICY_VERSION) {
    throw new LibrarySnapshotError(
      `Gym-Exercise-Library snapshot was generated with policy '${manifest.filteringPolicy?.version}', expected '${PILOT_POLICY_VERSION}'. Re-run: ${SYNC_COMMAND}`,
    );
  }

  const exercises = [];
  const runtimeRejected = [];
  for (const record of catalog) {
    try {
      exercises.push(Object.freeze(adaptLibraryRecord(record)));
    } catch (error) {
      if (!(error instanceof LibraryRecordRejectedError)) throw error;
      runtimeRejected.push({ exerciseId: error.exerciseId, reasons: error.reasons });
    }
  }

  return Object.freeze({
    manifest,
    exercises: Object.freeze(exercises),
    runtimeRejected: Object.freeze(runtimeRejected),
    // Same signature as the demo provider: () -> exercise[]
    getExercises: () => exercises,
  });
}

// Browser loader. Fetches the two generated files that sit next to this
// module; any failure (404 because the snapshot was never synced, bad
// JSON, stale policy) becomes a LibrarySnapshotError naming the sync
// command.
export async function loadLibraryProvider({
  fetchImpl = globalThis.fetch,
  baseUrl = new URL('./generated/', import.meta.url),
} = {}) {
  const readJson = async (file) => {
    let response;
    try {
      response = await fetchImpl(new URL(file, baseUrl));
    } catch (cause) {
      throw new LibrarySnapshotError(`Could not load Gym-Exercise-Library snapshot (${file}). Run: ${SYNC_COMMAND}`, { cause });
    }
    if (!response.ok) {
      throw new LibrarySnapshotError(
        `Gym-Exercise-Library snapshot is missing (${file}: HTTP ${response.status}). Run: ${SYNC_COMMAND}`,
      );
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new LibrarySnapshotError(`Gym-Exercise-Library snapshot is not valid JSON (${file}). Re-run: ${SYNC_COMMAND}`, { cause });
    }
  };
  const [manifest, catalog] = await Promise.all([readJson('manifest.json'), readJson('catalog.json')]);
  return buildLibraryProvider({ catalog, manifest });
}
