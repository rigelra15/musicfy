import type { ComponentChildren, JSX } from 'preact';
import { Icon, type IconName } from '../../components/Icon';
import { tr } from '../../app/i18n';

/** One onboarding page: a light circle with the page's glyph, a big title, a grey line, the content, and pill buttons pinned to the bottom (the phone's OnboardingPage). */
export function OnbPage({ icon, title, subtitle, footer, className = '', children }: { icon: IconName; title: string; subtitle?: string; footer?: ComponentChildren; className?: string; children?: ComponentChildren }) {
  return (
    <div class={`onb-page ${className}`}>
      <div class="onb-col">
        <div class="onb-scroll">
          <span class="onb-badge" aria-hidden="true"><Icon name={icon} /></span>
          <h1 class="onb-title" id="onb-heading">{title}</h1>
          {subtitle && <p class="onb-subtitle">{subtitle}</p>}
          <div class="onb-content">{children}</div>
        </div>
        <div class="onb-footer">{footer}</div>
      </div>
    </div>
  );
}

export function OnbButton({ secondary, ...props }: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return <button {...props} class={`onb-button ${secondary ? 'is-secondary' : ''}`} />;
}

/** "Import / Import from backup": a big circle glyph, a title and a line of detail. */
export function OnbChoiceCard({ icon, title, description, ...props }: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; title: string; description: string }) {
  return (
    <button {...props} class="onb-card">
      <span class="onb-badge is-big" aria-hidden="true"><Icon name={icon} /></span>
      <span><span class="onb-card-title">{title}</span><span class="onb-card-text">{description}</span></span>
    </button>
  );
}

/** The phone's profile ID card: number, photo circle, name and join date, with a strip whose text slides down forever. Silver on Hello and Done. */
export function IdCard({ name, number, joined, silver, width }: { name: string; number: string; joined: string; silver?: boolean; width: number }) {
  const shown = name.trim() || '{username}';
  return (
    <div class={`idc ${silver ? 'is-silver' : ''}`} style={`width:${width}px;--cu:${width / 332}px`} aria-label={`${shown} · ${number}`}>
      <div class="idc-main">
        <span class="idc-number">PROFILE USR#{number}</span>
        <div class="idc-who">
          <span class="idc-photo" aria-hidden="true" />
          <div class="idc-text">
            {silver && <span class="idc-of">{tr('onb.idCardOf')}</span>}
            <span class="idc-name">{shown}</span>
            <span class="idc-joined">{joined}</span>
          </div>
        </div>
        <span />
      </div>
      <div class="idc-strip" aria-hidden="true">
        <div class="idc-strip-track">
          {Array.from({ length: 12 }, (_, i) => <span key={i}>{`${shown}\`s CARD   ·   `}</span>)}
        </div>
      </div>
    </div>
  );
}

/** Same as the phone: a 11-digit number, and "joined at" with the day. */
export function newCardNumber(random: () => number = Math.random): string {
  return String(10_000_000_000 + Math.floor(random() * 89_999_999_999));
}
export function joinedText(language: 'id' | 'en', now: Date = new Date()): string {
  const date = now.toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return language === 'id' ? `bergabung pada ${date}` : `joined at ${date}`;
}
