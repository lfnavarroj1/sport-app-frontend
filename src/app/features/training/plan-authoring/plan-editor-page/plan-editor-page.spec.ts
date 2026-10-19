import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  FakeSessionAccess,
  accessReady,
  provideFakeSessionAccess,
} from '../../../../../testing/session-access-testing';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ApiError } from '../../../../core/api/api-error';
import { TrainingPlan } from '../../training-plan.model';
import { PlanAuthoringGateway } from '../plan-authoring.gateway';
import { CreatePlanOutcome, PlanDraft } from '../plan-authoring.model';
import { PlanForm } from '../plan-form/plan-form';
import { PlanEditorPage } from './plan-editor-page';

// Datos sintéticos de prueba.
const DRAFT: PlanDraft = {
  athleteEmail: 'deportista@example.com',
  title: 'Base aeróbica',
  objectives: ['Mejorar la resistencia'],
  startDate: '2026-11-02',
  endDate: '2026-12-27',
  sessions: [
    { scheduledDate: '2026-11-03', sport: 'running', durationMinutes: 45, intensityRpe: 4 },
  ],
};

const PLAN: TrainingPlan = {
  id: '3c5e7a9b-1d2f-4a6c-8e0b-2d4f6a8c0e1b',
  athleteId: '5d1e7a3c-2b4f-4c6d-8e9f-0a1b2c3d4e5f',
  professionalId: '7f2e4d6c-8b0a-4e1c-9d3f-5a7b9c1d3e5f',
  title: 'Base aeróbica',
  objectives: ['Mejorar la resistencia'],
  startDate: '2026-11-02',
  endDate: '2026-12-27',
  status: 'ASSIGNED',
  version: 1,
  sessions: DRAFT.sessions,
  createdAt: '2026-10-12T16:00:00Z',
};

const UNAVAILABLE: ApiError = {
  kind: 'server',
  status: 503,
  code: 'upstream_unavailable',
  correlationId: 'ref-sintetica-1',
};

class FakePlanAuthoringGateway extends PlanAuthoringGateway {
  createPlan = jasmine
    .createSpy('createPlan')
    .and.resolveTo({ kind: 'created', plan: PLAN, replayed: false } satisfies CreatePlanOutcome);
  getPlan = jasmine.createSpy('getPlan').and.resolveTo(PLAN);
}

describe('PlanEditorPage (HU010)', () => {
  let fixture: ComponentFixture<PlanEditorPage>;
  let gateway: FakePlanAuthoringGateway;
  let element: HTMLElement;
  let access: FakeSessionAccess;

  function form(): PlanForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof PlanForm)
      .componentInstance as PlanForm;
  }

  async function review(draft: PlanDraft = DRAFT): Promise<void> {
    form().reviewed.emit(draft);
    await fixture.whenStable();
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button, a')].find((b) =>
      b.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;
  }

  async function confirm(): Promise<void> {
    button('Confirmar y asignar')!.click();
    await fixture.whenStable();
  }

  function keysUsed(): string[] {
    return gateway.createPlan.calls.allArgs().map(([, key]) => key as string);
  }

  function editFormIsVisible(): boolean {
    return !(element.querySelector('app-plan-form')!.parentElement as HTMLElement).hidden;
  }

  beforeEach(async () => {
    gateway = new FakePlanAuthoringGateway();
    const fakeAccess = provideFakeSessionAccess(
      accessReady('service_provider', 'NOT_APPLICABLE', ['training.history.view_assigned']),
    );
    access = fakeAccess.fake;
    await TestBed.configureTestingModule({
      imports: [PlanEditorPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: PlanAuthoringGateway, useValue: gateway },
        fakeAccess.provider,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PlanEditorPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  it('muestra el editor del plan', () => {
    expect(element.querySelector('h1')?.textContent).toContain('Crear plan de entrenamiento');
    expect(editFormIsVisible()).toBeTrue();
    expect(element.querySelector('[data-testid="plan-review"]')).toBeNull();
  });

  it('pide confirmar la asignación antes de enviar nada al BFF', async () => {
    await review();

    expect(editFormIsVisible()).toBeFalse();
    const reviewSection = element.querySelector('[data-testid="plan-review"]')!;
    expect(reviewSection.querySelector('h2')?.textContent).toContain('Confirma la asignación');
    expect(
      reviewSection.querySelector('[data-testid="plan-review-athlete"]')?.textContent,
    ).toContain(DRAFT.athleteEmail);
    expect(document.activeElement).toBe(reviewSection.querySelector('h2'));
    expect(gateway.createPlan).not.toHaveBeenCalled();
  });

  it('volver a editar conserva el formulario sin enviar', async () => {
    await review();
    button('Volver a editar')!.click();
    await fixture.whenStable();

    expect(editFormIsVisible()).toBeTrue();
    expect(gateway.createPlan).not.toHaveBeenCalled();
  });

  it('CA1: muestra el plan asignado solo con la respuesta del backend', async () => {
    await review();
    await confirm();

    expect(gateway.createPlan).toHaveBeenCalledOnceWith(DRAFT, jasmine.any(String));
    expect(keysUsed()[0]).toMatch(/^[0-9a-f-]{36}$/);
    const created = element.querySelector('[data-testid="plan-created"]')!;
    expect(created.getAttribute('role')).toBe('status');
    expect(created.textContent).toContain('Plan asignado');
    expect(created.textContent).toContain('quedó asignado a deportista@example.com');
    expect(created.textContent).toContain('Asignado');
    expect(created.querySelector('[data-testid="plan-replayed"]')).toBeNull();
    expect(created.querySelector('a')?.getAttribute('href')).toBe(`/${PLAN.id}`);
  });

  it('CA5: informa que un reintento devolvió el plan ya creado, sin duplicarlo', async () => {
    gateway.createPlan.and.resolveTo({ kind: 'created', plan: PLAN, replayed: true });
    await review();
    await confirm();

    expect(element.querySelector('[data-testid="plan-replayed"]')?.textContent).toContain(
      'no se creó otro',
    );
  });

  it('evita el doble envío mientras confirma', async () => {
    let resolve!: (outcome: CreatePlanOutcome) => void;
    gateway.createPlan.and.returnValue(new Promise((r) => (resolve = r)));
    await review();

    button('Confirmar y asignar')!.click();
    fixture.detectChanges();
    const assigning = button('Asignando…')!;
    expect(assigning.disabled).toBeTrue();
    assigning.click();

    resolve({ kind: 'created', plan: PLAN, replayed: false });
    await fixture.whenStable();
    expect(gateway.createPlan).toHaveBeenCalledTimes(1);
  });

  it('CA5: ante un fallo recuperable conserva la clave para el reintento', async () => {
    gateway.createPlan.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
    await review();
    await confirm();

    const error = element.querySelector('[data-testid="plan-error"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('El servicio no está disponible');
    expect(error.textContent).toContain('ref-sintetica-1');
    expect(element.querySelector('[data-testid="plan-created"]')).toBeNull();

    gateway.createPlan.and.resolveTo({ kind: 'created', plan: PLAN, replayed: true });
    await confirm();

    expect(keysUsed()[1]).toBe(keysUsed()[0]);
    expect(element.querySelector('[data-testid="plan-created"]')).not.toBeNull();
  });

  it('CA5: si el profesional cambia los datos, el siguiente envío es un intento nuevo', async () => {
    gateway.createPlan.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
    await review();
    await confirm();
    button('Volver a editar')!.click();
    form().edited.emit();
    await review();
    await confirm();

    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('si el BFF rechaza la clave por reutilizada, lo explica y usa una nueva', async () => {
    gateway.createPlan.and.resolveTo({
      kind: 'failed',
      error: { kind: 'conflict', status: 409, code: 'idempotency_key_reused', correlationId: null },
    });
    await review();
    await confirm();

    expect(element.querySelector('[data-testid="plan-error"]')?.textContent).toContain(
      'Revisa el plan y vuelve a confirmarlo',
    );
    await confirm();
    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('CA2: un rol sin permiso recibe el rechazo, no un plan', async () => {
    gateway.createPlan.and.resolveTo({
      kind: 'failed',
      error: { kind: 'forbidden', status: 403, code: 'permission_required', correlationId: null },
    });
    await review();
    await confirm();

    expect(element.querySelector('[data-testid="plan-error"]')?.textContent).toContain(
      'No tienes permiso para realizar esta acción.',
    );
    expect(element.querySelector('[data-testid="plan-created"]')).toBeNull();
  });

  it('CA2: sin autorización del deportista vuelve al editor y lo indica en el correo', async () => {
    gateway.createPlan.and.resolveTo({ kind: 'athlete_not_authorized' });
    await review();
    await confirm();

    expect(editFormIsVisible()).toBeTrue();
    expect(form().serverErrors()).toEqual({ violations: [], athleteNotAuthorized: true });
  });

  it('CA3: vuelve al editor con las reglas incumplidas, sin plan guardado', async () => {
    const violations = [{ path: 'end_date', issue: 'end_date_before_start_date' }];
    gateway.createPlan.and.resolveTo({ kind: 'invalid', violations });
    await review();
    await confirm();

    expect(editFormIsVisible()).toBeTrue();
    expect(form().serverErrors()).toEqual({ violations, athleteNotAuthorized: false });
    expect(element.querySelector('[data-testid="plan-errors"]')?.textContent).toContain(
      'la fecha de fin es anterior a la de inicio.',
    );
    expect(element.querySelector('[data-testid="plan-created"]')).toBeNull();
  });

  it('«Crear otro plan» reinicia el editor y la clave', async () => {
    await review();
    await confirm();
    const reset = spyOn(form(), 'reset').and.callThrough();

    button('Crear otro plan')!.click();
    await fixture.whenStable();

    expect(reset).toHaveBeenCalled();
    expect(editFormIsVisible()).toBeTrue();
    await review();
    await confirm();
    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('HU011: ofrece el historial del deportista asignado si el BFF confirma el permiso', async () => {
    await review();
    await confirm();

    const link = [...element.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Ver historial de entrenamiento'),
    );
    expect(link?.getAttribute('href')).toBe(
      `/profesional/historial/entrenamientos/${PLAN.athleteId}`,
    );
  });

  it('HU011: sin el permiso confirmado no ofrece el historial', async () => {
    access.view.set(accessReady('service_provider', 'NOT_APPLICABLE', []));
    await review();
    await confirm();

    expect(element.textContent).not.toContain('Ver historial de entrenamiento');
  });
});
