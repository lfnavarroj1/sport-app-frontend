import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FoodCatalog } from '../../../nutrition-plan.model';
import { NutritionGateway } from '../../../nutrition.gateway';
import { FoodIntakeHistory } from '../../food-intake-history/food-intake-history';
import { IntakeScope } from '../../food-intakes.model';

/**
 * Historial de alimentación de un deportista que autorizó al profesional (HU013),
 * en `/profesional/historial/alimentacion/:athleteId`. Solo consumos: nunca
 * hábitos ni perfil del deportista. Si la autorización no está vigente, el
 * backend responde `403` y la sección lo explica sin datos (CA3).
 */
@Component({
  selector: 'app-athlete-food-intakes-page',
  imports: [FoodIntakeHistory, MatCardModule, RouterLink, TranslatePipe],
  templateUrl: './athlete-food-intakes-page.html',
  styleUrls: ['../../../../training-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AthleteFoodIntakesPage {
  private readonly gateway = inject(NutritionGateway);

  protected readonly scope: IntakeScope = {
    kind: 'athlete',
    athleteId: inject(ActivatedRoute).snapshot.paramMap.get('athleteId') ?? '',
  };
  /** Nombres de los alimentos; si el catálogo falla se muestran los códigos. */
  protected readonly catalog = signal<FoodCatalog | null>(null);

  constructor() {
    void this.gateway.loadCatalog().then(
      (catalog) => this.catalog.set(catalog),
      () => this.catalog.set(null),
    );
  }
}
