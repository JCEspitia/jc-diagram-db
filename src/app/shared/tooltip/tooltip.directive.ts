import {
  Directive,
  ElementRef,
  HostListener,
  OnDestroy,
  Renderer2,
  inject,
  input,
} from '@angular/core';

let nextTooltipId = 0;
let activeTooltip: TooltipDirective | undefined;

export interface TooltipDetails {
  title: string;
  type?: string;
  comment?: string;
  defaultValue?: string;
  enumName?: string;
  enumValues?: string[];
}

@Directive({
  selector: '[appTooltip]',
})
export class TooltipDirective implements OnDestroy {
  readonly appTooltip = input<string | null | undefined>('');
  readonly appTooltipDetails = input<TooltipDetails>();
  readonly appTooltipPosition = input<'top' | 'side'>('top');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private tooltip?: HTMLElement;
  private showTimer?: ReturnType<typeof setTimeout>;

  @HostListener('mouseenter')
  @HostListener('focusin')
  protected scheduleShow(): void {
    if ((!this.appTooltip()?.trim() && !this.appTooltipDetails()) || this.tooltip) return;
    clearTimeout(this.showTimer);
    this.showTimer = setTimeout(() => this.show(), 280);
  }

  @HostListener('mouseleave')
  @HostListener('focusout')
  @HostListener('pointerdown')
  protected hide(): void {
    clearTimeout(this.showTimer);
    this.showTimer = undefined;
    if (!this.tooltip) return;
    this.renderer.removeChild(document.body, this.tooltip);
    this.tooltip = undefined;
    this.renderer.removeAttribute(this.host.nativeElement, 'aria-describedby');
    if (activeTooltip === this) activeTooltip = undefined;
  }

  ngOnDestroy(): void {
    this.hide();
  }

  private show(): void {
    const text = this.appTooltip()?.trim();
    const details = this.appTooltipDetails();
    if ((!text && !details) || this.tooltip) return;
    activeTooltip?.hide();
    activeTooltip = this;

    const tooltip = this.renderer.createElement('div') as HTMLElement;
    const id = `app-tooltip-${nextTooltipId++}`;
    tooltip.id = id;
    tooltip.className = details ? 'app-tooltip rich' : 'app-tooltip';
    if (details) this.renderDetails(tooltip, details);
    else tooltip.textContent = text!;
    tooltip.setAttribute('role', 'tooltip');
    this.renderer.appendChild(document.body, tooltip);
    this.renderer.setAttribute(this.host.nativeElement, 'aria-describedby', id);
    this.tooltip = tooltip;

    const hostBounds = this.host.nativeElement.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const gap = 8;
    let left: number;
    let top: number;
    if (this.appTooltipPosition() === 'side') {
      const right = hostBounds.right + gap;
      const fitsRight = right + tooltipBounds.width <= window.innerWidth - gap;
      left = fitsRight ? right : hostBounds.left - tooltipBounds.width - gap;
      left = Math.max(gap, Math.min(left, window.innerWidth - tooltipBounds.width - gap));
      top = hostBounds.top + (hostBounds.height - tooltipBounds.height) / 2;
      top = Math.max(gap, Math.min(top, window.innerHeight - tooltipBounds.height - gap));
    } else {
      left = hostBounds.left + (hostBounds.width - tooltipBounds.width) / 2;
      left = Math.max(gap, Math.min(left, window.innerWidth - tooltipBounds.width - gap));
      top = hostBounds.top - tooltipBounds.height - gap;
      if (top < gap) top = hostBounds.bottom + gap;
    }
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  private renderDetails(tooltip: HTMLElement, details: TooltipDetails): void {
    const heading = this.renderer.createElement('div') as HTMLElement;
    heading.className = 'app-tooltip-heading';
    this.appendText(heading, 'strong', details.title);
    if (details.type) this.appendText(heading, 'code', details.type);
    this.renderer.appendChild(tooltip, heading);

    if (details.comment) this.appendSection(tooltip, 'Comment', details.comment);
    if (details.defaultValue) this.appendSection(tooltip, 'Default', details.defaultValue, true);
    if (details.enumName && details.enumValues?.length) {
      const section = this.renderer.createElement('div') as HTMLElement;
      section.className = 'app-tooltip-section';
      this.appendText(section, 'span', `Enum · ${details.enumName}`);
      const values = this.renderer.createElement('div') as HTMLElement;
      values.className = 'app-tooltip-values';
      for (const value of details.enumValues) this.appendText(values, 'code', value);
      this.renderer.appendChild(section, values);
      this.renderer.appendChild(tooltip, section);
    }
  }

  private appendSection(parent: HTMLElement, label: string, value: string, code = false): void {
    const section = this.renderer.createElement('div') as HTMLElement;
    section.className = 'app-tooltip-section';
    this.appendText(section, 'span', label);
    this.appendText(section, code ? 'code' : 'p', value);
    this.renderer.appendChild(parent, section);
  }

  private appendText(parent: HTMLElement, tag: string, value: string): void {
    const element = this.renderer.createElement(tag) as HTMLElement;
    element.textContent = value;
    this.renderer.appendChild(parent, element);
  }
}
