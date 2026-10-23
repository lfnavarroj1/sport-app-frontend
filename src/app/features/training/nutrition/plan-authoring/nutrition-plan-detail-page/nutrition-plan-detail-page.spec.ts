import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../../testing/translate-testing';
import { NutritionGateway } from '../../nutrition.gateway';
import { FakeNutritionGateway, TEST_PLAN } from '../../../../../../testing/fake-nutrition.gateway';
import { NutritionPlanDetailPage } from './nutrition-plan-detail-page';

describe('NutritionPlanDetailPage (HU014)', () => {
  let fixture: ComponentFixture<NutritionPlanDetailPage>;
  let gateway: FakeNutritionGateway;
  let element: HTMLElement;

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [NutritionPlanDetailPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: NutritionGateway, useValue: gateway },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ planId: TEST_PLAN.id }) } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NutritionPlanDetailPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  beforeEach(() => {
    gateway = new FakeNutritionGateway();
  });

  it('consulta el plan confirmado con su estado y versión 1 (CA4)', async () => {
    await create();

    expect(gateway.getPlan).toHaveBeenCalledWith(TEST_PLAN.id);
    expect(testId('nutrition-summary-title')?.textContent).toBe(TEST_PLAN.title);
    expect(testId('nutrition-detail-status')?.textContent?.trim()).toBe('Asignado');
    expect(element.textContent).toContain('Mantequilla de maní');
  });

  it('un 404 explica que puede estar proyectándose y permite reintentar (CA5)', async () => {
    gateway.getPlan.and.rejectWith(new HttpErrorResponse({ status: 404 }));
    await create();

    expect(testId('nutrition-not-found')?.textContent).toContain('aún no está disponible');

    gateway.getPlan.and.resolveTo(TEST_PLAN);
    testId('nutrition-not-found')!.querySelector('button')!.click();
    await fixture.whenStable();

    expect(testId('nutrition-detail-status')).not.toBeNull();
  });

  it('con la autorización revocada no muestra datos del plan (CA3)', async () => {
    gateway.getPlan.and.rejectWith(
      new HttpErrorResponse({
        status: 403,
        error: { code: 'athlete_authorization_required', message: 'x', correlation_id: null },
      }),
    );
    await create();

    expect(testId('nutrition-authorization-revoked')?.textContent).toContain(
      'Ya no tienes una autorización vigente',
    );
    expect(testId('nutrition-summary')).toBeNull();
  });

  it('si el catálogo falla muestra el plan con los códigos de los alimentos', async () => {
    gateway.loadCatalog.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await create();

    expect(element.textContent).toContain('PEANUT_BUTTER');
  });

  it('un error del servicio se muestra con su referencia y reintento', async () => {
    gateway.getPlan.and.rejectWith(
      new HttpErrorResponse({
        status: 503,
        error: { code: 'upstream_unavailable', message: 'x', correlation_id: 'ref-sintetica-2' },
      }),
    );
    await create();

    expect(testId('state-error')?.textContent).toContain('ref-sintetica-2');
  });
});
