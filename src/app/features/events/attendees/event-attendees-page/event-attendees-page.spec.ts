import { HttpErrorResponse } from '@angular/common/http';
import { Component, LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  ATTENDEES_DRAFT,
  ATTENDEES_EVENT,
} from '../../../../../testing/bff-web/event-attendees.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { OrganizerEvent, toOrganizerEvent } from '../../publish-event/publish-event.model';
import { AttendeesGateway } from '../attendees.gateway';
import { OwnEventsStore } from '../own-events.store';
import { EventAttendeesPage } from './event-attendees-page';

const DRAFT = toOrganizerEvent(ATTENDEES_DRAFT);
const PUBLISHED = toOrganizerEvent(ATTENDEES_EVENT);

@Component({ selector: 'app-detail-stub', template: 'detalle' })
class DetailStub {}

describe('EventAttendeesPage (HU022)', () => {
  let loadOwnEvents: jasmine.Spy;
  let harness: RouterTestingHarness;
  let element: HTMLElement;
  let loader: HarnessLoader;

  async function open(url = '/'): Promise<void> {
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    element = harness.routeNativeElement!;
    loader = TestbedHarnessEnvironment.loader(harness.fixture);
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
      await harness.fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
    harness.detectChanges();
  }

  const byTestId = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  beforeEach(() => {
    loadOwnEvents = jasmine.createSpy('loadOwnEvents').and.resolveTo([DRAFT, PUBLISHED]);
    TestBed.configureTestingModule({
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        provideRouter([
          {
            path: '',
            component: EventAttendeesPage,
            providers: [
              {
                provide: AttendeesGateway,
                useValue: { loadOwnEvents, loadAttendees: () => new Promise(() => undefined) },
              },
              OwnEventsStore,
            ],
            children: [{ path: ':eventId', component: DetailStub }],
          },
        ]),
      ],
    });
  });

  it('muestra la carga mientras consulta los eventos propios', async () => {
    loadOwnEvents.and.returnValue(new Promise<readonly OrganizerEvent[]>(() => undefined));
    await open();

    expect(element.querySelector('h1')?.textContent).toContain('Inscritos de mis eventos');
    expect(byTestId('attendees-events-loading')).not.toBeNull();
  });

  it('ofrece los eventos propios (borradores y publicados) y pide elegir uno', async () => {
    await open();

    expect(byTestId('attendees-choose')?.textContent).toContain('Elige uno de tus eventos');
    expect(element.textContent).toContain('sin datos de contacto ni exportación');
    const select = await loader.getHarness(MatSelectHarness);
    await select.open();
    const options = await Promise.all((await select.getOptions()).map((o) => o.getText()));
    expect(options.length).toBe(2);
    expect(options[0]).toContain(DRAFT.name);
    expect(options[0]).toContain('Borrador');
    expect(options[1]).toContain(PUBLISHED.name);
    expect(options[1]).toContain('Publicado');
  });

  it('elegir un evento abre su detalle en :eventId', async () => {
    await open();
    const select = await loader.getHarness(MatSelectHarness);
    await select.open();
    await select.clickOptions({ text: new RegExp(PUBLISHED.name) });
    await settle();

    expect(TestBed.inject(Router).url).toBe(`/${PUBLISHED.id}`);
    expect(byTestId('attendees-choose')).toBeNull();
    expect(element.textContent).toContain('detalle');
  });

  it('al entrar por la URL del detalle, el selector muestra ese evento', async () => {
    await open(`/${PUBLISHED.id}`);
    const select = await loader.getHarness(MatSelectHarness);

    expect(await select.getValueText()).toContain(PUBLISHED.name);
  });

  it('sin eventos propios lo explica', async () => {
    loadOwnEvents.and.resolveTo([]);
    await open();

    expect(byTestId('attendees-events-empty')?.textContent).toContain('Aún no tienes eventos');
  });

  it('un fallo al consultar los eventos se informa y permite reintentar', async () => {
    loadOwnEvents.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await open();

    const error = byTestId('attendees-events-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    loadOwnEvents.and.resolveTo([PUBLISHED]);
    error.querySelector('button')!.click();
    await settle();
    expect(byTestId('attendees-events-error')).toBeNull();
    expect(loadOwnEvents).toHaveBeenCalledTimes(2);
  });
});
