import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { SIMULATED_INTAKES_ATHLETE_ID } from '../../../../../../../testing/bff-web/food-intakes.fixtures';
import { FakeFoodIntakesGateway } from '../../../../../../../testing/fake-food-intakes.gateway';
import { FakeNutritionGateway } from '../../../../../../../testing/fake-nutrition.gateway';
import { provideTranslateTesting } from '../../../../../../../testing/translate-testing';
import { NutritionGateway } from '../../../nutrition.gateway';
import { FoodIntakesGateway } from '../../food-intakes.gateway';
import { AthleteFoodIntakesPage } from './athlete-food-intakes-page';

describe('AthleteFoodIntakesPage (HU013)', () => {
  let fixture: ComponentFixture<AthleteFoodIntakesPage>;
  let element: HTMLElement;
  let nutrition: FakeNutritionGateway;
  let intakes: FakeFoodIntakesGateway;

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AthleteFoodIntakesPage],
      providers: [
        provideTranslateTesting(),
        provideRouter([]),
        { provide: NutritionGateway, useValue: nutrition },
        { provide: FoodIntakesGateway, useValue: intakes },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ athleteId: SIMULATED_INTAKES_ATHLETE_ID }) },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AthleteFoodIntakesPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    nutrition = new FakeNutritionGateway();
    intakes = new FakeFoodIntakesGateway();
  });

  it('consulta los consumos del deportista de la ruta con los nombres del catálogo', async () => {
    await create();

    expect(element.querySelector('h1')?.textContent).toContain(
      'Historial de alimentación del deportista',
    );
    expect(intakes.loadPage).toHaveBeenCalledOnceWith(
      { kind: 'athlete', athleteId: SIMULATED_INTAKES_ATHLETE_ID },
      { from: null, to: null, mealType: null },
      null,
    );
    expect(nutrition.loadCatalog).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain('Huevo');
    expect(element.querySelector('a')?.getAttribute('href')).toBe(
      '/profesional/historial/alimentacion',
    );
  });

  it('si el catálogo falla muestra los códigos de los alimentos', async () => {
    nutrition.loadCatalog.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await create();

    expect(element.textContent).toContain('EGG');
    expect(element.textContent).not.toContain('Huevo');
  });
});
