import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate, VersionEvent } from '@angular/service-worker';

@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly updates = inject(SwUpdate, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly updateReady = signal(false);

  constructor() {
    if (typeof window === 'undefined') return;
    const setOnline = () => this.online.set(true);
    const setOffline = () => this.online.set(false);
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOffline);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', setOnline);
      window.removeEventListener('offline', setOffline);
    });

    const updates = this.updates;
    if (!updates?.isEnabled) return;
    const subscription = updates.versionUpdates.subscribe((event: VersionEvent) => {
      if (event.type === 'VERSION_READY') this.updateReady.set(true);
    });
    const interval = window.setInterval(
      () => {
      if (this.online()) void updates.checkForUpdate();
      },
      6 * 60 * 60 * 1000,
    );
    this.destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      window.clearInterval(interval);
    });
  }

  async applyUpdate(): Promise<void> {
    if (!this.updates?.isEnabled) return;
    await this.updates.activateUpdate();
    location.reload();
  }
}
