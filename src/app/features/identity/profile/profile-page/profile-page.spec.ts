import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  DEMOGRAPHIC_RESPONSES,
  EMPTY_PROFILE,
  FULL_PROFILE,
  NUTRITION_HABITS_RESPONSES,
  PHYSIOLOGICAL_RESPONSES,
  PROFILE_WITH_NUTRITION_HABITS,
  PROFILE_WITH_SPORT_HABITS,
  SIMULATED_HEALTH_CONSENT_VERSION,
  SIMULATED_PROFILE_CORRELATION_ID,
  SPORT_HABITS_RESPONSES,
} from '../../../../../testing/bff-web/profile.fixtures';
import { ACCOUNT_READ } from '../../../../../testing/bff-web/account.fixtures';
import { ACCOUNT_STATEMENT_RESPONSES } from '../../../../../testing/bff-web/account-statement.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ApiError } from '../../../../core/api/api-error';
import { ProfileResponseDto } from '../../../../core/api/bff-web/profile.api';
import { APP_CONFIG, AppConfig } from '../../../../core/config/app-config';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { AccountStatementGateway } from '../../../affiliation/account-statement/account-statement.gateway';
import { toAccountStatement } from '../../../affiliation/account-statement/account-statement.model';
import { AccountGateway } from '../account-form/account.gateway';
import { toAccount } from '../account-form/account.model';
import { DemographicForm } from '../demographic-form/demographic-form';
import { NutritionHabitsForm } from '../nutrition-habits-form/nutrition-habits-form';
import { PhysiologicalForm } from '../physiological-form/physiological-form';
import { ProfileGateway } from '../profile.gateway';
import {
  AthleteProfile,
  DemographicDraft,
  DemographicProfile,
  NutritionHabits,
  NutritionHabitsDraft,
  PhysiologicalDraft,
  PhysiologicalProfile,
  SaveOutcome,
  SportHabits,
  SportHabitsDraft,
  toAthleteProfile,
  toDemographicProfile,
  toNutritionHabits,
  toPhysiologicalProfile,
  toSportHabits,
} from '../profile.model';
import { SportHabitsForm } from '../sport-habits-form/sport-habits-form';
import {
  PROFILE_PROJECTION_RETRY_DELAYS_MS,
  PROFILE_SCOPE,
  ProfilePage,
  ProfileScope,
} from './profile-page';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.16.0.
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
const WITH_HABITS: AthleteProfile = toAthleteProfile(
  PROFILE_WITH_SPORT_HABITS as unknown as ProfileResponseDto,
);
const HABITS_V1: SportHabits = WITH_HABITS.sportHabits!;
const HABITS_V2: SportHabits = toSportHabits(SPORT_HABITS_RESPONSES.replaced.body);

const WITH_NUTRITION: AthleteProfile = toAthleteProfile(
  PROFILE_WITH_NUTRITION_HABITS as unknown as ProfileResponseDto,
);
const NUTRITION_V1: NutritionHabits = WITH_NUTRITION.nutritionHabits!;
const NUTRITION_V2: NutritionHabits = toNutritionHabits(NUTRITION_HABITS_RESPONSES.replaced.body);

const NUTRITION_DRAFT: NutritionHabitsDraft = {
  consentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
  dietPattern: NUTRITION_V1.dietPattern,
  restrictions: NUTRITION_V1.restrictions,
  allergies: NUTRITION_V1.allergies,
  mealsPerDay: NUTRITION_V1.mealsPerDay,
  hydrationLitersPerDay: NUTRITION_V1.hydrationLitersPerDay,
};

const HABITS_DRAFT: SportHabitsDraft = {
  sports: HABITS_V1.sports,
  days: HABITS_V1.days,
  timeSlots: HABITS_V1.timeSlots,
  primaryGoal: HABITS_V1.primaryGoal,
};

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
  let accountGateway: jasmine.SpyObj<AccountGateway>;
  let statementGateway: jasmine.SpyObj<AccountStatementGateway>;

  function configure(
    consentVersion: string | null = SIMULATED_HEALTH_CONSENT_VERSION,
    scope: ProfileScope = 'athlete',
  ): void {
    // HU002: «Datos personales» se prueba en `account-section.spec.ts`; aquí solo carga.
    accountGateway = jasmine.createSpyObj<AccountGateway>('AccountGateway', [
      'loadAccount',
      'saveAccount',
    ]);
    accountGateway.loadAccount.and.resolveTo(toAccount(ACCOUNT_READ));
    // HU007: «Estado de cuenta» se prueba en `account-statement-section.spec.ts`; aquí solo carga.
    statementGateway = jasmine.createSpyObj<AccountStatementGateway>('AccountStatementGateway', [
      'load',
      'loadMore',
    ]);
    statementGateway.load.and.resolveTo(
      toAccountStatement(ACCOUNT_STATEMENT_RESPONSES.notApplicable.body),
    );
    gateway = jasmine.createSpyObj<ProfileGateway>('ProfileGateway', [
      'loadProfile',
      'saveDemographic',
      'savePhysiological',
      'saveSportHabits',
      'saveNutritionHabits',
    ]);
    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: ProfileGateway, useValue: gateway },
        { provide: AccountGateway, useValue: accountGateway },
        { provide: AccountStatementGateway, useValue: statementGateway },
        { provide: PROFILE_SCOPE, useValue: scope },
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

    it('HU002: empieza con los datos personales y presenta los hábitos como sección propia', async () => {
      await create(FULL);

      const personal = testId('profile-hu002')!;
      expect(personal.querySelector('h2')?.textContent?.trim()).toBe('Datos personales');
      expect(personal.textContent).not.toContain('Próximamente');
      expect(button('Editar datos personales', personal)).toBeDefined();
      expect(accountGateway.loadAccount).toHaveBeenCalledTimes(1);
      expect(testId('profile-habits-upcoming')).toBeNull();
      const habits = testId('profile-hu006')!;
      expect(habits.querySelector('h2')?.textContent?.trim()).toBe('Hábitos deportivos');
      expect(habits.textContent).not.toContain('Próximamente');
      expect([...element.querySelectorAll('h2')].map((h) => h.textContent?.trim())).toEqual([
        'Datos personales',
        'Datos demográficos y fisiológicos',
        'Hábitos deportivos',
        'Hábitos alimenticios',
        'Estado de cuenta',
      ]);
      expect(statementGateway.load).toHaveBeenCalledTimes(1);
      expect([...element.querySelectorAll('h3')].map((h) => h.textContent?.trim())).toEqual([
        'Datos demográficos',
        'Datos fisiológicos',
      ]);
    });
  });

  describe('organizador y profesional (HU002)', () => {
    beforeEach(() => configure(SIMULATED_HEALTH_CONSENT_VERSION, 'account'));

    it('solo muestra los datos personales y no consulta el perfil deportivo', async () => {
      await create(FULL);

      expect(gateway.loadProfile).not.toHaveBeenCalled();
      expect(accountGateway.loadAccount).toHaveBeenCalledTimes(1);
      expect(element.querySelector('h1')?.textContent?.trim()).toBe('Mi perfil');
      expect(element.querySelector('header p')?.textContent?.trim()).toBe(
        'Consulta y mantén al día tus datos personales.',
      );
      expect([...element.querySelectorAll('h2')].map((h) => h.textContent?.trim())).toEqual([
        'Datos personales',
        'Estado de cuenta',
      ]);
      // HU007: el estado de cuenta también es de estos actores (CA2).
      expect(statementGateway.load).toHaveBeenCalledTimes(1);
      expect(testId('account-statement-not-applicable')).not.toBeNull();
      expect(testId('profile-hu005')).toBeNull();
      expect(testId('profile-hu006')).toBeNull();
      expect(testId('profile-hu009')).toBeNull();
      expect(element.textContent).not.toContain('deportista');
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

  describe('hábitos deportivos (HU006)', () => {
    beforeEach(() => configure());

    function habitsForm(): SportHabitsForm {
      return fixture.debugElement.query((el) => el.componentInstance instanceof SportHabitsForm)
        .componentInstance as SportHabitsForm;
    }

    async function submitHabits(draft: SportHabitsDraft = HABITS_DRAFT): Promise<void> {
      habitsForm().submitted.emit(draft);
      await settle();
    }

    function habitKeys(): string[] {
      return gateway.saveSportHabits.calls.allArgs().map(([, , key]) => key);
    }

    it('sin hábitos invita a registrarlos, sin error', async () => {
      await create(FULL);

      expect(testId('sport-habits-empty')?.textContent).toContain(
        'Aún no has registrado tus hábitos deportivos.',
      );
      expect(button('Registrar hábitos deportivos')).toBeDefined();
      expect(testId('profile-hu006')?.textContent).toContain(
        'Registrarlos no crea planes ni recomendaciones.',
      );
      expect(testId('state-error')).toBeNull();
    });

    it('muestra la carga y el error del perfil también en la sección de hábitos', async () => {
      await create(Promise.reject(new HttpErrorResponse({ status: 503 })));

      const section = testId('profile-hu006')!;
      expect(section.querySelector('[data-testid="state-error"]')).not.toBeNull();
      expect(testId('sport-habits-section')).toBeNull();
    });

    it('CA1: muestra los hábitos proyectados con sus catálogos y unidades', async () => {
      await create(WITH_HABITS);

      const first = testId('sport-habit-0')!;
      expect(first.textContent).toContain('Carrera');
      expect(first.textContent).toContain('3 veces por semana');
      expect(first.textContent).toContain('45 min por sesión');
      expect(first.textContent).toContain('Intensidad: Moderada');
      expect(first.textContent).toContain('Nivel: Intermedio');
      expect(first.textContent).toContain('4 años practicándolo');
      const second = testId('sport-habit-1')!;
      expect(second.textContent).toContain('Natación');
      expect(second.textContent).toContain('1 vez por semana');
      expect(second.textContent).toContain('Años de práctica sin especificar');
      expect(
        [...testId('sport-habits-days')!.querySelectorAll('li')].map((li) =>
          li.textContent?.trim(),
        ),
      ).toEqual(['Lunes', 'Miércoles', 'Sábado']);
      expect(testId('sport-habits-time-slots')?.textContent?.trim()).toBe('Mañana');
      expect(testId('sport-habits-goal')?.textContent?.trim()).toBe('Salud');
      expect(button('Editar hábitos deportivos')?.disabled).toBeFalse();
    });

    it('CA1: registra (201) sin versión esperada y muestra la respuesta del comando', async () => {
      await create(FULL);
      gateway.saveSportHabits.and.resolveTo(saved(HABITS_V1, true));
      await click('Registrar hábitos deportivos');
      await submitHabits();

      expect(gateway.saveSportHabits).toHaveBeenCalledOnceWith(
        HABITS_DRAFT,
        null,
        jasmine.stringMatching(/^[0-9a-f-]{36}$/),
        jasmine.any(Function),
      );
      const message = testId('sport-habits-saved')!;
      expect(message.getAttribute('role')).toBe('status');
      expect(message.textContent).toContain('Registramos tus hábitos deportivos.');
      expect(document.activeElement).toBe(message);
      // La proyección aún no tiene hábitos: se conserva la sección que confirmó el comando.
      expect(testId('sport-habit-0')?.textContent).toContain('Carrera');
      expect(testId('sport-habits-form')).toBeNull();
      // Las secciones de HU005 no cambian.
      expect(gateway.saveDemographic).not.toHaveBeenCalled();
      expect(testId('demographic-summary')?.textContent).toContain('Bogotá');
    });

    it('CA1: reemplaza (200) con la versión mostrada y presenta la nueva', async () => {
      await create(WITH_HABITS);
      gateway.saveSportHabits.and.resolveTo(saved(HABITS_V2));
      await click('Editar hábitos deportivos');

      expect(habitsForm().initial()).toEqual(HABITS_V1);
      await submitHabits();

      expect(gateway.saveSportHabits.calls.mostRecent().args[1]).toBe(1);
      expect(testId('sport-habits-saved')?.textContent).toContain(
        'Actualizamos tus hábitos deportivos.',
      );
      expect(testId('sport-habit-0')?.textContent).toContain('4 veces por semana');
      expect(testId('sport-habit-1')).toBeNull();
      expect(testId('sport-habits-goal')?.textContent?.trim()).toBe('Sin especificar');

      await click('Editar hábitos deportivos');
      await submitHabits();
      expect(gateway.saveSportHabits.calls.mostRecent().args[1]).toBe(2);
      expect(habitKeys()[1]).not.toBe(habitKeys()[0]);
    });

    it('CA4: informa que la respuesta corresponde a un envío anterior', async () => {
      await create(WITH_HABITS);
      gateway.saveSportHabits.and.resolveTo(saved(HABITS_V2, false, true));
      await click('Editar hábitos deportivos');
      await submitHabits();

      expect(testId('sport-habits-replayed')?.textContent).toContain('no se duplicó el registro');
    });

    it('CA2: entrega al formulario las reglas incumplidas y conserva el estado anterior', async () => {
      await create(WITH_HABITS);
      const violations = [{ field: 'sports[1].sport', issue: 'duplicate_value' }];
      gateway.saveSportHabits.and.resolveTo({ kind: 'invalid', violations });
      await click('Editar hábitos deportivos');
      await submitHabits();

      expect(habitsForm().serverErrors()).toEqual(violations);
      expect(testId('sport-habits-errors')?.textContent).toContain(
        'Este deporte ya está en otra fila.',
      );
      expect(testId('sport-habits-saved')).toBeNull();

      // Sin editar, volver a enviar es el mismo intento lógico.
      await submitHabits();
      expect(habitKeys()[1]).toBe(habitKeys()[0]);

      // Al cancelar se ve el estado anterior, sin cambios.
      await click('Cancelar');
      expect(testId('sport-habit-1')?.textContent).toContain('Natación');
    });

    it('CA4: un conflicto no sobrescribe, recarga y muestra los hábitos vigentes', async () => {
      await create(WITH_HABITS);
      gateway.saveSportHabits.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      gateway.loadProfile.and.resolveTo({ ...WITH_HABITS, sportHabits: HABITS_V2 });
      await click('Editar hábitos deportivos');
      await submitHabits();

      const conflict = testId('sport-habits-conflict')!;
      expect(conflict.getAttribute('role')).toBe('alert');
      expect(conflict.textContent).toContain('no se sobrescribieron');
      expect(document.activeElement).toBe(conflict);
      expect(testId('sport-habits-form')).toBeNull();
      expect(gateway.loadProfile).toHaveBeenCalledTimes(2);
      expect(testId('sport-habit-0')?.textContent).toContain('4 veces por semana');
      expect(testId('profile-projection-pending')).toBeNull();

      gateway.saveSportHabits.and.resolveTo(saved({ ...HABITS_V2, version: 3 }));
      await click('Editar hábitos deportivos');
      await submitHabits();
      expect(gateway.saveSportHabits.calls.mostRecent().args[1]).toBe(2);
      expect(habitKeys()[1]).not.toBe(habitKeys()[0]);
    });

    it('tras un conflicto sin proyección al día, no permite editar a ciegas y ofrece actualizar', async () => {
      await create(WITH_HABITS);
      gateway.saveSportHabits.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      await click('Editar hábitos deportivos');
      await submitHabits();
      await settleUntil(() => testId('profile-projection-pending') !== null);

      expect(testId('profile-projection-pending')).not.toBeNull();
      expect(button('Editar hábitos deportivos')?.disabled).toBeTrue();
      expect(button('Editar datos demográficos')?.disabled).toBeFalse();
    });

    it('tras un fallo recuperable, reintentar usa la misma clave; editar la renueva', async () => {
      await create(FULL);
      gateway.saveSportHabits.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
      await click('Registrar hábitos deportivos');
      await submitHabits();

      const error = testId('sport-habits-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('El servicio no está disponible');
      expect(error.textContent).toContain('no se duplicará el registro');
      expect(error.textContent).toContain(SIMULATED_PROFILE_CORRELATION_ID);
      expect(testId('sport-habits-form')).not.toBeNull();

      await submitHabits();
      expect(habitKeys()[1]).toBe(habitKeys()[0]);

      habitsForm().edited.emit();
      await submitHabits();
      expect(habitKeys()[2]).not.toBe(habitKeys()[1]);
    });

    it('CA5: un rechazo por permiso se informa sin datos', async () => {
      await create(FULL);
      gateway.saveSportHabits.and.resolveTo({
        kind: 'failed',
        error: { kind: 'forbidden', status: 403, code: 'permission_required', correlationId: null },
      });
      await click('Registrar hábitos deportivos');
      await submitHabits();

      expect(testId('sport-habits-error')?.textContent).toContain(
        'No tienes permiso para realizar esta acción.',
      );
      expect(testId('sport-habits-saved')).toBeNull();
    });

    it('no envía dos veces y avisa los reintentos automáticos', async () => {
      await create(FULL);
      let finish!: (outcome: SaveOutcome<SportHabits>) => void;
      gateway.saveSportHabits.and.callFake((_draft, _version, _key, onRetry) => {
        onRetry?.(1);
        return new Promise((resolve) => (finish = resolve));
      });
      await click('Registrar hábitos deportivos');
      habitsForm().submitted.emit(HABITS_DRAFT);
      habitsForm().submitted.emit(HABITS_DRAFT);
      await settle();

      expect(gateway.saveSportHabits).toHaveBeenCalledTimes(1);
      expect(button('Guardar hábitos deportivos')?.disabled).toBeTrue();
      expect(testId('sport-habits-retrying')?.textContent).toContain(
        'Reintentando guardar tus hábitos deportivos (1 de 3)',
      );
      finish(saved(HABITS_V1, true));
      await settle();
      expect(testId('sport-habits-retrying')).toBeNull();
      expect(testId('sport-habits-saved')).not.toBeNull();
    });

    it('no escribe los hábitos en consola ni en almacenamiento', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        spyOn(console, method),
      );
      const storage = spyOn(Storage.prototype, 'setItem');
      await create(FULL);
      gateway.saveSportHabits.and.resolveTo(saved(HABITS_V1, true));
      await click('Registrar hábitos deportivos');
      await submitHabits();

      expect(testId('sport-habits-saved')).not.toBeNull();
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(storage).not.toHaveBeenCalled();
    });

    it('no muestra planes, recomendaciones ni clasificaciones a partir de los hábitos', async () => {
      await create(WITH_HABITS);

      expect(testId('sport-habits-summary')?.textContent).not.toMatch(
        /recomenda|plan de|sugerencia|diagn[oó]stico/i,
      );
    });
  });

  describe('hábitos alimenticios (HU009)', () => {
    beforeEach(() => configure());

    function nutritionForm(): NutritionHabitsForm {
      return fixture.debugElement.query((el) => el.componentInstance instanceof NutritionHabitsForm)
        .componentInstance as NutritionHabitsForm;
    }

    async function submitNutrition(draft: NutritionHabitsDraft = NUTRITION_DRAFT): Promise<void> {
      nutritionForm().submitted.emit(draft);
      await settle();
    }

    function nutritionKeys(): string[] {
      return gateway.saveNutritionHabits.calls.allArgs().map(([, , key]) => key);
    }

    it('sin hábitos invita a registrarlos, sin error, y declara que no sustituyen una valoración', async () => {
      await create(WITH_HABITS);

      expect(testId('nutrition-habits-empty')?.textContent).toContain(
        'Aún no has registrado tus hábitos alimenticios.',
      );
      expect(button('Registrar hábitos alimenticios')).toBeDefined();
      expect(testId('profile-hu009')?.textContent).toContain('Son datos de salud');
      expect(testId('state-error')).toBeNull();
    });

    it('muestra la carga y el error del perfil también en la sección alimenticia', async () => {
      await create(Promise.reject(new HttpErrorResponse({ status: 503 })));

      expect(testId('profile-hu009')!.querySelector('[data-testid="state-error"]')).not.toBeNull();
      expect(testId('nutrition-habits-section')).toBeNull();
    });

    it('CA1: muestra los hábitos proyectados con sus catálogos, el consentimiento y el aviso', async () => {
      await create(WITH_NUTRITION);

      expect(testId('nutrition-habits-pattern')?.textContent?.trim()).toBe('Vegetariano');
      expect(
        [...testId('nutrition-habits-restrictions')!.querySelectorAll('li')].map((li) =>
          li.textContent?.trim(),
        ),
      ).toEqual(['Sin lactosa', 'Bajo en azúcar']);
      expect(
        [...testId('nutrition-habits-allergies')!.querySelectorAll('li')].map((li) =>
          li.textContent?.trim(),
        ),
      ).toEqual(['Maní', 'Mariscos']);
      expect(testId('nutrition-habits-meals')?.textContent?.trim()).toBe('4');
      expect(testId('nutrition-habits-hydration')?.textContent?.trim()).toBe('2,5 L por día');
      expect(testId('nutrition-habits-summary')?.textContent).toContain(
        `Versión ${SIMULATED_HEALTH_CONSENT_VERSION}`,
      );
      expect(testId('profile-hu009')?.textContent).toContain(
        'ni sustituye la valoración de un profesional de la salud',
      );
      expect(testId('nutrition-habits-summary')?.textContent).not.toMatch(
        /recomenda|plan de|diagn[oó]stico/i,
      );
      expect(button('Editar hábitos alimenticios')?.disabled).toBeFalse();
    });

    it('CA1: registra (201) con el consentimiento y sin versión esperada', async () => {
      await create(WITH_HABITS);
      gateway.saveNutritionHabits.and.resolveTo(saved(NUTRITION_V1, true));
      await click('Registrar hábitos alimenticios');

      expect(nutritionForm().consentVersion()).toBe(SIMULATED_HEALTH_CONSENT_VERSION);
      await submitNutrition();

      expect(gateway.saveNutritionHabits).toHaveBeenCalledOnceWith(
        NUTRITION_DRAFT,
        null,
        jasmine.stringMatching(/^[0-9a-f-]{36}$/),
        jasmine.any(Function),
      );
      const message = testId('nutrition-habits-saved')!;
      expect(message.getAttribute('role')).toBe('status');
      expect(message.textContent).toContain('Registramos tus hábitos alimenticios.');
      expect(document.activeElement).toBe(message);
      // La proyección aún no los tiene: se conserva la sección que confirmó el comando.
      expect(testId('nutrition-habits-pattern')?.textContent?.trim()).toBe('Vegetariano');
      expect(testId('nutrition-habits-form')).toBeNull();
      expect(gateway.saveSportHabits).not.toHaveBeenCalled();
    });

    it('CA1: reemplaza (200) con la versión mostrada; listas vacías e hidratación sin dato', async () => {
      await create(WITH_NUTRITION);
      gateway.saveNutritionHabits.and.resolveTo(saved(NUTRITION_V2));
      await click('Editar hábitos alimenticios');

      expect(nutritionForm().initial()).toEqual(NUTRITION_V1);
      await submitNutrition();

      expect(gateway.saveNutritionHabits.calls.mostRecent().args[1]).toBe(1);
      expect(testId('nutrition-habits-saved')?.textContent).toContain(
        'Actualizamos tus hábitos alimenticios.',
      );
      expect(testId('nutrition-habits-pattern')?.textContent?.trim()).toBe('Vegano');
      expect(testId('nutrition-habits-allergies')?.textContent?.trim()).toBe('Ninguna');
      expect(testId('nutrition-habits-hydration')?.textContent?.trim()).toBe('Sin especificar');

      await click('Editar hábitos alimenticios');
      await submitNutrition();
      expect(gateway.saveNutritionHabits.calls.mostRecent().args[1]).toBe(2);
      expect(nutritionKeys()[1]).not.toBe(nutritionKeys()[0]);
    });

    it('CA6: informa que la respuesta corresponde a un envío anterior', async () => {
      await create(WITH_NUTRITION);
      gateway.saveNutritionHabits.and.resolveTo(saved(NUTRITION_V2, false, true));
      await click('Editar hábitos alimenticios');
      await submitNutrition();

      expect(testId('nutrition-habits-replayed')?.textContent).toContain(
        'no se duplicó el registro',
      );
    });

    it('CA2: entrega al formulario las reglas por campo y conserva el estado anterior', async () => {
      await create(WITH_NUTRITION);
      const violations = [
        { field: 'allergies[1]', issue: 'duplicate_value' },
        { field: 'consent.version', issue: 'unsupported_consent_version' },
      ];
      gateway.saveNutritionHabits.and.resolveTo({ kind: 'invalid', violations });
      await click('Editar hábitos alimenticios');
      await submitNutrition();

      expect(nutritionForm().serverErrors()).toEqual(violations);
      const summary = testId('nutrition-habits-errors')!.textContent!;
      expect(summary).toContain('Alergias alimentarias: Hay valores repetidos.');
      expect(summary).toContain('La versión del consentimiento ya no está vigente.');
      expect(testId('nutrition-habits-saved')).toBeNull();

      await submitNutrition();
      expect(nutritionKeys()[1]).toBe(nutritionKeys()[0]);

      await click('Cancelar');
      expect(testId('nutrition-habits-pattern')?.textContent?.trim()).toBe('Vegetariano');
    });

    it('CA6: un conflicto de versión no sobrescribe, recarga y muestra los hábitos vigentes', async () => {
      await create(WITH_NUTRITION);
      gateway.saveNutritionHabits.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      gateway.loadProfile.and.resolveTo({ ...WITH_NUTRITION, nutritionHabits: NUTRITION_V2 });
      await click('Editar hábitos alimenticios');
      await submitNutrition();

      const conflict = testId('nutrition-habits-conflict')!;
      expect(conflict.getAttribute('role')).toBe('alert');
      expect(conflict.textContent).toContain('no se sobrescribieron');
      expect(document.activeElement).toBe(conflict);
      expect(gateway.loadProfile).toHaveBeenCalledTimes(2);
      expect(testId('nutrition-habits-pattern')?.textContent?.trim()).toBe('Vegano');

      gateway.saveNutritionHabits.and.resolveTo(saved({ ...NUTRITION_V2, version: 3 }));
      await click('Editar hábitos alimenticios');
      await submitNutrition();
      expect(gateway.saveNutritionHabits.calls.mostRecent().args[1]).toBe(2);
      expect(nutritionKeys()[1]).not.toBe(nutritionKeys()[0]);
    });

    it('tras un conflicto sin proyección al día, no permite editar a ciegas', async () => {
      await create(WITH_NUTRITION);
      gateway.saveNutritionHabits.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      await click('Editar hábitos alimenticios');
      await submitNutrition();
      await settleUntil(() => testId('profile-projection-pending') !== null);

      expect(button('Editar hábitos alimenticios')?.disabled).toBeTrue();
      expect(button('Editar hábitos deportivos')?.disabled).toBeFalse();
    });

    it('tras un fallo recuperable, reintentar usa la misma clave; editar la renueva', async () => {
      await create(WITH_HABITS);
      gateway.saveNutritionHabits.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
      await click('Registrar hábitos alimenticios');
      await submitNutrition();

      const error = testId('nutrition-habits-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('no se duplicará el registro');
      expect(error.textContent).toContain(SIMULATED_PROFILE_CORRELATION_ID);

      await submitNutrition();
      expect(nutritionKeys()[1]).toBe(nutritionKeys()[0]);
      nutritionForm().edited.emit();
      await submitNutrition();
      expect(nutritionKeys()[2]).not.toBe(nutritionKeys()[1]);
    });

    it('CA4: un rechazo por permiso se informa sin datos', async () => {
      await create(WITH_HABITS);
      gateway.saveNutritionHabits.and.resolveTo({
        kind: 'failed',
        error: { kind: 'forbidden', status: 403, code: 'permission_required', correlationId: null },
      });
      await click('Registrar hábitos alimenticios');
      await submitNutrition();

      expect(testId('nutrition-habits-error')?.textContent).toContain(
        'No tienes permiso para realizar esta acción.',
      );
    });

    it('no envía dos veces y avisa los reintentos automáticos', async () => {
      await create(WITH_HABITS);
      let finish!: (outcome: SaveOutcome<NutritionHabits>) => void;
      gateway.saveNutritionHabits.and.callFake((_draft, _version, _key, onRetry) => {
        onRetry?.(2);
        return new Promise((resolve) => (finish = resolve));
      });
      await click('Registrar hábitos alimenticios');
      nutritionForm().submitted.emit(NUTRITION_DRAFT);
      nutritionForm().submitted.emit(NUTRITION_DRAFT);
      await settle();

      expect(gateway.saveNutritionHabits).toHaveBeenCalledTimes(1);
      expect(testId('nutrition-habits-retrying')?.textContent).toContain(
        'Reintentando guardar tus hábitos alimenticios (2 de 3)',
      );
      finish(saved(NUTRITION_V1, true));
      await settle();
      expect(testId('nutrition-habits-saved')).not.toBeNull();
    });

    it('no escribe los hábitos alimenticios en consola ni en almacenamiento', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        spyOn(console, method),
      );
      const storage = spyOn(Storage.prototype, 'setItem');
      await create(WITH_HABITS);
      gateway.saveNutritionHabits.and.resolveTo(saved(NUTRITION_V1, true));
      await click('Registrar hábitos alimenticios');
      await submitNutrition();

      expect(testId('nutrition-habits-saved')).not.toBeNull();
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(storage).not.toHaveBeenCalled();
    });
  });

  describe('hábitos alimenticios sin versión de consentimiento configurada', () => {
    beforeEach(() => configure(null));

    it('no permite registrarlos ni editarlos, pero muestra los existentes', async () => {
      await create(WITH_NUTRITION);

      expect(testId('nutrition-habits-unavailable')).not.toBeNull();
      expect(testId('nutrition-habits-pattern')?.textContent?.trim()).toBe('Vegetariano');
      expect(button('Editar hábitos alimenticios')).toBeUndefined();
    });

    it('sin hábitos no ofrece registrarlos', async () => {
      await create(WITH_HABITS);

      expect(testId('nutrition-habits-unavailable')).not.toBeNull();
      expect(button('Registrar hábitos alimenticios')).toBeUndefined();
    });
  });

  function configureDelays(delays: readonly number[]): void {
    TestBed.overrideProvider(PROFILE_PROJECTION_RETRY_DELAYS_MS, { useValue: delays });
  }
});
