import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError } from '../../../../core/api/api-error';
import {
  COMPARE_PLANS_ROUTE,
  failureMessageKey,
  isCapabilityRequired,
} from '../association-format';
import { ServiceAssociationsStore, retryable } from '../service-associations.store';

type Step = 'idle' | 'confirmAssociate' | 'confirmDissociate';

/**
 * Acciones de HU017 sobre un servicio del catálogo médico de HU020: «Asociar» o,
 * si ya está asociado, «Quitar», siempre tras una confirmación que recuerda que
 * asociar no comparte datos de salud, no contrata, no reserva ni paga (CA4).
 *
 * Que el botón aparezca no autoriza nada: el BFF y el servicio verifican la
 * capacidad y la elegibilidad del servicio.
 */
@Component({
  selector: 'app-association-action',
  imports: [MatButtonModule, RouterLink, TranslatePipe],
  templateUrl: './association-action.html',
  styleUrl: './association-action.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssociationAction {
  protected readonly store = inject(ServiceAssociationsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly serviceId = input.required<string>();
  readonly name = input.required<string>();

  protected readonly comparePlansRoute = COMPARE_PLANS_ROUTE;
  protected readonly step = signal<Step>('idle');
  protected readonly active = computed(
    () => this.store.activeByService().get(this.serviceId()) ?? null,
  );
  protected readonly message = computed(() => this.store.message(this.serviceId(), 'catalog'));
  /** Mientras se consulta la lista no se sabe si el servicio ya está asociado. */
  protected readonly checking = computed(() => this.store.state().status === 'loading');
  protected readonly busy = computed(
    () => this.store.associating() !== null || this.store.dissociating() !== null,
  );
  protected readonly associatingThis = computed(
    () => this.store.associating() === this.serviceId(),
  );
  protected readonly dissociatingThis = computed(() => {
    const active = this.active();
    return active !== null && this.store.dissociating() === active.id;
  });

  constructor() {
    this.store.ensureLoaded();
  }

  protected ask(step: Exclude<Step, 'idle'>): void {
    this.step.set(step);
    this.focus('association-confirm');
  }

  protected cancel(): void {
    this.step.set('idle');
    this.focus(this.active() ? 'association-dissociate' : 'association-associate');
  }

  protected async associate(): Promise<void> {
    await this.store.associate(this.serviceId(), this.name(), 'catalog');
    this.step.set('idle');
    this.focus('association-message');
  }

  protected async dissociate(): Promise<void> {
    const active = this.active();
    if (active === null) {
      return;
    }
    await this.store.dissociate(active, 'catalog');
    this.step.set('idle');
    this.focus('association-message');
  }

  protected failureKey(error: ApiError): string {
    return failureMessageKey(error);
  }

  protected capabilityRequired(error: ApiError): boolean {
    return isCapabilityRequired(error);
  }

  protected retryable(error: ApiError): boolean {
    return retryable(error);
  }

  private focus(testId: string): void {
    afterNextRender(
      () =>
        this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}
