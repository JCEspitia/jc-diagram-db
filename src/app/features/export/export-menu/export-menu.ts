import { ChangeDetectionStrategy, Component, HostListener, input, signal } from '@angular/core';
import { LucideBraces, LucideFileImage, LucideFileText } from '@lucide/angular';
import type { DiagramExportFormat } from '../../../core/export/diagram-exporter';
import { DatabaseSchema, DiagramLayout } from '../../../core/schema';

@Component({
  selector: 'app-export-menu',
  imports: [LucideBraces, LucideFileImage, LucideFileText],
  templateUrl: './export-menu.html',
  styleUrl: './export-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportMenu {
  readonly schema = input.required<DatabaseSchema>();
  readonly layout = input.required<DiagramLayout>();
  readonly projectName = input.required<string>();

  protected readonly open = signal(false);
  protected readonly areaId = signal<string | null>(null);
  protected readonly exporting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected areaEntries() {
    return Object.entries(this.layout().areas ?? {});
  }

  protected async export(format: DiagramExportFormat): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.error.set(null);
    try {
      const { exportDiagram } = await import('../../../core/export/diagram-exporter');
      await exportDiagram(
        {
          schema: this.schema(),
          layout: this.layout(),
          projectName: this.projectName(),
          ...(this.areaId() ? { areaId: this.areaId()! } : {}),
        },
        format,
      );
      this.open.set(false);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The export could not be created.');
    } finally {
      this.exporting.set(false);
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  protected closeOnOutsideClick(event: PointerEvent): void {
    if (!(event.target as Element | null)?.closest('app-export-menu')) this.open.set(false);
  }
}
