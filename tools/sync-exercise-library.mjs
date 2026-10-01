// Development/build-time importer: Gym-Exercise-Library -> GymApp snapshot.
//
// The generated snapshot IS committed to GymApp, so deploys never need
// access to the Library repository; re-run this only to refresh it.
//
// Reads the Library's generated consumable export from a LOCAL checkout
// (never over the network, never with credentials) and writes a
// GymApp-owned consumer artifact:
//
//   src/exercise-library/generated/catalog.json   accepted records, unmodified
//   src/exercise-library/generated/manifest.json  provenance + diagnostics
//
// The source repository is only read, never modified. By default files
// are read from its COMMITTED state (`git show HEAD:<path>`), so the
// snapshot always corresponds to a real Library commit even while the
// Library's own pipelines have uncommitted work in progress.
//
// Usage:
//   node tools/sync-exercise-library.mjs [--source ../Gym-Exercise-Library] [--ref <commit>]
//   node tools/sync-exercise-library.mjs --working-tree   (read uncommitted files; dev only)
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterPilotCatalog, resolveDisplayName, PILOT_POLICY_VERSION, SUPPORTED_SCHEMA_VERSIONS, PILOT_ACCEPTED_STATUSES } from '../src/exercise-library/pilot-policy.mjs';
import {
  MODALITY_POLICY_VERSION,
  CALISTHENICS_POLICY_EQUIPMENT,
  CALISTHENICS_POLICY_EQUIPMENT_FAMILIES,
  CALISTHENICS_POLICY_TRAINING_TYPES,
  TRAINING_TYPE_TO_MODALITY,
  isCalisthenicsPolicyCandidate,
} from '../src/exercise-library/modality-policy.mjs';
import { EQUIPMENT_MAPPING_VERSION, GYMAPP_TO_LIBRARY_EQUIPMENT, GYMAPP_EQUIPMENT_UNMAPPED } from '../src/exercise-library/equipment-mapping.mjs';
import { PROFILE_RESTRICTION_MAPPING_VERSION, PROFILE_INJURY_TO_LIBRARY_REGION } from '../src/exercise-library/profile-restriction-mapping.mjs';
import { VARIETY_POLICY_VERSION } from '../src/exercise-library/session-variety-policy.mjs';

const GYMAPP_ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const OUT_DIR = join(GYMAPP_ROOT, 'src', 'exercise-library', 'generated');
const SOURCE_REPOSITORY = 'Ohtli-Admin/Gym-Exercise-Library';
const CATALOG_PATH = 'output/gym-exercise-library/catalog.json';

function parseArgs(argv) {
  const valueOf = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : null);
  return {
    source: resolve(GYMAPP_ROOT, valueOf('--source') ?? '../Gym-Exercise-Library'),
    ref: argv.includes('--working-tree') ? null : valueOf('--ref') ?? 'HEAD',
  };
}

function git(source, args) {
  try {
    return execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// Reads a Library-relative path either from commit `ref` or, when ref is
// null, from the working tree.
function makeSourceReader(source, ref) {
  const gitRead = (args) => execFileSync('git', ['-C', source, ...args], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  return {
    async readJson(relPath) {
      const text = ref ? gitRead(['show', `${ref}:${relPath}`]).toString('utf8') : await readFile(join(source, relPath), 'utf8');
      return JSON.parse(text.replace(/^﻿/, ''));
    },
    async exists(relPath) {
      try {
        if (ref) gitRead(['cat-file', '-e', `${ref}:${relPath}`]);
        else await access(join(source, relPath));
        return true;
      } catch {
        return false;
      }
    },
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function main() {
  const { source, ref } = parseArgs(process.argv.slice(2));
  const reader = makeSourceReader(source, ref);
  if (!(await reader.exists(CATALOG_PATH))) {
    console.error(
      `Library export not found: ${CATALOG_PATH} at ${ref ?? 'working tree'} in ${source}\nClone ${SOURCE_REPOSITORY} next to gym-app or pass --source <path>.`,
    );
    process.exit(1);
  }

  const catalog = await reader.readJson(CATALOG_PATH);
  if (!Array.isArray(catalog)) throw new Error(`${CATALOG_PATH} is not a JSON array.`);
  const equipmentTaxonomy = await reader.readJson('taxonomy/equipment.json');
  const trainingTypeTaxonomy = await reader.readJson('taxonomy/training-types.json');

  // Drift check: the Calisthenics policy's equipment list must equal the
  // Library taxonomy's bodyweight/calisthenics families exactly.
  const familyIds = equipmentTaxonomy
    .filter((item) => CALISTHENICS_POLICY_EQUIPMENT_FAMILIES.includes(item.family))
    .map((item) => item.id)
    .sort();
  if (JSON.stringify(familyIds) !== JSON.stringify([...CALISTHENICS_POLICY_EQUIPMENT].sort())) {
    throw new Error(
      `CALISTHENICS_POLICY_EQUIPMENT drifted from the Library taxonomy.\n  taxonomy: ${familyIds.join(', ')}\n  policy:   ${[...CALISTHENICS_POLICY_EQUIPMENT].sort().join(', ')}\nUpdate src/exercise-library/modality-policy.mjs deliberately.`,
    );
  }
  const unknownMappedIds = Object.values(GYMAPP_TO_LIBRARY_EQUIPMENT).filter((id) => !equipmentTaxonomy.some((item) => item.id === id));
  if (unknownMappedIds.length) throw new Error(`Equipment mapping targets unknown Library ids: ${unknownMappedIds.join(', ')}`);
  const bodyRegionTaxonomy = await reader.readJson('taxonomy/body-regions.json');
  const unknownRegions = Object.values(PROFILE_INJURY_TO_LIBRARY_REGION).filter((id) => !bodyRegionTaxonomy.some((item) => item.id === id));
  if (unknownRegions.length) throw new Error(`Profile restriction mapping targets unknown Library body regions: ${unknownRegions.join(', ')}`);

  const taxonomy = {
    equipmentIds: equipmentTaxonomy.map((item) => item.id),
    trainingTypeIds: trainingTypeTaxonomy.map((item) => item.id),
  };
  const { accepted, rejected } = filterPilotCatalog(catalog, taxonomy);

  const sourceCommit = git(source, ['rev-parse', ref ?? 'HEAD']);
  const catalogCommit = git(source, ['log', '-1', '--format=%H', ref ?? 'HEAD', '--', CATALOG_PATH]);
  const catalogDirty = git(source, ['status', '--porcelain', '--', CATALOG_PATH]);

  const all = catalog.filter((r) => r && typeof r === 'object');
  const hasType = (r, t) => Array.isArray(r.classification?.training_types) && r.classification.training_types.includes(t);
  const mediaRefs = accepted.filter((r) => typeof r.media?.primary_image === 'string');
  const mediaResolvable = [];
  for (const record of mediaRefs) {
    if (await reader.exists(record.media.primary_image.replace(/^\/+/, ''))) mediaResolvable.push(record.exercise_id);
  }

  const diagnostics = {
    totalRecordsRead: catalog.length,
    acceptedRecords: accepted.length,
    rejectedRecords: rejected.length,
    rejectionReasons: countBy(rejected.flatMap((r) => r.reasons.map((reason) => reason.code))),
    explicitCalisthenicsTrainingType: { all: all.filter((r) => hasType(r, 'calisthenics')).length, accepted: accepted.filter((r) => hasType(r, 'calisthenics')).length },
    calisthenicsPolicyCandidates: {
      all: all.filter((r) => isCalisthenicsPolicyCandidate(r.setup?.equipment_required, r.classification?.training_types)).length,
      accepted: accepted.filter((r) => isCalisthenicsPolicyCandidate(r.setup.equipment_required, r.classification.training_types)).length,
    },
    missingSpanishName: all.filter((r) => !(typeof r.names?.es === 'string' && r.names.es.trim())).length,
    missingEnglishName: all.filter((r) => !(typeof r.names?.en === 'string' && r.names.en.trim())).length,
    missingEquipment: all.filter((r) => !Array.isArray(r.setup?.equipment_required) || r.setup.equipment_required.length === 0).length,
    missingTrainingTypes: all.filter((r) => !Array.isArray(r.classification?.training_types) || r.classification.training_types.length === 0).length,
    primaryMediaReferences: { all: all.filter((r) => typeof r.media?.primary_image === 'string').length, accepted: mediaRefs.length },
    primaryMediaResolvableInSourceCheckout: mediaResolvable.length,
    statuses: countBy(all.map((r) => String(r.status))),
    reviewStatuses: countBy(all.map((r) => String(r.review?.status))),
    acceptedTrainingTypes: countBy(accepted.flatMap((r) => r.classification.training_types)),
    acceptedEquipmentRequired: countBy(accepted.flatMap((r) => r.setup.equipment_required)),
    acceptedWithoutSpanishName: accepted.filter((r) => resolveDisplayName(r).language !== 'es').length,
  };

  const manifest = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'tools/sync-exercise-library.mjs',
    source: {
      repository: SOURCE_REPOSITORY,
      path: CATALOG_PATH,
      readMode: ref ? 'commit' : 'working_tree',
      commit: sourceCommit,
      catalogLastCommit: catalogCommit,
      // In 'commit' mode uncommitted Library changes are NOT in the
      // snapshot; this only records whether any existed at sync time.
      catalogHasUncommittedChanges: catalogDirty === null ? null : catalogDirty !== '',
      schemaVersions: countBy(all.map((r) => String(r.schema_version))),
      recordCount: catalog.length,
    },
    importedRecordCount: accepted.length,
    trust: 'pilot',
    trustNote: 'Records are admitted by GymApp structural pilot policy only. Library status/review are preserved per record; none is treated as approved catalog.',
    filteringPolicy: {
      version: PILOT_POLICY_VERSION,
      supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
      acceptedStatuses: PILOT_ACCEPTED_STATUSES,
      requires: [
        'exercise_id matching ^[a-z0-9][a-z0-9_-]*$ (unique)',
        'names.es or names.en non-blank',
        'setup.equipment_required: non-empty array of known Library equipment ids',
        'classification.training_types: non-empty array of known Library training type ids',
        'equipment_optional, body_regions, primary_muscles, joint_actions, movement_patterns, constraints: arrays of ids (may be empty)',
      ],
    },
    modalityPolicy: {
      version: MODALITY_POLICY_VERSION,
      trainingTypeToModality: TRAINING_TYPE_TO_MODALITY,
      calisthenicsCandidate: {
        equipmentFamilies: CALISTHENICS_POLICY_EQUIPMENT_FAMILIES,
        equipmentIds: CALISTHENICS_POLICY_EQUIPMENT,
        trainingTypes: CALISTHENICS_POLICY_TRAINING_TYPES,
        note: 'GymApp product policy, not Library metadata. No name heuristics.',
      },
    },
    profileRestrictionMapping: { version: PROFILE_RESTRICTION_MAPPING_VERSION, profileInjuryToLibraryRegion: PROFILE_INJURY_TO_LIBRARY_REGION },
    sessionVarietyPolicy: { version: VARIETY_POLICY_VERSION },
    equipmentMapping: { version: EQUIPMENT_MAPPING_VERSION, gymAppToLibrary: GYMAPP_TO_LIBRARY_EQUIPMENT, unmappedGymAppValues: GYMAPP_EQUIPMENT_UNMAPPED },
    media: {
      note: 'primary_image references are preserved in adapted exercises (library.primaryImage) but not copied or loaded by GymApp.',
      resolvableExerciseIds: mediaResolvable,
    },
    diagnostics,
    rejected,
  };

  await mkdir(OUT_DIR, { recursive: true });
  // One record per line: compact, but still reviewable in a diff.
  await writeFile(join(OUT_DIR, 'catalog.json'), `[\n${accepted.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
  await writeFile(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  let dirtyNote = '';
  if (manifest.source.catalogHasUncommittedChanges) {
    dirtyNote = ref ? ' (uncommitted Library changes were ignored)' : ' (INCLUDES uncommitted Library changes!)';
  }
  console.log(`Synced ${SOURCE_REPOSITORY} @ ${sourceCommit ?? 'unknown commit'} [${manifest.source.readMode}]${dirtyNote}`);
  console.log(JSON.stringify(diagnostics, null, 2));
  console.log(`Wrote ${accepted.length} records to src/exercise-library/generated/`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
