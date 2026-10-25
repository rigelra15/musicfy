import { capabilityReason } from '../../platform/capabilities';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import { focusProps } from '../../app/format';
import { registerOverlay } from '../../app/OverlayHost';
import { QrCode } from '../../components/QrCode';
import { PREF_PROFILE_NAME } from '../home/ui/Onboarding';
import type { ScrobbleSiteStatus } from '../../scrobble/client';
import { APP_VERSION } from './prefs';
import type { StringKey } from '../../app/i18n';

type Props = { id: number; close(): void };
const POLL_MS = 3000;

/** Signing in to Last.fm or Libre.fm: the TV shows a QR code, the person allows Musicfy on their phone, the TV then asks the service for the account. */
function ScrobbleAccount({ id, close, site }: Props & { site: ScrobbleSiteStatus }) {
  const { t, scrobble, toast } = useApp();
  const [state, setState] = useState<{ phase: 'starting' } | { phase: 'waiting'; authUrl: string } | { phase: 'failed'; message: string } | { phase: 'expired' }>({ phase: 'starting' });
  const alive = useRef(true);

  async function start() {
    setState({ phase: 'starting' });
    try {
      const { authUrl } = await scrobble.begin(site.id);
      if (alive.current) setState({ phase: 'waiting', authUrl });
    } catch (error) { if (alive.current) setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) }); }
  }
  async function check(): Promise<void> {
    try {
      const result = await scrobble.finish(site.id);
      if (!alive.current) return;
      if (result.state === 'signedIn') { toast(t('set.scrobble.signedIn', { site: site.label, name: result.username })); close(); }
      else if (result.state === 'expired') setState({ phase: 'expired' });
    } catch (error) { if (alive.current) setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) }); }
  }
  useEffect(() => {
    alive.current = true;
    if (site.configured) void start(); else setState({ phase: 'failed', message: t('set.scrobble.notConfigured', { site: site.label }) });
    return () => { alive.current = false; };
  }, [site.id]);
  useEffect(() => {
    if (state.phase !== 'waiting') return;
    const timer = setInterval(() => { void check(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [state.phase]);

  return (
    <div class="overlay-panel pairing-panel">
      <h2>{t('set.scrobble.signIn', { site: site.label })}</h2>
      {state.phase === 'waiting' && (
        <>
          <QrCode value={state.authUrl} label={t('set.scrobble.qrLabel', { site: site.label })} />
          <p class="studio-hint">{t('set.scrobble.step', { site: site.label })}</p>
          <p class="overlay-body" role="status">{t('set.scrobble.waiting')}</p>
        </>
      )}
      {state.phase === 'starting' && <p class="overlay-body" role="status">{t('pair.starting')}</p>}
      {state.phase === 'expired' && <p class="overlay-body is-error" role="alert">{t('set.scrobble.expired')}</p>}
      {state.phase === 'failed' && <p class="overlay-body is-error" role="alert">{state.message}</p>}
      <div class="overlay-actions">
        {state.phase === 'waiting' && <button {...focusProps(`ov${id}-check`, 1, 0)} class="text-action" onClick={() => void check()}>{t('set.scrobble.allowed')}</button>}
        {(state.phase === 'failed' || state.phase === 'expired') && site.configured && <button {...focusProps(`ov${id}-again`, 1, 0)} class="text-action" onClick={() => void start()}>{t('pair.again')}</button>}
        <button {...focusProps(`ov${id}-close`, 1, 1)} class="text-action" onClick={close}>{t('preview.close')}</button>
      </div>
    </div>
  );
}
registerOverlay('scrobbleAccount', (overlay, { close }) => <ScrobbleAccount id={overlay.id} close={close} site={(overlay.props as { site: ScrobbleSiteStatus }).site} />);

/** The name shown on Home. */
function ProfileName({ id, close }: Props) {
  const { t, services } = useApp();
  const [name, setName] = useState(() => services.prefs.get<string>(PREF_PROFILE_NAME, ''));
  const [failed, setFailed] = useState(false);
  const save = async () => {
    try { const trimmed = name.trim().slice(0, 40); if (trimmed) await services.prefs.set(PREF_PROFILE_NAME, trimmed); else await services.prefs.remove(PREF_PROFILE_NAME); close(); } catch { setFailed(true); }
  };
  return (
    <div class="overlay-panel">
      <h2>{t('set.profile.name')}</h2>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label class="search-field"><input {...focusProps(`ov${id}-name`, 1, 0)} type="text" maxLength={40} value={name} aria-label={t('set.profile.name')} placeholder={t('set.profile.placeholder')} onInput={(event) => setName(event.currentTarget.value)} /></label>
      </form>
      {failed && <p class="overlay-body is-error" role="alert">{t('set.saveFailed')}</p>}
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-save`, 2, 0)} class="text-action" onClick={() => void save()}>{t('set.save')}</button>
        <button {...focusProps(`ov${id}-cancel`, 2, 1)} class="text-action" onClick={close}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
registerOverlay('profile', (overlay, { close }) => <ProfileName id={overlay.id} close={close} />);

/** What this TV can and cannot do, as the app measured it (never a guess). */
function Diagnostics({ id, close }: Props) {
  const { t, services, scrobble } = useApp();
  const [service, setService] = useState<'checking' | 'ok' | 'down'>('checking');
  useEffect(() => {
    let alive = true;
    scrobble.status().then(() => { if (alive) setService('ok'); }, () => { if (alive) setService('down'); });
    return () => { alive = false; };
  }, []);
  const all = services.capabilities.all();
  const label = (status: string) => t(status === 'supported' ? 'set.diag.supported' : status === 'unsupported' ? 'set.diag.unsupported' : 'set.diag.unverified');
  return (
    <div class="overlay-panel link-panel">
      <h2>{t('set.diag.title')}</h2>
      <ul class="preview-lines">
        <li>{t('set.diag.version', { version: APP_VERSION })}</li>
        <li>{t('set.diag.service', { state: t(service === 'ok' ? 'set.diag.reachable' : service === 'down' ? 'set.diag.unreachable' : 'set.diag.checking') })}</li>
      </ul>
      <div class="link-unmatched" role="group" aria-label={t('set.diag.capabilities')}>
        <p class="studio-hint">{t('set.diag.capabilities')}</p>
        <ul class="link-unmatched-list">
          {all.map((capability) => <li key={capability.id}>{t(`cap.name.${capability.id}` as StringKey)}: {label(capability.status)} — {capabilityReason(capability)}</li>)}
        </ul>
      </div>
      <div class="overlay-actions"><button {...focusProps(`ov${id}-close`, 1, 0)} class="text-action" onClick={close}>{t('preview.close')}</button></div>
    </div>
  );
}
registerOverlay('diagnostics', (overlay, { close }) => <Diagnostics id={overlay.id} close={close} />);
