import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  afterNextRender,
  output,
  signal,
} from '@angular/core';
import { LucideChevronLeft, LucideChevronRight, LucideSparkles, LucideX } from '@lucide/angular';

interface TourStep {
  selector: string;
  eyebrow: string;
  title: string;
  description: string;
}

interface TourRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const COMPLETED_KEY = 'jc-diagram-db:tutorial-completed';

@Component({
  selector: 'app-guided-tour',
  imports: [LucideChevronLeft, LucideChevronRight, LucideSparkles, LucideX],
  templateUrl: './guided-tour.html',
  styleUrl: './guided-tour.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuidedTour {
  readonly closed = output<void>();
  protected readonly stepIndex = signal(0);
  protected readonly targetRect = signal<TourRect | null>(null);
  protected readonly cardPosition = signal({ left: 24, top: 24 });
  protected readonly steps: TourStep[] = [
    {
      selector: '[data-tour="brand"]',
      eyebrow: 'Welcome',
      title: 'Meet JC Diagram DB',
      description:
        'Design database schemas visually or with DBML. This short tour shows you the essential tools.',
    },
    {
      selector: '[data-tour="projects"]',
      eyebrow: 'Projects',
      title: 'Your work stays organized',
      description:
        'Open the project browser to create, rename, duplicate, import, or export local projects.',
    },
    {
      selector: '[data-tour="sidebar"]',
      eyebrow: 'Sidebar',
      title: 'Manage every part of the schema',
      description:
        'Switch between DBML, tables, enums, and areas. Each section edits the same synchronized model.',
    },
    {
      selector: '[data-tour="dbml"]',
      eyebrow: 'DBML editor',
      title: 'Write schemas as code',
      description:
        'Use autocomplete and validation while you type. Valid changes are reflected on the canvas automatically.',
    },
    {
      selector: '[data-tour="toolbar"]',
      eyebrow: 'Diagram tools',
      title: 'Create and arrange quickly',
      description:
        'Add tables or areas, create relationships, change the detail level, and apply automatic layouts.',
    },
    {
      selector: '[data-tour="canvas"]',
      eyebrow: 'Canvas',
      title: 'Work directly on the diagram',
      description:
        'Select with left click, add tables with Ctrl/Cmd or Shift, and drag the selection together. Pan with right or middle click.',
    },
    {
      selector: '[data-tour="export"]',
      eyebrow: 'Export',
      title: 'Share your design',
      description:
        'Export the complete diagram or individual areas as PNG, SVG, or documented PDF. You are ready to explore!',
    },
  ];

  constructor() {
    afterNextRender(() => this.updateTarget());
  }

  protected previous(): void {
    if (this.stepIndex() === 0) return;
    this.stepIndex.update((index) => index - 1);
    this.scheduleTargetUpdate();
  }

  protected next(): void {
    if (this.stepIndex() === this.steps.length - 1) {
      this.finish();
      return;
    }
    this.stepIndex.update((index) => index + 1);
    this.scheduleTargetUpdate();
  }

  protected finish(): void {
    try {
      localStorage.setItem(COMPLETED_KEY, 'true');
    } catch {
      // The tour can still close when browser storage is unavailable.
    }
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  protected closeWithKeyboard(): void {
    this.finish();
  }

  @HostListener('window:resize')
  protected updateTarget(): void {
    const target = document.querySelector<HTMLElement>(this.steps[this.stepIndex()]!.selector);
    if (!target) {
      this.targetRect.set(null);
      this.centerCard();
      return;
    }

    const bounds = target.getBoundingClientRect();
    const padding = 7;
    const rect = {
      left: Math.max(8, bounds.left - padding),
      top: Math.max(8, bounds.top - padding),
      width: Math.min(bounds.width + padding * 2, window.innerWidth - 16),
      height: Math.min(bounds.height + padding * 2, window.innerHeight - 16),
    };
    this.targetRect.set(rect);
    this.positionCard(rect);
  }

  private scheduleTargetUpdate(): void {
    requestAnimationFrame(() => this.updateTarget());
  }

  private positionCard(rect: TourRect): void {
    const margin = 18;
    const cardWidth = Math.min(360, window.innerWidth - 32);
    const cardHeight = 250;
    let left = rect.left + rect.width + margin;
    let top = rect.top;

    if (left + cardWidth > window.innerWidth - 16) left = rect.left - cardWidth - margin;
    if (left < 16) {
      left = Math.min(Math.max(16, rect.left), window.innerWidth - cardWidth - 16);
      top = rect.top + rect.height + margin;
      if (top + cardHeight > window.innerHeight - 16) top = rect.top - cardHeight - margin;
    }

    this.cardPosition.set({
      left: Math.max(16, Math.min(left, window.innerWidth - cardWidth - 16)),
      top: Math.max(16, Math.min(top, window.innerHeight - cardHeight - 16)),
    });
  }

  private centerCard(): void {
    const cardWidth = Math.min(360, window.innerWidth - 32);
    this.cardPosition.set({
      left: (window.innerWidth - cardWidth) / 2,
      top: Math.max(16, (window.innerHeight - 250) / 2),
    });
  }
}

export function shouldShowGuidedTour(): boolean {
  try {
    return localStorage.getItem(COMPLETED_KEY) !== 'true';
  } catch {
    return true;
  }
}
