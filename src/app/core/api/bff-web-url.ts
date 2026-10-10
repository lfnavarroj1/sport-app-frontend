import { Injectable, inject } from '@angular/core';

import { APP_CONFIG } from '../config/app-config';

export class BffNotConfiguredError extends Error {
  constructor() {
    super('La URL del BFF web no está definida para este ambiente.');
    this.name = 'BffNotConfiguredError';
  }
}

/**
 * Único punto para construir URLs hacia el BFF web. La aplicación no llama a
 * microservicios internos: toda operación usa rutas del contrato OpenAPI del BFF.
 */
@Injectable({ providedIn: 'root' })
export class BffWebUrl {
  private readonly config = inject(APP_CONFIG);

  get isConfigured(): boolean {
    return this.config.bffWebBaseUrl !== null;
  }

  /** @param path ruta definida en el contrato OpenAPI aprobado del BFF web. */
  resolve(path: string): string {
    const baseUrl = this.config.bffWebBaseUrl;
    if (baseUrl === null) {
      throw new BffNotConfiguredError();
    }
    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }
}
