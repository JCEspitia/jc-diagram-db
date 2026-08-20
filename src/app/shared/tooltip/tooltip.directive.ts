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

@Directive({
  selector: '[appTooltip]',
})
export class TooltipDirective implements OnDestroy {
  readonly appTooltip = input<string | null | undefined>('');
  readonly appTooltipPosition = input<'top' | 'side'>('top');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private tooltip?: HTMLElement;
  private showTimer?: ReturnType<typeof setTimeout>;

  @HostListener('mouseenter')
  @HostListener('focusin')
  protected scheduleShow(): void {
    if (!this.appTooltip()?.trim() || this.tooltip) return;
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
  }

  ngOnDestroy(): void {
    this.hide();
  }

  private show(): void {
    const text = this.appTooltip()?.trim();
    if (!text || this.tooltip) return;

    const tooltip = this.renderer.createElement('div') as HTMLElement;
    const id = `app-tooltip-${nextTooltipId++}`;
    tooltip.id = id;
    tooltip.className = 'app-tooltip';
    tooltip.textContent = text;
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
}
