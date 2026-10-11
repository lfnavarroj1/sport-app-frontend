import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import {
  REGISTER_USER_RESPONSES,
  VALID_REGISTER_USER_REQUEST,
} from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { BffNotConfiguredError } from '../bff-web-url';
import { BffWebUsersApi } from './users.api';

const KEY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('BffWebUsersApi', () => {
  function setup(bffWebBaseUrl: string | null): {
    api: BffWebUsersApi;
    http: HttpTestingController;
  } {
    const config: AppConfig = {
      environment: 'local',
      bffWebBaseUrl,
      registrationPoliciesVersion: 'local-dev',
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: config },
      ],
    });
    return { api: TestBed.inject(BffWebUsersApi), http: TestBed.inject(HttpTestingController) };
  }

  it('envía POST /v1/users al BFF con el cuerpo y la clave de idempotencia', async () => {
    const { api, http } = setup('http://bff.example.com/');

    const result = firstValueFrom(api.registerUser(VALID_REGISTER_USER_REQUEST, KEY));
    const request = http.expectOne('http://bff.example.com/v1/users');
    request.flush(REGISTER_USER_RESPONSES.registered.body, { status: 201, statusText: 'Created' });

    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
    expect(request.request.body).toEqual(VALID_REGISTER_USER_REQUEST);
    expect(await result).toEqual(REGISTER_USER_RESPONSES.registered.body);
    http.verify();
  });

  it('falla sin llamar a nadie si la URL del BFF no está configurada', () => {
    const { api, http } = setup(null);

    expect(() => api.registerUser(VALID_REGISTER_USER_REQUEST, KEY)).toThrowError(
      BffNotConfiguredError,
    );
    http.verify();
  });
});
