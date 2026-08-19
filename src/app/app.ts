import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DiagramCanvas } from './features/diagram/diagram-canvas/diagram-canvas';
import { DbmlEditor } from './features/editor/dbml-editor/dbml-editor';
import { DiagramStore } from './state/diagram.store';

@Component({
  selector: 'app-root',
  imports: [DiagramCanvas, DbmlEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(DiagramStore);

  constructor() {
    this.store.selectTable(this.store.schema().tables[0]!.id);
  }
}
