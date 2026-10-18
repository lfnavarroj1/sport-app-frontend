/**
 * Genera el manifiesto de una release del frontend web y lo valida contra su
 * JSON Schema antes de escribirlo:
 *
 *   node deploy/release/release-manifest.mjs frontend-release dist/frontend-release.json
 *   node deploy/release/release-manifest.mjs release-validation release/release-validation.json
 *
 * - `frontend-release` lo produce cloudbuild.release.yaml (Cloud Build, iniciado
 *   desde GCP): identifica la imagen publicada solo por digest.
 * - `release-validation` lo produce release-web.yml (GitHub Actions, sin GCP): la
 *   imagen solo existe en el runner y se identifica por su ID local.
 *
 * Entradas por variables de entorno (nunca secretos):
 *   RELEASE_TAG, COMMIT_SHA, ARTIFACT_SHA256_FILE, SMOKE_TEST_LOG y, opcional,
 *   REPO_FULL_NAME (si llega, debe ser este repositorio) y CREATED_AT.
 *   frontend-release:   IMAGE_URI (<registro>/<repositorio>/web@sha256:…), BUILD_ID,
 *                       PROJECT_ID y LOCATION.
 *   release-validation: LOCAL_IMAGE_ID, GITHUB_RUN_ID, GITHUB_SERVER_URL y
 *                       GITHUB_REPOSITORY.
 *
 * Sin dependencias: se ejecuta con el Node del proyecto en GitHub y en Cloud Build.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'lfnavarroj1/sport-app-frontend';
export const SMOKE_TEST_SCRIPT = 'deploy/docker/smoke-test.sh';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACT = 'src/app/core/api/contracts/bff-web.openapi.json';
const SEMVER =
  /^v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?)$/;
const SMOKE_PASSED = 'Prueba de humo del contenedor: OK';

/** Comprobaciones que preceden al manifiesto; si una falla, el pipeline se detiene antes. */
const COMMON_CHECKS = [
  { name: 'format', command: 'npm run format:check' },
  { name: 'lint', command: 'npm run lint' },
  { name: 'typecheck', command: 'npm run typecheck' },
  { name: 'unit-tests', command: 'npm run test:ci' },
  { name: 'dependency-audit', command: 'npm run audit:prod' },
  { name: 'production-build', command: 'npm run build' },
];
const CONTAINER_CHECK = { name: 'container-build', command: 'docker build (una sola vez)' };

export const CHECKS = {
  'frontend-release': [...COMMON_CHECKS, CONTAINER_CHECK],
  'release-validation': [
    ...COMMON_CHECKS,
    { name: 'release-scripts', command: 'npm run release:test' },
    { name: 'e2e', command: 'npm run e2e' },
    CONTAINER_CHECK,
  ],
};

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

function required(env, name) {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`falta la variable ${name}`);
  }
  return value;
}

/** Datos comunes de ambos manifiestos, leídos del repositorio y del entorno. */
function common(kind, env, root) {
  const tag = required(env, 'RELEASE_TAG');
  const version = SEMVER.exec(tag)?.[1];
  if (!version) {
    throw new Error(`el tag '${tag}' no es SemVer vX.Y.Z o vX.Y.Z-pre`);
  }
  const commit = required(env, 'COMMIT_SHA');
  if (env.REPO_FULL_NAME && env.REPO_FULL_NAME !== REPOSITORY) {
    throw new Error(`el repositorio '${env.REPO_FULL_NAME}' no es ${REPOSITORY}`);
  }

  const contractFile = readFileSync(join(root, CONTRACT));
  const contract = JSON.parse(contractFile.toString('utf8'));

  const [artifactSha] = readFileSync(required(env, 'ARTIFACT_SHA256_FILE'), 'utf8')
    .trim()
    .split(/\s+/);

  const smokeLog = readFileSync(required(env, 'SMOKE_TEST_LOG'), 'utf8');
  if (!smokeLog.includes(SMOKE_PASSED)) {
    throw new Error('la prueba de humo no terminó con éxito');
  }

  return {
    schemaVersion: '1.0',
    kind,
    repository: REPOSITORY,
    component: 'web',
    version,
    tag,
    commit,
    expectedBffContract: {
      name: 'bff-web',
      version: contract.info.version,
      sha256: sha256(contractFile),
    },
    artifact: { name: 'web.tgz', sha256: artifactSha, source: '/usr/share/nginx/html' },
    checks: CHECKS[kind].map((check) => ({ ...check, status: 'passed' })),
    smokeTest: {
      status: 'passed',
      script: SMOKE_TEST_SCRIPT,
      scriptSha256: sha256(readFileSync(join(root, SMOKE_TEST_SCRIPT))),
      checksPassed: smokeLog.split(/\r?\n/).filter((line) => line.startsWith('ok ')).length,
    },
  };
}

function createdAt(env) {
  return env.CREATED_AT ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** `frontend-release.json` (Cloud Build): la imagen publicada, solo por digest. */
export function frontendRelease(env, root = ROOT) {
  const base = common('frontend-release', env, root);
  const uri = required(env, 'IMAGE_URI');
  const digest = /@(sha256:[0-9a-f]{64})$/.exec(uri)?.[1];
  if (!digest) {
    throw new Error(`IMAGE_URI '${uri}' no está fijada por digest sha256`);
  }
  return {
    ...base,
    image: { uri, digest },
    cloudBuild: {
      buildId: required(env, 'BUILD_ID'),
      projectId: required(env, 'PROJECT_ID'),
      location: required(env, 'LOCATION'),
    },
    createdAt: createdAt(env),
  };
}

/** `release-validation.json` (GitHub Actions): sin GCP; la imagen no se publica. */
export function releaseValidation(env, root = ROOT) {
  const base = common('release-validation', env, root);
  const runId = required(env, 'GITHUB_RUN_ID');
  return {
    ...base,
    localImage: { id: required(env, 'LOCAL_IMAGE_ID'), published: false },
    github: {
      workflow: 'release-web',
      runId,
      runUrl: `${required(env, 'GITHUB_SERVER_URL')}/${required(env, 'GITHUB_REPOSITORY')}/actions/runs/${runId}`,
    },
    createdAt: createdAt(env),
  };
}

export const BUILDERS = {
  'frontend-release': frontendRelease,
  'release-validation': releaseValidation,
};

export function loadSchema(kind, root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'deploy', 'release', `${kind}.schema.json`), 'utf8'));
}

/**
 * Valida `value` contra el subconjunto de JSON Schema que usan estos esquemas
 * (type, const, required, properties, additionalProperties, items, pattern,
 * minLength, minItems y minimum). Devuelve la lista de errores.
 */
export function validate(schema, value, path = '$') {
  const errors = [];
  if ('const' in schema && value !== schema.const) {
    errors.push(`${path}: debe ser ${JSON.stringify(schema.const)}`);
    return errors;
  }
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type === 'integer' ? !Number.isInteger(value) : schema.type && schema.type !== type) {
    errors.push(`${path}: debe ser de tipo ${schema.type}`);
    return errors;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: es demasiado corto`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: no cumple el patrón ${schema.pattern}`);
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: debe ser al menos ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: debe tener al menos ${schema.minItems} elementos`);
    }
    value.forEach((item, index) =>
      errors.push(...validate(schema.items ?? {}, item, `${path}[${index}]`)),
    );
  }
  if (type === 'object') {
    for (const name of schema.required ?? []) {
      if (!(name in value)) {
        errors.push(`${path}.${name}: es obligatorio`);
      }
    }
    for (const [name, item] of Object.entries(value)) {
      const property = schema.properties?.[name];
      if (property) {
        errors.push(...validate(property, item, `${path}.${name}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${name}: no está permitido`);
      }
    }
  }
  return errors;
}

/** Construye, valida y escribe el manifiesto; falla sin escribir si no cumple el esquema. */
export function writeManifest(kind, output, env = process.env, root = ROOT) {
  const build = BUILDERS[kind];
  if (!build) {
    throw new Error(`tipo de manifiesto desconocido: ${kind}`);
  }
  const manifest = build(env, root);
  const errors = validate(loadSchema(kind, root), manifest);
  if (errors.length > 0) {
    throw new Error(`el manifiesto no cumple ${kind}.schema.json:\n- ${errors.join('\n- ')}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [kind, output] = process.argv.slice(2);
  try {
    if (!kind || !output) {
      throw new Error('uso: release-manifest.mjs <frontend-release|release-validation> <salida>');
    }
    const manifest = writeManifest(kind, output);
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(`release-manifest: ${error.message}`);
    process.exit(1);
  }
}
