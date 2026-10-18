/**
 * Pruebas de los scripts de release y de las restricciones de los pipelines:
 *
 *   npm run release:test      (node --test deploy/release/)
 *
 * Cubren la validación de entradas, los manifiestos frente a sus JSON Schema y
 * reglas de seguridad verificables en el texto de cloudbuild.release.yaml y de los
 * workflows: GitHub sin acceso a GCP y Cloud Build sin despliegue ni `latest`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  frontendRelease,
  loadSchema,
  releaseValidation,
  validate,
  writeManifest,
} from './release-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const REGISTRY = 'us-central1-docker.pkg.dev/sportapp-prod';

function validateRelease(...args) {
  return spawnSync('bash', ['deploy/release/validate-release.sh', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

/** Archivos de entrada sintéticos de un pipeline que terminó bien. */
function inputs(
  smokeLog = 'ok   - GET / -> 200\nok   - GET /healthz\nPrueba de humo del contenedor: OK\n',
) {
  const dir = mkdtempSync(join(tmpdir(), 'release-test-'));
  writeFileSync(join(dir, 'web.tgz.sha256'), `${'b'.repeat(64)}  web.tgz\n`);
  writeFileSync(join(dir, 'smoke-test.log'), smokeLog);
  return {
    dir,
    env: {
      RELEASE_TAG: 'v1.4.0-rc.1',
      COMMIT_SHA: COMMIT,
      REPO_FULL_NAME: 'lfnavarroj1/sport-app-frontend',
      ARTIFACT_SHA256_FILE: join(dir, 'web.tgz.sha256'),
      SMOKE_TEST_LOG: join(dir, 'smoke-test.log'),
      CREATED_AT: '2026-10-18T12:00:00Z',
    },
  };
}

const CLOUD_BUILD = {
  IMAGE_URI: `${REGISTRY}/sportapp-frontend/web@${DIGEST}`,
  BUILD_ID: '3f2b6c1e-8a4d-4f2e-9b1c-7d6e5f4a3b2c',
  PROJECT_ID: 'sportapp-prod',
  LOCATION: 'us-central1',
};

const GITHUB = {
  LOCAL_IMAGE_ID: `sha256:${'c'.repeat(64)}`,
  GITHUB_RUN_ID: '123456789',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'lfnavarroj1/sport-app-frontend',
};

describe('validate-release.sh', () => {
  for (const tag of ['v0.0.1', 'v1.2.3', 'v10.20.30', 'v1.2.3-rc.1', 'v1.2.3-alpha-2']) {
    it(`acepta ${tag} e imprime la versión`, () => {
      const result = validateRelease(tag, COMMIT, REGISTRY, 'sportapp-frontend');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), tag.slice(1));
    });
  }

  for (const tag of ['1.2.3', 'v1.2', 'v01.2.3', 'v1.2.3+build.5', 'latest', 'v1.2.3-', '']) {
    it(`rechaza el tag «${tag}»`, () => {
      assert.equal(validateRelease(tag).status, 64);
    });
  }

  it('rechaza un commit abreviado o en mayúsculas', () => {
    assert.equal(validateRelease('v1.2.3', COMMIT.slice(0, 12)).status, 64);
    assert.equal(validateRelease('v1.2.3', COMMIT.toUpperCase()).status, 64);
  });

  it('exige un registro de Artifact Registry y un repositorio válidos', () => {
    assert.equal(
      validateRelease('v1.2.3', COMMIT, 'docker.io/sportapp', 'sportapp-frontend').status,
      64,
    );
    assert.equal(validateRelease('v1.2.3', COMMIT, REGISTRY, 'Sportapp_Frontend').status, 64);
  });
});

describe('frontend-release.json (Cloud Build)', () => {
  it('cumple su esquema e identifica la imagen solo por digest', () => {
    const { env } = inputs();
    const manifest = frontendRelease({ ...env, ...CLOUD_BUILD });

    assert.deepEqual(validate(loadSchema('frontend-release'), manifest), []);
    assert.equal(manifest.version, '1.4.0-rc.1');
    assert.equal(manifest.tag, 'v1.4.0-rc.1');
    assert.equal(manifest.image.digest, DIGEST);
    assert.equal(manifest.expectedBffContract.name, 'bff-web');
    assert.equal(
      manifest.expectedBffContract.version,
      JSON.parse(read('src/app/core/api/contracts/bff-web.openapi.json')).info.version,
    );
    assert.equal(manifest.smokeTest.checksPassed, 2);
    assert.equal(manifest.cloudBuild.buildId, CLOUD_BUILD.BUILD_ID);
    assert.ok(manifest.checks.every((check) => check.status === 'passed'));
  });

  it('rechaza una imagen referenciada por tag (referencia mutable)', () => {
    const { env } = inputs();
    assert.throws(
      () =>
        frontendRelease({
          ...env,
          ...CLOUD_BUILD,
          IMAGE_URI: `${REGISTRY}/sportapp-frontend/web:latest`,
        }),
      /digest sha256/,
    );
  });

  it('no se genera si la prueba de humo no terminó con éxito', () => {
    const { env } = inputs('ok   - GET / -> 200\nFAIL - /healthz no respondió\n');
    assert.throws(() => frontendRelease({ ...env, ...CLOUD_BUILD }), /prueba de humo/);
  });

  it('rechaza otro repositorio o un tag que no es SemVer', () => {
    const { env } = inputs();
    assert.throws(
      () => frontendRelease({ ...env, ...CLOUD_BUILD, REPO_FULL_NAME: 'otro/repo' }),
      /no es lfnavarroj1\/sport-app-frontend/,
    );
    assert.throws(
      () => frontendRelease({ ...env, ...CLOUD_BUILD, RELEASE_TAG: 'latest' }),
      /SemVer/,
    );
  });

  it('el esquema rechaza campos extra y una imagen fuera de Artifact Registry', () => {
    const { env } = inputs();
    const manifest = frontendRelease({ ...env, ...CLOUD_BUILD });
    const schema = loadSchema('frontend-release');

    assert.notDeepEqual(validate(schema, { ...manifest, token: 'x' }), []);
    assert.notDeepEqual(
      validate(schema, {
        ...manifest,
        image: { ...manifest.image, uri: `docker.io/web@${DIGEST}` },
      }),
      [],
    );
  });

  it('writeManifest escribe el archivo validado y no contiene secretos', () => {
    const { dir, env } = inputs();
    const output = join(dir, 'dist', 'frontend-release.json');
    writeManifest('frontend-release', output, { ...env, ...CLOUD_BUILD });

    const text = readFileSync(output, 'utf8');
    assert.deepEqual(validate(loadSchema('frontend-release'), JSON.parse(text)), []);
    assert.doesNotMatch(text, /token|password|secret|private_key|:latest/i);
  });
});

describe('release-validation.json (GitHub, sin GCP)', () => {
  it('cumple su esquema y declara que la imagen no se publicó', () => {
    const { env } = inputs();
    const manifest = releaseValidation({ ...env, ...GITHUB });

    assert.deepEqual(validate(loadSchema('release-validation'), manifest), []);
    assert.equal(manifest.localImage.published, false);
    assert.equal(
      manifest.github.runUrl,
      'https://github.com/lfnavarroj1/sport-app-frontend/actions/runs/123456789',
    );
    assert.ok(manifest.checks.some((check) => check.name === 'e2e'));
    assert.equal('image' in manifest, false);
    assert.equal('cloudBuild' in manifest, false);
  });
});

describe('restricciones de los pipelines', () => {
  const cloudbuild = read('cloudbuild.release.yaml');
  const workflows = ['.github/workflows/ci-web.yml', '.github/workflows/release-web.yml'].map(
    (path) => [path, read(path)],
  );
  /** Líneas sin comentarios: las reglas se aplican a lo que se ejecuta. */
  const code = (text) =>
    text
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  for (const [path, text] of workflows) {
    it(`${path} no se autentica en GCP ni publica o despliega`, () => {
      const source = code(text);
      for (const forbidden of [
        /google-github-actions/,
        /id-token:\s*write/,
        /docker\/login-action/,
        /docker push/,
        /gcloud/,
        /terraform|tofu/i,
        /kubectl/,
        /vars\.GCP|secrets\.GCP/,
        /pkg\.dev/,
        /:latest/,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} contiene ${forbidden}`);
      }
    });
  }

  it('release-web.yml solo se dispara al publicar un GitHub Release y con permisos de lectura', () => {
    const release = code(read('.github/workflows/release-web.yml'));
    assert.match(release, /on:\s*\n\s*release:\s*\n\s*types: \[published\]/);
    assert.doesNotMatch(release, /^\s*(push|pull_request|workflow_dispatch):/m);
    assert.doesNotMatch(release, /:\s*write\b/);
  });

  it('cloudbuild.release.yaml no despliega, no administra infraestructura ni elige su cuenta', () => {
    const source = code(cloudbuild);
    for (const forbidden of [
      /gcloud\s+run/,
      /gcloud\s+deploy/,
      /terraform|tofu/i,
      /kubectl/,
      /iam|set-iam-policy/i,
      /secrets/i,
      /:latest/,
      /serviceAccount/,
      /logsBucket/,
      /^images:/m,
    ]) {
      assert.doesNotMatch(source, forbidden, `cloudbuild.release.yaml contiene ${forbidden}`);
    }
    assert.match(source, /logging: CLOUD_LOGGING_ONLY/);
  });

  it('cloudbuild.release.yaml usa imágenes de pasos fijadas por digest', () => {
    const images = [...code(cloudbuild).matchAll(/^\s*name: '([^']+)'/gm)].map((match) => match[1]);
    assert.ok(images.length >= 10);
    for (const image of images) {
      assert.match(image, /@sha256:[0-9a-f]{64}$/, image);
    }
  });

  it('las etapas de Cloud Build construyen una vez y no despliegan', () => {
    const stages = code(read('deploy/release/cloudbuild-release.sh'));
    assert.equal(stages.match(/docker build/g)?.length, 1);
    assert.doesNotMatch(stages, /gcloud\s+(run|deploy|iam|projects|services|compute|secrets)/);
    assert.doesNotMatch(stages, /:latest/);
    assert.match(stages, /--if-generation-match=0/);
  });
});
