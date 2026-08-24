import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !isTauriRuntime(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in globalThis;
}
