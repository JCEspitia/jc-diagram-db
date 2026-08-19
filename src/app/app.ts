import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SimpleDbmlParser } from './core/dbml';
import { DiagramLayout } from './core/schema';
import { DiagramCanvas } from './features/diagram/diagram-canvas/diagram-canvas';

@Component({
  selector: 'app-root',
  imports: [DiagramCanvas],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly dbml = `Table users {
  id uuid [pk]
  email varchar [unique]
}

Table posts {
  id uuid [pk]
  user_id uuid
  title varchar
}

Ref: posts.user_id > users.id`;
  protected readonly schema = new SimpleDbmlParser().parse(this.dbml).schema!;
  protected readonly layout: DiagramLayout = {
    tables: Object.fromEntries(
      this.schema.tables.map((table) => [
        table.id,
        table.name === 'users' ? { x: 440, y: 150 } : { x: 70, y: 300 },
      ]),
    ),
    viewport: { x: 35, y: 20, zoom: 1 },
  };
  protected readonly selectedTable = this.schema.tables[0]!;
}
