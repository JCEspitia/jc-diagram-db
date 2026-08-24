import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import {
  LucideCheck,
  LucideCopy,
  LucideFolderOpen,
  LucidePencil,
  LucidePlus,
  LucideTable2,
  LucideTrash2,
  LucideX,
} from '@lucide/angular';
import { DiagramProject } from '../../../core/schema';
import { TooltipDirective } from '../../../shared/tooltip/tooltip.directive';
import { DiagramStore } from '../../../state/diagram.store';

@Component({
  selector: 'app-project-browser',
  imports: [
    LucideCheck,
    LucideCopy,
    LucideFolderOpen,
    LucidePencil,
    LucidePlus,
    LucideTable2,
    LucideTrash2,
    LucideX,
    TooltipDirective,
  ],
  templateUrl: './project-browser.html',
  styleUrl: './project-browser.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectBrowser {
  protected readonly store = inject(DiagramStore);
  readonly closed = output<void>();
  protected readonly newProjectName = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly editingName = signal('');
  protected readonly busy = signal(false);

  protected async create(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this.store.createProject(this.newProjectName().trim() || 'Untitled diagram');
    this.busy.set(false);
    this.closed.emit();
  }

  protected async open(projectId: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this.store.openProject(projectId);
    this.busy.set(false);
    this.closed.emit();
  }

  protected startRename(project: DiagramProject): void {
    this.editingId.set(project.id);
    this.editingName.set(project.name);
  }

  protected async finishRename(projectId: string): Promise<void> {
    const name = this.editingName().trim();
    if (name) await this.store.renameProject(projectId, name);
    this.editingId.set(null);
  }

  protected async duplicate(projectId: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this.store.duplicateProject(projectId);
    this.busy.set(false);
    this.closed.emit();
  }

  protected async remove(project: DiagramProject): Promise<void> {
    if (this.busy() || !confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
    this.busy.set(true);
    await this.store.deleteProject(project.id);
    this.busy.set(false);
  }

  protected tableCount(project: DiagramProject): string {
    return `${project.schema.tables.length} ${project.schema.tables.length === 1 ? 'table' : 'tables'}`;
  }

  protected modifiedAt(project: DiagramProject): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(project.updatedAt),
    );
  }
}
