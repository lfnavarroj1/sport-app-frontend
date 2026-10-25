import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { toApiError } from '../../../../core/api/api-error';
import {
  DELETE_EVENT_FEE_RESPONSES,
  DRAFT_WITHOUT_FEE,
  PUBLISHED_WITH_REGISTRATIONS,
  PUT_EVENT_FEE_RESPONSES,
  feeChanged,
} from '../../../../../testing/bff-web/event-pricing.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { EventPricingGateway } from '../event-pricing.gateway';
import { FeeOutcome, PricedEvent, toPricedEvent } from '../event-pricing.model';
import { EventPricingStore } from '../event-pricing.store';
import { EventFeeEditor } from './event-fee-editor';

// Datos sintéticos derivados de los fixtures del contrato bff-web 0.26.0.
const DRAFT = toPricedEvent(DRAFT_WITHOUT_FEE);
const PUBLISHED = toPricedEvent(PUBLISHED_WITH_REGISTRATIONS);
const ASSIGNED = toPricedEvent(PUT_EVENT_FEE_RESPONSES.assigned.body);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function failed(status: number, code: string): FeeOutcome {
  return {
    kind: 'failed',
    error: toApiError(
      new HttpErrorResponse({
        status,
        error: { code, message: 'simulado', correlation_id: 'ref-sintetica-25w', details: [] },
      }),
    ),
  };
}

describe('EventFeeEditor (HU025)', () => {
  let fixture: ComponentFixture<EventFeeEditor>;
  let element: HTMLElement;
  let loadOwnEvents: jasmine.Spy;
  let setFee: jasmine.Spy;
  let removeFee: jasmine.Spy;
  let params: BehaviorSubject<ParamMap>;
  let store: EventPricingStore;

  async function create(eventId: string, events: readonly PricedEvent[] = [DRAFT, PUBLISHED]) {
    loadOwnEvents.and.resolveTo(events);
    params.next(convertToParamMap({ eventId }));
    await store.load();
    fixture = TestBed.createComponent(EventFeeEditor);
    await settle();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function byTestId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function input(): HTMLInputElement {
    return byTestId('fee-amount') as HTMLInputElement;
  }

  async function type(value: string): Promise<void> {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await settle();
  }

  async function click(testId: string): Promise<void> {
    byTestId(testId)!.click();
    await settle();
  }

  async function assign(value: string): Promise<void> {
    await type(value);
    await click('fee-save');
    await click('fee-confirm-button');
  }

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({}));
    loadOwnEvents = jasmine.createSpy('loadOwnEvents');
    setFee = jasmine
      .createSpy('setFee')
      .and.resolveTo({ kind: 'updated', event: ASSIGNED, replayed: false });
    removeFee = jasmine.createSpy('removeFee').and.resolveTo({
      kind: 'updated',
      event: toPricedEvent(DELETE_EVENT_FEE_RESPONSES.removed.body),
      replayed: false,
    });
    await TestBed.configureTestingModule({
      imports: [EventFeeEditor],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        EventPricingStore,
        { provide: EventPricingGateway, useValue: { loadOwnEvents, setFee, removeFee } },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      ],
    }).compileComponents();
    store = TestBed.inject(EventPricingStore);
  });

  it('muestra el evento con su tarifa vigente, inscritos y versión, y precarga el valor', async () => {
    await create(PUBLISHED.id);

    expect(byTestId('fee-event-name')?.textContent).toContain(PUBLISHED.name);
    expect(byTestId('fee-current')?.textContent).toContain('85.000');
    expect(byTestId('fee-registrations')?.textContent).toContain('3');
    expect(byTestId('fee-version')?.textContent).toContain('2');
    expect(input().value).toBe('85000');
    expect(byTestId('fee-remove')).not.toBeNull();
    expect(element.textContent).toContain('(America/Bogota)');
  });

  it('el campo tiene etiqueta, ayuda que explica el 0 como gratuito y teclado decimal', async () => {
    await create(DRAFT.id);

    const field = input();
    expect(field.getAttribute('inputmode')).toBe('decimal');
    expect(field.labels?.[0]?.textContent ?? '').toContain('Valor de la tarifa');
    const describedBy = field.getAttribute('aria-describedby') ?? '';
    const hint = describedBy
      .split(' ')
      .map((id) => element.querySelector(`#${id}`)?.textContent ?? '')
      .join(' ');
    expect(hint).toContain('Escribe 0 si el evento es gratuito');
    expect(byTestId('fee-remove')).toBeNull();
    expect(byTestId('fee-current')?.textContent).toContain('Sin tarifa');
  });

  it('CA4: advierte que las inscripciones existentes conservan su tarifa cuando hay inscritos', async () => {
    await create(PUBLISHED.id);
    expect(byTestId('fee-registrations-warning')?.textContent).toContain(
      'Las inscripciones existentes conservan su tarifa',
    );
    expect(byTestId('fee-registrations-warning')?.getAttribute('role')).toBe('note');

    params.next(convertToParamMap({ eventId: DRAFT.id }));
    await settle();
    expect(byTestId('fee-registrations-warning')).toBeNull();
  });

  it('muestra la vista previa en es-CO y explica el gratuito', async () => {
    await create(DRAFT.id);

    await type('85.000,5');
    expect(byTestId('fee-preview')?.textContent).toContain('85.000,5');
    await type('0');
    expect(byTestId('fee-preview')?.textContent).toContain('gratuito');
  });

  it('valida el formato antes de confirmar y no envía nada', async () => {
    await create(DRAFT.id);

    await type('85000,505');
    await click('fee-save');
    expect(byTestId('fee-confirm')).toBeNull();
    expect(byTestId('fee-amount-error')?.textContent).toContain('dos decimales');

    await type('');
    await click('fee-save');
    expect(byTestId('fee-amount-error')?.textContent).toContain('Usa 0 si el evento es gratuito');
    expect(setFee).not.toHaveBeenCalled();
  });

  it('CA1: confirma y presenta el resultado del comando con la versión nueva, sin esperar la proyección', async () => {
    await create(PUBLISHED.id);

    await type('90.000,50');
    await click('fee-save');
    expect(byTestId('fee-confirm')?.textContent).toContain('90.000,5');
    expect(byTestId('fee-confirm')?.textContent).toContain('conservan su tarifa');
    await click('fee-confirm-button');

    expect(setFee).toHaveBeenCalledOnceWith(
      PUBLISHED.id,
      '90000.50',
      2,
      jasmine.stringMatching(UUID),
      jasmine.any(Function),
    );
    expect(byTestId('fee-result')?.textContent).toContain('Tarifa asignada');
    expect(byTestId('fee-result-version')?.textContent).toContain('3');
    expect(byTestId('fee-result-fee')?.textContent).toContain('90.000,5');
    expect(byTestId('fee-result')?.textContent).toContain('no genera cobros');
    expect(byTestId('fee-result')?.getAttribute('role')).toBe('status');
    expect(store.find(PUBLISHED.id)).toEqual(ASSIGNED);
    expect(byTestId('fee-version')?.textContent).toContain('3');
    expect(document.activeElement?.textContent).toContain('Tarifa asignada');
  });

  it('asigna 0 como evento gratuito', async () => {
    setFee.and.resolveTo({
      kind: 'updated',
      event: toPricedEvent(PUT_EVENT_FEE_RESPONSES.free.body),
      replayed: false,
    });
    await create(DRAFT.id);

    await type('0');
    await click('fee-save');
    expect(byTestId('fee-confirm')?.textContent).toContain('gratuito');
    await click('fee-confirm-button');

    expect(setFee.calls.mostRecent().args[1]).toBe('0.00');
    expect(byTestId('fee-result-fee')?.textContent).toContain('Gratuito');
  });

  it('retira la tarifa tras confirmar, con la versión vista', async () => {
    await create(PUBLISHED.id);

    await click('fee-remove');
    expect(byTestId('fee-confirm')?.textContent).toContain('¿Retirar la tarifa');
    await click('fee-confirm-button');

    expect(removeFee).toHaveBeenCalledOnceWith(
      PUBLISHED.id,
      2,
      jasmine.stringMatching(UUID),
      jasmine.any(Function),
    );
    expect(byTestId('fee-result')?.textContent).toContain('Tarifa retirada');
    expect(byTestId('fee-result-fee')?.textContent).toContain('Sin tarifa');
    expect(input().value).toBe('');
  });

  it('CA2: un 422 del importe se marca junto al campo y la tarifa no cambia', async () => {
    setFee.and.resolveTo({
      kind: 'invalid',
      violations: [{ field: 'amount', issue: 'out_of_range' }],
    });
    await create(PUBLISHED.id);

    await assign('90000');

    expect(byTestId('fee-amount-error')?.textContent).toContain('fuera del rango');
    expect(byTestId('fee-result')).toBeNull();
    expect(store.find(PUBLISHED.id)).toEqual(PUBLISHED);
  });

  it('CA2: un 422 de otro campo (evento iniciado o moneda) se lista en el resumen', async () => {
    setFee.and.resolveTo({
      kind: 'invalid',
      violations: [
        { field: 'starts_at', issue: 'event_already_started' },
        { field: 'currency', issue: 'unsupported_currency' },
      ],
    });
    await create(PUBLISHED.id);

    await assign('90000');

    const summary = byTestId('fee-violations');
    expect(summary?.getAttribute('role')).toBe('alert');
    expect(summary?.textContent).toContain('ya comenzó');
    expect(summary?.textContent).toContain('pesos colombianos');
    expect(summary?.textContent).toContain('no cambió');
  });

  it('CA3: un 409 version_conflict ofrece actualizar el evento y toma la versión vigente', async () => {
    setFee.and.resolveTo({ kind: 'conflict', currentVersion: 3 });
    await create(PUBLISHED.id);

    await assign('90000');
    expect(byTestId('fee-conflict')?.textContent).toContain('versión vigente: 3');

    const refreshed = toPricedEvent(feeChanged(PUBLISHED_WITH_REGISTRATIONS, '87000.00'));
    loadOwnEvents.and.resolveTo([DRAFT, refreshed]);
    const refresh = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Actualizar evento'),
    )!;
    refresh.click();
    await settle();

    expect(byTestId('fee-conflict')).toBeNull();
    expect(byTestId('fee-version')?.textContent).toContain('3');
    expect(input().value).toBe('87000');
  });

  it('CA3: un evento ausente de la lista propia se informa sin datos', async () => {
    await create('ajeno-0000');

    expect(byTestId('fee-event-not-found')?.textContent).toContain('no te pertenece');
    expect(byTestId('fee-amount')).toBeNull();
  });

  it('CA5: reintenta a mano con la misma clave tras un fallo transitorio y renueva la clave tras el éxito', async () => {
    setFee.and.resolveTo(failed(503, 'upstream_unavailable'));
    await create(PUBLISHED.id);

    await assign('90000');
    expect(byTestId('fee-error')?.textContent).toContain('no se aplicará dos veces');
    expect(byTestId('fee-error')?.textContent).toContain('ref-sintetica-25w');

    setFee.and.resolveTo({ kind: 'updated', event: ASSIGNED, replayed: true });
    await click('fee-confirm-button');
    const [first, second] = setFee.calls.allArgs().map((args) => args[3]);
    expect(second).toBe(first);
    expect(byTestId('fee-result-replayed')).not.toBeNull();

    await assign('91000');
    expect(setFee.calls.mostRecent().args[3]).not.toBe(first);
  });

  it('cambiar el importe tras un fallo usa una clave nueva', async () => {
    setFee.and.resolveTo(failed(503, 'upstream_unavailable'));
    await create(PUBLISHED.id);

    await assign('90000');
    await click('fee-confirm-button');
    await click('fee-confirm-button');
    const keys = setFee.calls.allArgs().map((args) => args[3]);
    expect(new Set(keys).size).toBe(1);

    const cancel = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Cancelar'),
    )!;
    cancel.click();
    await settle();
    await assign('95000');
    expect(setFee.calls.mostRecent().args[3]).not.toBe(keys[0]);
  });

  it('muestra el reintento automático en curso y evita el doble envío', async () => {
    let finish!: (outcome: FeeOutcome) => void;
    setFee.and.callFake(
      (
        _id: string,
        _amount: string,
        _version: number,
        _key: string,
        onRetry: (n: number) => void,
      ) => {
        onRetry(1);
        return new Promise<FeeOutcome>((resolve) => (finish = resolve));
      },
    );
    await create(PUBLISHED.id);

    await assign('90000');
    expect(byTestId('fee-retrying')?.textContent).toContain('1 de 3');
    expect((byTestId('fee-confirm-button') as HTMLButtonElement).disabled).toBeTrue();
    byTestId('fee-confirm-button')!.click();
    expect(setFee).toHaveBeenCalledTimes(1);

    finish({ kind: 'updated', event: ASSIGNED, replayed: false });
    await settle();
    expect(byTestId('fee-retrying')).toBeNull();
  });

  it('un 404 del comando y la clave reutilizada muestran su mensaje', async () => {
    setFee.and.resolveTo(failed(404, 'event_not_found'));
    await create(PUBLISHED.id);
    await assign('90000');
    expect(byTestId('fee-error')?.textContent).toContain('no te pertenece');

    setFee.and.resolveTo(failed(409, 'idempotency_key_reused'));
    await click('fee-confirm-button');
    expect(byTestId('fee-error')?.textContent).toContain('No pudimos confirmar este cambio');
  });

  it('advierte cuando el evento ya comenzó, sin decidir la regla', async () => {
    await create(PUBLISHED.id, [{ ...PUBLISHED, startsAt: '2026-01-10T12:00:00Z' }]);

    expect(byTestId('fee-started-warning')?.textContent).toContain('ya comenzó');
    expect(byTestId('fee-save')).not.toBeNull();
  });

  it('cancelar la confirmación vuelve al formulario sin enviar', async () => {
    await create(PUBLISHED.id);

    await type('90000');
    await click('fee-save');
    const cancel = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Cancelar'),
    )!;
    cancel.click();
    await settle();

    expect(byTestId('fee-confirm')).toBeNull();
    expect(setFee).not.toHaveBeenCalled();
  });
});
