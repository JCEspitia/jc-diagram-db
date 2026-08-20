import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DiagramAreaLayout } from '../../../core/schema';
import { TooltipDetails, TooltipDirective } from '../../../shared/tooltip/tooltip.directive';
import { LucideChevronRight, LucideSettings } from '@lucide/angular';

@Component({
  selector: 'app-diagram-area',
  imports: [LucideChevronRight, LucideSettings, TooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diagram-area.html',
  styleUrl: './diagram-area.scss',
})
export class DiagramArea {
  readonly areaId = input.required<string>();
  readonly area = input.required<DiagramAreaLayout>();
  readonly tableNames = input<string[]>([]);
  readonly moveStarted = output<{ areaId: string; event: PointerEvent }>();
  readonly resizeStarted = output<{ areaId: string; event: PointerEvent }>();
  readonly editRequested = output<string>();
  readonly collapsedChanged = output<string>();

  protected tooltipDetails(): TooltipDetails | undefined {
    if (!this.area().note && !this.tableNames().length) return undefined;
    return {
      title: this.area().name,
      ...(this.area().note ? { comment: this.area().note } : {}),
      ...(this.tableNames().length ? { tables: this.tableNames() } : {}),
    };
  }

  protected startMove(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.moveStarted.emit({ areaId: this.areaId(), event });
  }

  protected startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.resizeStarted.emit({ areaId: this.areaId(), event });
  }

  protected edit(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.editRequested.emit(this.areaId());
  }

  protected toggleCollapsed(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.collapsedChanged.emit(this.areaId());
  }
}
