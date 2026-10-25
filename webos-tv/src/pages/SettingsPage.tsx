import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import type { Language } from '../app/i18n';
import { PREF_HIDE_EXPLICIT, PREF_HIDE_VIDEO_SONGS } from '../features/home/feed';
import { PREF_ONBOARDING_DONE, PREF_PROFILE_NAME } from '../features/home/ui/Onboarding';
import { WideCard } from '../features/library/ui';
import { FAILURE_TIMEOUTS, PREF_BLUR, PREF_DONT_SKIP_ON_FAILURE, PREF_FAILURE_TIMEOUT, PREF_FORMAT_BADGE, PREF_FORMAT_SAMPLE_RATE, PREF_SAVE_QUEUE, PREF_SHOW_SOURCE, failureTimeoutSeconds } from '../features/settings/prefs';
import { DEFAULT_HISTORY_SECONDS, PREF_HISTORY_PAUSED, PREF_HISTORY_SECONDS } from '../playback/listening';
import { PREF_AUTOPLAY } from '../playback/radio';
import type { ScrobbleSiteStatus, ScrobbleStatus } from '../scrobble/client';
import { PREF_SCROBBLE_LIKES, PREF_SCROBBLE_NOW_PLAYING } from '../scrobble/timer';

const PREF_LANGUAGE = 'ui.language';
const HISTORY_CHOICES = [10, 30, 60, 120];

/** One line of the page: what it is, what it is set to, and what it does. */
function SettingRow({ id, row, title, value, hint, onSelect }: { id: string; row: number; title: string; value?: string; hint?: string; onSelect(): void }) {
  return (
    <button {...focusProps(id, row, 0)} class="lib-source-card setting-row" onClick={onSelect}>
      <span class="result-title">{title}{value !== undefined && <em class="setting-value"> · {value}</em>}</span>
      {hint && <span class="result-artist">{hint}</span>}
    </button>
  );
}

export function SettingsPage() {
  const { t, navigate, services, scrobble, openOverlay, toast, language } = useApp();
  const { prefs, repo } = services;
  const [accounts, setAccounts] = useState<ScrobbleStatus | 'unavailable' | undefined>(undefined);
  const refreshAccounts = () => { scrobble.status().then(setAccounts, () => setAccounts('unavailable')); };
  useEffect(() => {
    refreshAccounts();
    // Back from the sign-in overlay (or a change made there) shows up without leaving the page.
    const timer = setInterval(refreshAccounts, 5000);
    return () => clearInterval(timer);
  }, []);

  const on = (key: string, fallback = false) => prefs.get<boolean>(key, fallback) === true;
  const flag = (key: string) => () => { void prefs.set(key, !on(key)).catch(() => toast(t('set.saveFailed'))); };
  const state = (value: boolean) => t(value ? 'set.on' : 'set.off');
  const choose = (title: string, items: Array<{ id: string; label: string; selected: boolean; onSelect(): void }>, opener: string) => openOverlay('actions', { openerFocusId: opener, props: { title, actions: items } });
  const confirm = (title: string, body: string, onConfirm: () => void, opener: string) => openOverlay('confirm', { openerFocusId: opener, props: { title, body, confirmLabel: t('set.delete'), onConfirm } });

  const historySeconds = Math.max(0, Number(prefs.get(PREF_HISTORY_SECONDS, DEFAULT_HISTORY_SECONDS)));
  const profileName = prefs.get<string>(PREF_PROFILE_NAME, '');
  const failureTimeout = failureTimeoutSeconds(prefs.get(PREF_FAILURE_TIMEOUT, undefined));
  const siteRow = (site: ScrobbleSiteStatus, row: number) => (
    <SettingRow key={site.id} id={`set-${site.id}`} row={row} title={site.label}
      value={!site.configured ? t('set.scrobble.notConfiguredShort') : site.signedIn ? `${site.username}${site.enabled ? '' : ` (${t('set.scrobble.paused')})`}` : t('set.scrobble.signedOut')}
      hint={!site.configured ? t('set.scrobble.notConfigured', { site: site.label }) : site.signedIn ? t('set.scrobble.manage') : t('set.scrobble.connect')}
      onSelect={() => {
        if (!site.signedIn) { openOverlay('scrobbleAccount', { openerFocusId: `set-${site.id}`, props: { site } }); return; }
        choose(site.label, [
          { id: 'toggle', label: t(site.enabled ? 'set.scrobble.pause' : 'set.scrobble.resume'), selected: false, onSelect: () => { void scrobble.setEnabled(site.id, !site.enabled).then(setAccounts).catch(() => toast(t('set.saveFailed'))); } },
          { id: 'out', label: t('set.scrobble.signOut'), selected: false, onSelect: () => confirm(t('set.scrobble.signOutTitle', { site: site.label }), t('set.scrobble.signOutBody', { site: site.label }), () => { void scrobble.signOut(site.id).then(setAccounts).catch(() => toast(t('set.saveFailed'))); }, `set-${site.id}`) },
        ], `set-${site.id}`);
      }} />
  );

  let row = 0;
  const next = () => (row += 1);
  return (
    <section class="detail-view settings-view" aria-labelledby="settings-heading">
      <h1 id="settings-heading">{t('nav.settings')}</h1>

      <h2 class="section-heading">{t('set.general')}</h2>
      <SettingRow id="set-language" row={next()} title={t('set.language')} value={language === 'id' ? 'Bahasa Indonesia' : 'English'}
        onSelect={() => choose(t('set.language'), (['id', 'en'] as Language[]).map((code) => ({ id: code, label: code === 'id' ? 'Bahasa Indonesia' : 'English', selected: language === code, onSelect: () => { void prefs.set(PREF_LANGUAGE, code).catch(() => toast(t('set.saveFailed'))); } })), 'set-language')} />
      <SettingRow id="set-profile" row={next()} title={t('profile.title')} hint={profileName || undefined} onSelect={() => navigate({ name: 'profile' })} />
      <SettingRow id="set-name" row={next()} title={t('set.profile.name')} value={profileName || t('set.profile.none')} onSelect={() => openOverlay('profile', { openerFocusId: 'set-name' })} />
      <SettingRow id="set-onboarding" row={next()} title={t('set.onboarding')} hint={t('set.onboardingHint')}
        onSelect={() => { void prefs.set(PREF_ONBOARDING_DONE, false).then(() => navigate({ name: 'home' })).catch(() => toast(t('set.saveFailed'))); }} />

      <h2 class="section-heading">{t('set.playback')}</h2>
      <SettingRow id="set-autoplay" row={next()} title={t('set.autoplay')} value={state(on(PREF_AUTOPLAY, true))} hint={t('set.autoplayHint')} onSelect={() => { void prefs.set(PREF_AUTOPLAY, !on(PREF_AUTOPLAY, true)).catch(() => toast(t('set.saveFailed'))); }} />
      <SettingRow id="set-explicit" row={next()} title={t('set.hideExplicit')} value={state(on(PREF_HIDE_EXPLICIT))} hint={t('set.hideExplicitHint')} onSelect={flag(PREF_HIDE_EXPLICIT)} />
      <SettingRow id="set-videos" row={next()} title={t('set.hideVideos')} value={state(on(PREF_HIDE_VIDEO_SONGS))} hint={t('set.hideVideosHint')} onSelect={flag(PREF_HIDE_VIDEO_SONGS)} />

      <SettingRow id="set-savequeue" row={next()} title={t('set.saveQueue')} value={state(on(PREF_SAVE_QUEUE, true))} hint={t('set.saveQueueHint')} onSelect={() => { void prefs.set(PREF_SAVE_QUEUE, !on(PREF_SAVE_QUEUE, true)).catch(() => toast(t('set.saveFailed'))); }} />
      <SettingRow id="set-dontskip" row={next()} title={t('set.dontSkip')} value={state(on(PREF_DONT_SKIP_ON_FAILURE))} hint={t('set.dontSkipHint')} onSelect={flag(PREF_DONT_SKIP_ON_FAILURE)} />
      {!on(PREF_DONT_SKIP_ON_FAILURE) && (
        <SettingRow id="set-failtimeout" row={next()} title={t('set.failTimeout')} value={t('set.seconds', { count: failureTimeout })} hint={t('set.failTimeoutHint')}
          onSelect={() => choose(t('set.failTimeout'), FAILURE_TIMEOUTS.map((seconds) => ({ id: String(seconds), label: t('set.seconds', { count: seconds }), selected: failureTimeout === seconds, onSelect: () => { void prefs.set(PREF_FAILURE_TIMEOUT, seconds).catch(() => toast(t('set.saveFailed'))); } })), 'set-failtimeout')} />
      )}

      <h2 class="section-heading">{t('set.appearance')}</h2>
      <SettingRow id="set-badge" row={next()} title={t('set.formatBadge')} value={state(on(PREF_FORMAT_BADGE, true))} hint={t('set.formatBadgeHint')} onSelect={() => { void prefs.set(PREF_FORMAT_BADGE, !on(PREF_FORMAT_BADGE, true)).catch(() => toast(t('set.saveFailed'))); }} />
      <SettingRow id="set-samplerate" row={next()} title={t('set.sampleRate')} value={state(on(PREF_FORMAT_SAMPLE_RATE))} hint={t('set.sampleRateHint')} onSelect={flag(PREF_FORMAT_SAMPLE_RATE)} />
      <SettingRow id="set-blur" row={next()} title={t('set.blur')} value={state(on(PREF_BLUR, true))} hint={t('set.blurHint')} onSelect={() => { void prefs.set(PREF_BLUR, !on(PREF_BLUR, true)).catch(() => toast(t('set.saveFailed'))); }} />

      <h2 class="section-heading">{t('set.history')}</h2>
      <SettingRow id="set-history-paused" row={next()} title={t('set.historyPaused')} value={state(on(PREF_HISTORY_PAUSED))} hint={t('set.historyPausedHint')} onSelect={flag(PREF_HISTORY_PAUSED)} />
      <SettingRow id="set-history-min" row={next()} title={t('set.historyMin')} value={t('set.seconds', { count: historySeconds })} hint={t('set.historyMinHint')}
        onSelect={() => choose(t('set.historyMin'), HISTORY_CHOICES.map((seconds) => ({ id: String(seconds), label: t('set.seconds', { count: seconds }), selected: historySeconds === seconds, onSelect: () => { void prefs.set(PREF_HISTORY_SECONDS, seconds).catch(() => toast(t('set.saveFailed'))); } })), 'set-history-min')} />
      <SettingRow id="set-clear-history" row={next()} title={t('set.clearHistory')} hint={t('set.clearHistoryHint')}
        onSelect={() => confirm(t('set.clearHistory'), t('set.clearHistoryBody'), () => { void repo.clearHistory().then(() => toast(t('set.cleared'))).catch(() => toast(t('set.saveFailed'))); }, 'set-clear-history')} />
      <SettingRow id="set-clear-searches" row={next()} title={t('set.clearSearches')}
        onSelect={() => confirm(t('set.clearSearches'), t('set.clearSearchesBody'), () => { void repo.clearSearches().then(() => toast(t('set.cleared'))).catch(() => toast(t('set.saveFailed'))); }, 'set-clear-searches')} />

      <h2 class="section-heading">{t('set.integrations')}</h2>
      {accounts === undefined && <p class="detail-note">{t('common.loading')}</p>}
      {accounts === 'unavailable' && <p class="detail-note" role="note">{t('set.scrobble.unavailable')}</p>}
      {accounts && accounts !== 'unavailable' && (
        <>
          {accounts.sites.map((site) => siteRow(site, next()))}
          <SettingRow id="set-nowplaying" row={next()} title={t('set.scrobble.nowPlaying')} value={state(on(PREF_SCROBBLE_NOW_PLAYING, true))} hint={t('set.scrobble.nowPlayingHint')} onSelect={() => { void prefs.set(PREF_SCROBBLE_NOW_PLAYING, !on(PREF_SCROBBLE_NOW_PLAYING, true)).catch(() => toast(t('set.saveFailed'))); }} />
          <SettingRow id="set-likes" row={next()} title={t('set.scrobble.likes')} value={state(on(PREF_SCROBBLE_LIKES))} hint={t('set.scrobble.likesHint')} onSelect={flag(PREF_SCROBBLE_LIKES)} />
          <SettingRow id="set-pending" row={next()} title={t('set.scrobble.pending', { count: accounts.pending })} hint={accounts.pending > 0 ? t('set.scrobble.sendNow') : undefined}
            onSelect={() => { void scrobble.flush().then((status) => { setAccounts(status); toast(t(status.pending ? 'set.scrobble.stillPending' : 'set.scrobble.sent')); }).catch(() => toast(t('set.scrobble.unavailable'))); }} />
        </>
      )}

      <h2 class="section-heading">{t('set.sources')}</h2>
      <WideCard id="settings-modules" row={next()} title={t('settings.modules')} count={t('settings.modulesHint')} covers={[]} icon="puzzle" onOpen={() => navigate({ name: 'modules' })} />
      <WideCard id="settings-import" row={next()} title={t('settings.import')} count={t('settings.importHint')} covers={[]} icon="import" onOpen={() => navigate({ name: 'import' })} />

      <h2 class="section-heading">{t('set.experimental')}</h2>
      <SettingRow id="set-showsource" row={next()} title={t('set.showSource')} value={state(on(PREF_SHOW_SOURCE))} hint={t('set.showSourceHint')} onSelect={flag(PREF_SHOW_SOURCE)} />

      <h2 class="section-heading">{t('set.about')}</h2>
      <SettingRow id="set-diagnostics" row={next()} title={t('set.diag.title')} hint={t('set.diag.hint')} onSelect={() => openOverlay('diagnostics', { openerFocusId: 'set-diagnostics' })} />
    </section>
  );
}
