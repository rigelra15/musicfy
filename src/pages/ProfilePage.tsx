import { useMemo } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { Icon } from '../components/Icon';
import { PREF_PROFILE_NAME } from '../features/home/ui/Onboarding';
import { APP_VERSION } from '../features/settings/prefs';
import { useHistory } from '../features/stats/useHistory';

const GREETINGS = ['profile.greet1', 'profile.greet2', 'profile.greet3', 'profile.greet4'] as const;

/** The phone's Profile: a greeting, your name, all-time listening time, the app version, and the way into Settings. */
export function ProfilePage() {
  const { t, services, navigate, openOverlay } = useApp();
  const history = useHistory(services.repo);
  const greeting = useMemo(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)], []);
  const name = services.prefs.get<string>(PREF_PROFILE_NAME, '').trim();
  const totalMinutes = Math.floor(history.events.reduce((sum, event) => sum + Math.max(0, event.listenedMs), 0) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  return (
    <section class="detail-view profile-view" aria-labelledby="profile-heading">
      <h1 id="profile-heading" class="visually-hidden">{t('profile.title')}</h1>
      <div class="profile-head">
        <span class="profile-avatar" aria-hidden="true"><Icon name="user-round" /></span>
        <div class="profile-who">
          <span class="profile-greeting">{t(greeting)}</span>
          <strong class="profile-name">{name || t('profile.guest')}</strong>
        </div>
        <button {...focusProps('profile-edit', 1, 0)} class="text-action" onClick={() => openOverlay('profile', { openerFocusId: 'profile-edit' })}>{t('profile.editName')}</button>
      </div>

      <div class="profile-card" role="group" aria-label={t('profile.listening')}>
        <span class="profile-card-label">{t('profile.listening')}</span>
        <span class="profile-figure">
          {hours > 0 ? t('profile.hours', { count: hours }) : t('profile.minutes', { count: totalMinutes })}
        </span>
        <button {...focusProps('profile-stats', 2, 0)} class="text-action" onClick={() => navigate({ name: 'stats' })}>{t('profile.viewStats')}</button>
      </div>

      <div class="profile-card" role="group" aria-label={t('profile.version')}>
        <span class="profile-card-label">{t('profile.version')}</span>
        <span class="profile-figure profile-version">{APP_VERSION}</span>
        <button {...focusProps('profile-about', 3, 0)} class="text-action" onClick={() => openOverlay('diagnostics', { openerFocusId: 'profile-about' })}>{t('profile.about')}</button>
      </div>

      <button {...focusProps('profile-settings', 4, 0)} class="lib-source-card setting-row" onClick={() => navigate({ name: 'settings' })}>
        <span class="result-title">{t('profile.openSettings')}</span>
      </button>
    </section>
  );
}
