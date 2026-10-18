import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatListModule } from '@angular/material/list';

import { SimulatedResponse } from '../../../../../testing/bff-web/register-user.fixtures';
import {
  REVOKE_SESSION_RESPONSES,
  SIMULATED_REVOKE_CORRELATION_ID,
} from '../../../../../testing/bff-web/revoke-session.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { APP_CONFIG, AppConfig } from '../../../../core/config/app-config';
import { SessionStore } from '../../../../core/session/session.store';
import { LogoutButton } from './logout-button';

/** El botón vive dentro de la lista del menú, como en `ActorShell`. */
@Component({
  imports: [LogoutButton, MatListModule],
  template: `<mat-nav-list><app-logout-button /></mat-nav-list>`,
})
class MenuHost {}

const BFF = 'http://bff.example.com';
const URL = `${BFF}/v1/sessions/revoke`;

describe('LogoutButton (HU004, contrato bff-web 0.15.0)', () => {
  let fixture: ComponentFixture<MenuHost>;
  let element: HTMLElement;
  let http: HttpTestingController;
  let session: SessionStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [MenuHost],
      providers: [
        provideTranslateTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: BFF,
            registrationPoliciesVersion: null,
            healthDataConsentVersion: null,
          } satisfies AppConfig,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    session.start({
      user: {
        id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
        fullName: 'Persona Sintética',
        email: 'persona@example.com',
        actorType: 'athlete',
      },
      accessToken: 'token-sintetico',
      expiresAt: Date.now() + 600_000,
    });
    fixture = TestBed.createComponent(MenuHost);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    session.end();
  });

  const button = () => element.querySelector<HTMLButtonElement>('[data-menu-item="logout"]')!;
  const alert = () => element.querySelector<HTMLElement>('[data-testid="logout-error"]');

  /** Responde el cierre pendiente y deja que la vista refleje el resultado. */
  async function respond(response: SimulatedResponse): Promise<void> {
    const request = http.expectOne(URL);
    if (response.status === 0) {
      request.error(new ProgressEvent('error'));
    } else {
      request.flush(response.body as object | null, {
        status: response.status,
        statusText: 'simulado',
      });
    }
    // El adaptador resuelve su promesa después de la respuesta: se deja correr.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function logout(response: SimulatedResponse): Promise<void> {
    button().click();
    fixture.detectChanges();
    await respond(response);
  }

  it('es un botón accesible del menú con el texto «Cerrar sesión»', () => {
    expect(button().tagName).toBe('BUTTON');
    expect(button().type).toBe('button');
    expect(button().textContent).toContain('Cerrar sesión');
    expect(button().querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(button().getAttribute('aria-describedby')).toBeNull();
  });

  it('CA1: con 204 termina la sesión en memoria como cerrada', async () => {
    await logout(REVOKE_SESSION_RESPONSES.revoked);

    expect(session.accessToken()).toBeNull();
    expect(session.user()).toBeNull();
    expect(session.lastEndReason()).toBe('logged_out');
  });

  it('503/504: el BFF borró la cookie; la sesión local termina con el aviso de no confirmada', async () => {
    await logout(REVOKE_SESSION_RESPONSES.upstreamTimeout);

    expect(session.user()).toBeNull();
    expect(session.lastEndReason()).toBe('logged_out_unconfirmed');
  });

  it('mientras cierra, el botón se deshabilita y anuncia el progreso: un solo envío', async () => {
    button().click();
    button().click();
    fixture.detectChanges();

    expect(button().disabled).toBeTrue();
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().textContent).toContain('Cerrando sesión…');

    // `expectOne` falla si hubo dos solicitudes.
    await respond(REVOKE_SESSION_RESPONSES.revoked);
    expect(session.lastEndReason()).toBe('logged_out');
  });

  it('sin conexión la sesión sigue abierta y se explica cómo reintentar', async () => {
    await logout({ status: 0, body: null });

    expect(session.user()).not.toBeNull();
    expect(session.accessToken()).toBe('token-sintetico');
    expect(alert()?.getAttribute('role')).toBe('alert');
    expect(alert()?.textContent).toContain('no hay conexión');
    expect(alert()?.textContent).toContain('Tu sesión sigue abierta');
    expect(alert()?.textContent).not.toContain('Código de referencia');
    expect(button().disabled).toBeFalse();
    expect(button().getAttribute('aria-describedby')).toBe('logout-error');
  });

  it('403 origin_not_allowed muestra la referencia; reintentar con éxito retira el aviso y cierra', async () => {
    await logout(REVOKE_SESSION_RESPONSES.originNotAllowed);

    expect(alert()?.textContent).toContain('No pudimos cerrar sesión');
    expect(alert()?.textContent).toContain(SIMULATED_REVOKE_CORRELATION_ID);
    expect(session.user()).not.toBeNull();

    await logout(REVOKE_SESSION_RESPONSES.revoked);

    expect(alert()).toBeNull();
    expect(session.lastEndReason()).toBe('logged_out');
  });

  it('no escribe la sesión en el almacenamiento del navegador ni en la consola', async () => {
    const setItem = spyOn(Storage.prototype, 'setItem');
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      spyOn(console, name),
    );

    await logout(REVOKE_SESSION_RESPONSES.revoked);

    expect(setItem).not.toHaveBeenCalled();
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
