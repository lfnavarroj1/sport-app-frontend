import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { TrainingPlan } from '../../training-plan.model';
import { PlanAuthoringGateway } from '../plan-authoring.gateway';
import { PlanDetailPage } from './plan-detail-page';

// Datos sintéticos de prueba.
const PLAN_ID = '3c5e7a9b-1d2f-4a6c-8e0b-2d4f6a8c0e1b';
const PLAN: TrainingPlan = {
  id: PLAN_ID,
  athleteId: '5d1e7a3c-2b4f-4c6d-8e9f-0a1b2c3d4e5f',
  professionalId: '7f2e4d6c-8b0a-4e1c-9d3f-5a7b9c1d3e5f',
  title: 'Base aeróbica',
  objectives: ['Mejorar la resistencia'],
  startDate: '2026-11-02',
  endDate: '2026-12-27',
  status: 'ASSIGNED',
  version: 1,
  sessions: [
    { scheduledDate: '2026-11-03', sport: 'swimming', durationMinutes: 30, intensityRpe: 3 },
  ],
  createdAt: '2026-10-12T16:00:00Z',
};

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-2', details: [] },
  });
}

describe('PlanDetailPage (HU010 CA4)', () => {
  let fixture: ComponentFixture<PlanDetailPage>;
  let getPlan: jasmine.Spy;

  async function create(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(PlanDetailPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    getPlan = jasmine.createSpy('getPlan').and.resolveTo(PLAN);
    await TestBed.configureTestingModule({
      imports: [PlanDetailPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: PlanAuthoringGateway, useValue: { getPlan, createPlan: jasmine.createSpy() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ planId: PLAN_ID }) } },
        },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta', async () => {
    getPlan.and.returnValue(new Promise(() => undefined));

    const element = await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
  });

  it('consulta el plan de la ruta y presenta su contenido, estado y versión', async () => {
    const element = await create();

    expect(getPlan).toHaveBeenCalledOnceWith(PLAN_ID);
    expect(element.querySelector('[data-testid="plan-summary-title"]')?.textContent).toContain(
      'Base aeróbica',
    );
    expect(element.querySelector('[data-testid="plan-detail-status"]')?.textContent).toContain(
      'Asignado',
    );
    expect(element.querySelector('[data-testid="plan-summary-sessions"]')?.textContent).toContain(
      'Natación',
    );
  });

  it('un 404 se explica como plan aún no disponible o sin acceso, con reintento', async () => {
    getPlan.and.rejectWith(httpError(404, 'training_plan_not_found'));
    const element = await create();

    const notFound = element.querySelector('[data-testid="plan-not-found"]')!;
    expect(notFound.getAttribute('role')).toBe('alert');
    expect(notFound.textContent).toContain('aún no está disponible');
    expect(element.querySelector('[data-testid="plan-summary"]')).toBeNull();

    getPlan.and.resolveTo(PLAN);
    notFound.querySelector('button')!.click();
    await fixture.whenStable();

    expect(getPlan).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[data-testid="plan-summary"]')).not.toBeNull();
  });

  it('un rechazo por permiso o capacidad se muestra sin reintento', async () => {
    getPlan.and.rejectWith(httpError(403, 'capability_required'));
    const element = await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('No tienes permiso');
    expect(error.textContent).toContain('ref-sintetica-2');
    expect(error.querySelector('button')).toBeNull();
  });

  it('un fallo del servicio es recuperable', async () => {
    getPlan.and.rejectWith(httpError(503, 'upstream_unavailable'));
    const element = await create();

    getPlan.and.resolveTo(PLAN);
    element.querySelector<HTMLButtonElement>('[data-testid="state-error"] button')!.click();
    await fixture.whenStable();

    expect(element.querySelector('[data-testid="plan-summary"]')).not.toBeNull();
  });
});
