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

  protected renameTable(tableId: string, event: Event): void {
    this.store.renameTable(tableId, inputValue(event));
  }

  protected updateColumnText(
    tableId: string,
    columnId: string,
    property: 'name' | 'type',
    event: Event,
  ): void {
    const value = inputValue(event).trim();
    if (value) this.store.updateColumn(tableId, columnId, { [property]: value });
  }

  protected updateColumnFlag(
    tableId: string,
    columnId: string,
    property: 'primaryKey' | 'unique' | 'increment',
    event: Event,
  ): void {
    this.store.updateColumn(tableId, columnId, { [property]: checkboxValue(event) });
  }

  protected updateNotNull(tableId: string, columnId: string, event: Event): void {
    this.store.updateColumn(tableId, columnId, { nullable: !checkboxValue(event) });
  }
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function checkboxValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}
