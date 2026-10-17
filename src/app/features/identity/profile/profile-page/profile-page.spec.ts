import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  DEMOGRAPHIC_RESPONSES,
  EMPTY_PROFILE,
  FULL_PROFILE,
  PHYSIOLOGICAL_RESPONSES,
  SIMULATED_HEALTH_CONSENT_VERSION,
  SIMULATED_PROFILE_CORRELATION_ID,
} from '../../../../../testing/bff-web/profile.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ApiError } from '../../../../core/api/api-error';
import { ProfileResponseDto } from '../../../../core/api/bff-web/profile.api';
import { APP_CONFIG, AppConfig } from '../../../../core/config/app-config';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { DemographicForm } from '../demographic-form/demographic-form';
import { PhysiologicalForm } from '../physiological-form/physiological-form';
import { ProfileGateway } from '../profile.gateway';
import {
  AthleteProfile,
  DemographicDraft,
  DemographicProfile,
  PhysiologicalDraft,
  PhysiologicalProfile,
  SaveOutcome,
  toAthleteProfile,
  toDemographicProfile,
  toPhysiologicalProfile,
} from '../profile.model';
import { PROFILE_PROJECTION_RETRY_DELAYS_MS, ProfilePage } from './profile-page';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.13.0.
const EMPTY: AthleteProfile = toAthleteProfile(EMPTY_PROFILE as ProfileResponseDto);
const FULL: AthleteProfile = toAthleteProfile(FULL_PROFILE as unknown as ProfileResponseDto);
const DEMOGRAPHIC_V1: DemographicProfile = FULL.demographic!;
const DEMOGRAPHIC_V2: DemographicProfile = toDemographicProfile(
  DEMOGRAPHIC_RESPONSES.replaced.body,
);
const PHYSIOLOGICAL_V1: PhysiologicalProfile = FULL.physiological!;
const PHYSIOLOGICAL_V2: PhysiologicalProfile = toPhysiologicalProfile(
  PHYSIOLOGICAL_RESPONSES.replaced.body,
);

const DEMOGRAPHIC_DRAFT: DemographicDraft = {
  birthDate: '1992-04-18',
  gender: 'FEMALE',
  countryCode: 'CO',
  city: 'Medellín',
  maritalStatus: 'SINGLE',
  occupation: 'Ingeniera',
  incomeRange: '2_4_SMMLV',
};

const PHYSIOLOGICAL_DRAFT: PhysiologicalDraft = {
  consentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
  measuredAt: '2026-10-12T13:00:00Z',
  weightKg: '68.5',
  heightCm: 172,
  restingHeartRateBpm: 58,
  bloodPressure: { systolic: 118, diastolic: 76 },
  bodyTemperatureC: '36.6',
};

const UNAVAILABLE: ApiError = {
  kind: 'server',
  status: 503,
  code: 'upstream_unavailable',
  correlationId: SIMULATED_PROFILE_CORRELATION_ID,
};

/** Palabras de clasificación clínica que la pantalla nunca muestra junto al IMC. */
const CLASSIFICATION_WORDS = /normal|sobrepeso|obesidad|bajo peso|riesgo|diagn[oó]stico/i;

function config(healthDataConsentVersion: string | null): AppConfig {
  return {
    environment: 'local',
    bffWebBaseUrl: 'http://bff-web.test',
    registrationPoliciesVersion: 'v-sintetica',
    healthDataConsentVersion,
  };
}

function saved<T>(section: T, created = false, replayed = false): SaveOutcome<T> {
  return { kind: 'saved', section, created, replayed };
}

describe('ProfilePage (HU005)', () => {
  let fixture: ComponentFixture<ProfilePage>;
  let element: HTMLElement;
  let gateway: jasmine.SpyObj<ProfileGateway>;

  function configure(consentVersion: string | null = SIMULATED_HEALTH_CONSENT_VERSION): void {
    gateway = jasmine.createSpyObj<ProfileGateway>('ProfileGateway', [
      'loadProfile',
      'saveDemographic',
      'savePhysiological',
    ]);
    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: ProfileGateway, useValue: gateway },
        { provide: APP_CONFIG, useValue: config(consentVersion) },
        { provide: PROFILE_PROJECTION_RETRY_DELAYS_MS, useValue: [0] },
      ],
    });
  }

  async function create(profile: AthleteProfile | Promise<AthleteProfile> = EMPTY): Promise<void> {
    gateway.loadProfile.and.returnValue(Promise.resolve(profile));
    fixture = TestBed.createComponent(ProfilePage);
    element = fixture.nativeElement as HTMLElement;
    await settle();
  }

  /** Deja correr promesas, temporizadores de 0 ms y renderizados pendientes. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Como `settle`, pero sigue hasta que se cumpla la condición (con un máximo de
   * rondas). Las cadenas largas (comando → recarga → recarga programada) pueden
   * necesitar más rondas en una máquina lenta, como la de CI.
   */
  async function settleUntil(condition: () => boolean, maxRounds = 50): Promise<void> {
    for (let round = 0; round < maxRounds && !condition(); round++) {
      await settle();
    }
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function button(text: string, scope: ParentNode = element): HTMLButtonElement | undefined {
    return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === text,
    );
  }

  async function click(text: string): Promise<void> {
    button(text)!.click();
    await settle();
  }

  function demographicForm(): DemographicForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof DemographicForm)
      .componentInstance as DemographicForm;
  }

  function physiologicalForm(): PhysiologicalForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof PhysiologicalForm)
      .componentInstance as PhysiologicalForm;
  }

  async function submitDemographic(draft: DemographicDraft = DEMOGRAPHIC_DRAFT): Promise<void> {
    demographicForm().submitted.emit(draft);
    await settle();
  }

  function demographicKeys(): string[] {
    return gateway.saveDemographic.calls.allArgs().map(([, , key]) => key);
  }

  describe('carga', () => {
    beforeEach(() => configure());

    it('muestra la carga mientras llega el perfil', async () => {
      await create(new Promise<AthleteProfile>(() => undefined));

      expect(element.querySelector('h1')?.textContent).toContain('Mi perfil');
      expect(testId('state-loading')).not.toBeNull();
      expect(testId('demographic-section')).toBeNull();
    });

    it('informa el error con su referencia y permite reintentar', async () => {
      await create(
        Promise.reject(
          new HttpErrorResponse({
            status: 503,
            error: { code: 'upstream_unavailable', correlation_id: 'ref-sintetica-05' },
          }),
        ),
      );

      const error = testId('state-error')!;
      expect(error.textContent).toContain('El servicio no está disponible');
      expect(error.textContent).toContain('ref-sintetica-05');
      expect(testId('demographic-empty')).toBeNull();

      gateway.loadProfile.and.resolveTo(FULL);
      await click('Reintentar');
      expect(gateway.loadProfile).toHaveBeenCalledTimes(2);
      expect(testId('demographic-summary')).not.toBeNull();
    });

    it('un perfil sin secciones invita a registrarlas, sin error', async () => {
      await create(EMPTY);

      expect(testId('state-error')).toBeNull();
      expect(testId('state-empty')).toBeNull();
      expect(testId('demographic-empty')?.textContent).toContain(
        'Aún no has registrado tus datos demográficos.',
      );
      expect(testId('physiological-empty')?.textContent).toContain(
        'Aún no has registrado tus datos fisiológicos.',
      );
      expect(button('Registrar datos demográficos')).toBeDefined();
      expect(button('Registrar datos fisiológicos')).toBeDefined();
      expect(testId('profile-projection-pending')).toBeNull();
    });

    it('CA1: muestra el perfil confirmado, con el IMC estimado y sin clasificaciones', async () => {
      await create(FULL);

      const demographic = testId('demographic-summary')!;
      expect(demographic.textContent).toContain('18 de abril de 1992');
      expect(demographic.textContent).toContain('Femenino');
      expect(demographic.textContent).toContain('Colombia (CO)');
      expect(demographic.textContent).toContain('Bogotá');
      expect(demographic.textContent).toContain('Soltero o soltera');
      expect(demographic.textContent).toContain('Entre 2 y 4 SMMLV');

      const physiological = testId('physiological-summary')!;
      expect(physiological.textContent).toContain('68,5 kg');
      expect(physiological.textContent).toContain('172 cm');
      expect(physiological.textContent).toContain('IMC estimado');
      expect(testId('physiological-bmi')?.textContent?.trim()).toBe('23,2');
      expect(physiological.textContent).toContain('58 lpm');
      expect(physiological.textContent).toContain('118/76 mmHg');
      expect(physiological.textContent).toContain('36,6 °C');
      expect(physiological.textContent).toContain(`Versión ${SIMULATED_HEALTH_CONSENT_VERSION}`);
      expect(testId('physiological-section')?.textContent).toContain('no una evaluación médica');
      expect(testId('profile-hu005')?.textContent).not.toMatch(CLASSIFICATION_WORDS);
      expect(button('Editar datos demográficos')?.disabled).toBeFalse();
      expect(button('Editar datos fisiológicos')?.disabled).toBeFalse();
    });

    it('presenta los datos personales y los hábitos como «Próximamente»', async () => {
      await create(FULL);

      for (const id of ['profile-personal-upcoming', 'profile-habits-upcoming']) {
        const section = testId(id)!;
        expect(section.querySelector('h2')?.textContent).toContain('Próximamente');
        expect(section.querySelector('button')).toBeNull();
      }
      expect(testId('profile-personal-upcoming')?.textContent).toContain('Datos personales');
      expect(testId('profile-habits-upcoming')?.textContent).toContain('Hábitos deportivos');
      expect([...element.querySelectorAll('h3')].map((h) => h.textContent?.trim())).toEqual([
        'Datos demográficos',
        'Datos fisiológicos',
      ]);
    });
  });

  describe('guardado', () => {
    beforeEach(() => configure());

    it('CA1: registra la sección (201) sin versión esperada y muestra la respuesta del comando', async () => {
      await create(EMPTY);
      gateway.saveDemographic.and.resolveTo(saved(DEMOGRAPHIC_V1, true));
      await click('Registrar datos demográficos');
      await submitDemographic();

      expect(gateway.saveDemographic).toHaveBeenCalledOnceWith(
        DEMOGRAPHIC_DRAFT,
        null,
        jasmine.stringMatching(/^[0-9a-f-]{36}$/),
        jasmine.any(Function),
      );
      const message = testId('demographic-saved')!;
      expect(message.getAttribute('role')).toBe('status');
      expect(message.textContent).toContain('Registramos tus datos demográficos.');
      expect(document.activeElement).toBe(message);
      // La proyección sigue vacía: se conserva la sección que confirmó el comando.
      expect(testId('demographic-summary')?.textContent).toContain('Bogotá');
      expect(testId('demographic-form')).toBeNull();
      expect(testId('profile-projection-pending')).toBeNull();
    });

    it('CA1: reemplaza la sección (200) con la versión mostrada y presenta la nueva', async () => {
      await create(FULL);
      gateway.saveDemographic.and.resolveTo(saved(DEMOGRAPHIC_V2));
      await click('Editar datos demográficos');

      expect(demographicForm().initial()).toEqual(DEMOGRAPHIC_V1);
      await submitDemographic();

      expect(gateway.saveDemographic.calls.mostRecent().args[1]).toBe(1);
      expect(testId('demographic-saved')?.textContent).toContain(
        'Actualizamos tus datos demográficos.',
      );
      expect(testId('demographic-summary')?.textContent).toContain('Medellín');
      expect(testId('demographic-replayed')).toBeNull();

      // El siguiente reemplazo parte de la versión confirmada y usa otra clave.
      await click('Editar datos demográficos');
      await submitDemographic();
      expect(gateway.saveDemographic.calls.mostRecent().args[1]).toBe(2);
      expect(demographicKeys()[1]).not.toBe(demographicKeys()[0]);
    });

    it('CA6: informa que la respuesta corresponde a un envío anterior', async () => {
      await create(FULL);
      gateway.saveDemographic.and.resolveTo(saved(DEMOGRAPHIC_V2, false, true));
      await click('Editar datos demográficos');
      await submitDemographic();

      expect(testId('demographic-replayed')?.textContent).toContain('no se duplicó el registro');
    });

    it('CA6: un conflicto no sobrescribe, recarga y muestra los valores vigentes', async () => {
      await create(FULL);
      gateway.saveDemographic.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      gateway.loadProfile.and.resolveTo({ ...FULL, demographic: DEMOGRAPHIC_V2 });
      await click('Editar datos demográficos');
      await submitDemographic();

      const conflict = testId('demographic-conflict')!;
      expect(conflict.getAttribute('role')).toBe('alert');
      expect(conflict.textContent).toContain('no se sobrescribieron');
      expect(document.activeElement).toBe(conflict);
      expect(testId('demographic-form')).toBeNull();
      expect(testId('demographic-saved')).toBeNull();
      expect(gateway.loadProfile).toHaveBeenCalledTimes(2);
      expect(testId('demographic-summary')?.textContent).toContain('Medellín');
      expect(testId('state-loading')).toBeNull();
      expect(testId('profile-projection-pending')).toBeNull();

      gateway.saveDemographic.and.resolveTo(saved({ ...DEMOGRAPHIC_V2, version: 3 }));
      await click('Editar datos demográficos');
      await submitDemographic();
      expect(gateway.saveDemographic.calls.mostRecent().args[1]).toBe(2);
      expect(demographicKeys()[1]).not.toBe(demographicKeys()[0]);
    });

    it('CA2: entrega al formulario las reglas incumplidas y no presenta nada como guardado', async () => {
      await create(EMPTY);
      const violations = [{ field: 'birth_date', issue: 'out_of_range' }];
      gateway.saveDemographic.and.resolveTo({ kind: 'invalid', violations });
      await click('Registrar datos demográficos');
      await submitDemographic();

      expect(demographicForm().serverErrors()).toEqual(violations);
      expect(testId('demographic-errors')).not.toBeNull();
      expect(testId('demographic-saved')).toBeNull();
      expect(testId('demographic-summary')).toBeNull();

      // Corregir y volver a enviar es otro intento solo si se editan los datos.
      gateway.saveDemographic.and.resolveTo(saved(DEMOGRAPHIC_V1, true));
      await submitDemographic();
      expect(demographicKeys()[1]).toBe(demographicKeys()[0]);
    });

    it('tras un fallo recuperable, reintentar usa la misma clave; editar la renueva', async () => {
      await create(EMPTY);
      gateway.saveDemographic.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
      await click('Registrar datos demográficos');
      await submitDemographic();

      const error = testId('demographic-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('El servicio no está disponible');
      expect(error.textContent).toContain('no se duplicará el registro');
      expect(error.textContent).toContain(SIMULATED_PROFILE_CORRELATION_ID);
      expect(testId('demographic-form')).not.toBeNull();

      await submitDemographic();
      expect(demographicKeys()[1]).toBe(demographicKeys()[0]);

      demographicForm().edited.emit();
      await submitDemographic();
      expect(demographicKeys()[2]).not.toBe(demographicKeys()[1]);
    });

    it('idempotency_key_reused se explica y el siguiente envío usa otra clave', async () => {
      await create(EMPTY);
      gateway.saveDemographic.and.resolveTo({
        kind: 'failed',
        error: {
          kind: 'conflict',
          status: 409,
          code: 'idempotency_key_reused',
          correlationId: null,
        },
      });
      await click('Registrar datos demográficos');
      await submitDemographic();

      const error = testId('demographic-error')!;
      expect(error.textContent).toContain('No pudimos confirmar el envío');
      expect(error.textContent).not.toContain('no se duplicará el registro');
      await submitDemographic();
      expect(demographicKeys()[1]).not.toBe(demographicKeys()[0]);
    });

    it('CA5: un rechazo por permiso se informa sin datos', async () => {
      await create(EMPTY);
      gateway.saveDemographic.and.resolveTo({
        kind: 'failed',
        error: { kind: 'forbidden', status: 403, code: 'permission_required', correlationId: null },
      });
      await click('Registrar datos demográficos');
      await submitDemographic();

      expect(testId('demographic-error')?.textContent).toContain(
        'No tienes permiso para realizar esta acción.',
      );
      expect(testId('demographic-saved')).toBeNull();
    });

    it('una excepción inesperada del gateway se presenta como error, no como éxito', async () => {
      await create(EMPTY);
      gateway.saveDemographic.and.rejectWith(new Error('fallo sintético'));
      await click('Registrar datos demográficos');
      await submitDemographic();

      expect(testId('demographic-error')?.textContent).toContain('Ocurrió un error inesperado.');
      expect(testId('demographic-saved')).toBeNull();
    });

    it('no envía dos veces mientras el guardado está en curso', async () => {
      await create(EMPTY);
      gateway.saveDemographic.and.returnValue(new Promise(() => undefined));
      await click('Registrar datos demográficos');
      demographicForm().submitted.emit(DEMOGRAPHIC_DRAFT);
      demographicForm().submitted.emit(DEMOGRAPHIC_DRAFT);
      await settle();

      expect(gateway.saveDemographic).toHaveBeenCalledTimes(1);
      expect(button('Guardar datos demográficos')?.disabled).toBeTrue();
    });

    it('avisa los reintentos automáticos mientras ocurren', async () => {
      await create(EMPTY);
      let finish!: (outcome: SaveOutcome<DemographicProfile>) => void;
      gateway.saveDemographic.and.callFake((_draft, _version, _key, onRetry) => {
        onRetry?.(2);
        return new Promise((resolve) => (finish = resolve));
      });
      await click('Registrar datos demográficos');
      await submitDemographic();

      expect(testId('demographic-retrying')?.textContent).toContain(
        'Reintentando guardar tus datos demográficos (2 de 3)',
      );
      finish(saved(DEMOGRAPHIC_V1, true));
      await settle();
      expect(testId('demographic-retrying')).toBeNull();
      expect(testId('demographic-saved')).not.toBeNull();
    });

    it('cancelar vuelve a la vista sin enviar y descarta la clave', async () => {
      await create(FULL);
      gateway.saveDemographic.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
      await click('Editar datos demográficos');
      await submitDemographic();
      await click('Cancelar');

      expect(testId('demographic-form')).toBeNull();
      expect(testId('demographic-error')).toBeNull();
      expect(testId('demographic-summary')?.textContent).toContain('Bogotá');

      await click('Editar datos demográficos');
      await submitDemographic();
      expect(demographicKeys()[1]).not.toBe(demographicKeys()[0]);
    });

    it('CA1 y CA3: guarda los fisiológicos con el consentimiento y muestra el IMC del backend', async () => {
      await create(EMPTY);
      gateway.savePhysiological.and.resolveTo(saved(PHYSIOLOGICAL_V1, true));
      await click('Registrar datos fisiológicos');

      expect(physiologicalForm().consentVersion()).toBe(SIMULATED_HEALTH_CONSENT_VERSION);
      physiologicalForm().submitted.emit(PHYSIOLOGICAL_DRAFT);
      await settle();

      expect(gateway.savePhysiological).toHaveBeenCalledOnceWith(
        PHYSIOLOGICAL_DRAFT,
        null,
        jasmine.any(String),
        jasmine.any(Function),
      );
      expect(testId('physiological-saved')?.textContent).toContain(
        'Registramos tus datos fisiológicos.',
      );
      expect(testId('physiological-bmi')?.textContent?.trim()).toBe('23,2');
    });

    it('CA3: el rechazo del consentimiento llega al formulario fisiológico', async () => {
      await create(FULL);
      const violations = [{ field: 'consent.version', issue: 'unsupported_consent_version' }];
      gateway.savePhysiological.and.resolveTo({ kind: 'invalid', violations });
      await click('Editar datos fisiológicos');

      expect(physiologicalForm().initial()).toEqual(PHYSIOLOGICAL_V1);
      physiologicalForm().submitted.emit(PHYSIOLOGICAL_DRAFT);
      await settle();

      expect(gateway.savePhysiological.calls.mostRecent().args[1]).toBe(1);
      expect(physiologicalForm().serverErrors()).toEqual(violations);
      expect(testId('physiological-consent-error')?.textContent).toContain(
        'acepta la versión actual',
      );
    });

    it('CA4: no escribe en consola ni en almacenamiento durante un guardado completo', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        spyOn(console, method),
      );
      const storage = spyOn(Storage.prototype, 'setItem');

      await create(EMPTY);
      gateway.saveDemographic.and.resolveTo(saved(DEMOGRAPHIC_V1, true));
      gateway.savePhysiological.and.resolveTo(saved(PHYSIOLOGICAL_V1, true));
      await click('Registrar datos demográficos');
      await submitDemographic();
      await click('Registrar datos fisiológicos');
      physiologicalForm().submitted.emit(PHYSIOLOGICAL_DRAFT);
      await settle();

      expect(testId('physiological-saved')).not.toBeNull();
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(storage).not.toHaveBeenCalled();
    });
  });

  describe('proyección', () => {
    beforeEach(() => configure());

    it('conserva la sección confirmada mientras la proyección está atrasada', async () => {
      await create(FULL);
      gateway.savePhysiological.and.resolveTo(saved(PHYSIOLOGICAL_V2));
      await click('Editar datos fisiológicos');
      physiologicalForm().submitted.emit(PHYSIOLOGICAL_DRAFT);
      await settle();

      expect(testId('physiological-summary')?.textContent).toContain('70,0 kg');
      expect(testId('physiological-bmi')?.textContent?.trim()).toBe('23,7');
      expect(button('Editar datos fisiológicos')?.disabled).toBeFalse();
    });

    it('tras un conflicto sin proyección al día, agota las recargas y ofrece actualizar', async () => {
      await create(FULL);
      gateway.saveDemographic.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      // La proyección sigue en la versión 1.
      gateway.loadProfile.and.resolveTo(FULL);
      await click('Editar datos demográficos');
      await submitDemographic();
      await settleUntil(() => testId('profile-projection-pending') !== null);

      // Carga inicial, recarga tras el conflicto y una recarga programada ([0]).
      expect(gateway.loadProfile).toHaveBeenCalledTimes(3);
      const pending = testId('profile-projection-pending')!;
      expect(pending.getAttribute('role')).toBe('status');
      expect(pending.textContent).toContain('Algunos datos aún se están actualizando');
      expect(testId('demographic-summary')?.textContent).toContain('Bogotá');
      expect(button('Editar datos demográficos')?.disabled).toBeTrue();
      expect(button('Editar datos fisiológicos')?.disabled).toBeFalse();

      gateway.loadProfile.and.resolveTo({ ...FULL, demographic: DEMOGRAPHIC_V2 });
      testId('profile-refresh')!.click();
      await settle();

      expect(testId('profile-projection-pending')).toBeNull();
      expect(testId('demographic-summary')?.textContent).toContain('Medellín');
      expect(button('Editar datos demográficos')?.disabled).toBeFalse();
    });

    it('si la recarga falla, conserva lo mostrado y ofrece actualizar', async () => {
      await create(FULL);
      gateway.saveDemographic.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      gateway.loadProfile.and.rejectWith(new HttpErrorResponse({ status: 503 }));
      await click('Editar datos demográficos');
      await submitDemographic();

      expect(testId('profile-projection-pending')).not.toBeNull();
      expect(testId('profile-refresh')).not.toBeNull();
      expect(testId('state-error')).toBeNull();
      expect(testId('demographic-summary')?.textContent).toContain('Bogotá');
    });

    it('limpia la recarga programada al destruirse', async () => {
      configureDelays([60_000]);
      await create(FULL);
      gateway.saveDemographic.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      await click('Editar datos demográficos');
      await submitDemographic();
      const calls = gateway.loadProfile.calls.count();

      fixture.destroy();
      await new Promise((resolve) => setTimeout(resolve));
      expect(gateway.loadProfile.calls.count()).toBe(calls);
    });
  });

  describe('sin versión de consentimiento configurada', () => {
    beforeEach(() => configure(null));

    it('no permite registrar los fisiológicos, pero muestra los existentes', async () => {
      await create(FULL);

      expect(testId('physiological-unavailable')?.textContent).toContain(
        'no está disponible en este ambiente',
      );
      expect(testId('physiological-summary')).not.toBeNull();
      expect(button('Editar datos fisiológicos')).toBeUndefined();
      expect(button('Editar datos demográficos')).toBeDefined();
    });

    it('sin sección fisiológica no ofrece registrarla', async () => {
      await create(EMPTY);

      expect(testId('physiological-unavailable')).not.toBeNull();
      expect(button('Registrar datos fisiológicos')).toBeUndefined();
      expect(button('Registrar datos demográficos')).toBeDefined();
    });
  });

  function configureDelays(delays: readonly number[]): void {
    TestBed.overrideProvider(PROFILE_PROJECTION_RETRY_DELAYS_MS, { useValue: delays });
  }
});
