import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DiagramAreaLayout } from '../../../core/schema';

@Component({
  selector: 'app-diagram-area',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diagram-area.html',
  styleUrl: './diagram-area.scss',
})
export class DiagramArea {
  readonly areaId = input.required<string>();
  readonly area = input.required<DiagramAreaLayout>();
  readonly moveStarted = output<{ areaId: string; event: PointerEvent }>();
  readonly resizeStarted = output<{ areaId: string; event: PointerEvent }>();

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
}
