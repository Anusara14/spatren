import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'

/** True inside the Android app (Capacitor); false on the web/iPhone PWA. */
export const IS_NATIVE = Capacitor.isNativePlatform()

export const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

/** Deep link the Android app owns; Google sign-in returns here. Must be in Supabase → Auth → Redirect URLs. */
export const NATIVE_AUTH_REDIRECT = 'lk.spatren.field://auth'

/** OAuth options: the web redirects in place; the app opens a Custom Tab (Google blocks sign-in inside WebViews). */
export const oauthRedirect = (): { redirectTo: string; skipBrowserRedirect: boolean } =>
  IS_NATIVE ? { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true } : { redirectTo: window.location.origin, skipBrowserRedirect: false }

export async function openOAuth(url: string | null | undefined): Promise<void> {
  if (!IS_NATIVE || !url) return
  const { Browser } = await import('@capacitor/browser')
  await Browser.open({ url })
}

/** Android app: finish Google sign-in when the Custom Tab hands back lk.spatren.field://auth?code=… (PKCE). */
export async function listenForAuthReturn(): Promise<void> {
  if (!IS_NATIVE) return
  const [{ App }, { Browser }, { supabase }] = await Promise.all([import('@capacitor/app'), import('@capacitor/browser'), import('./supabase')])
  await App.addListener('appUrlOpen', ({ url }) => {
    if (!url.startsWith(NATIVE_AUTH_REDIRECT)) return
    void Browser.close().catch(() => undefined)
    // Only a PKCE code is accepted: it can be exchanged only with the verifier this phone stored when sign-in began.
    const code = new URLSearchParams(url.split('#')[0].split('?')[1] ?? '').get('code')
    if (code) void supabase.auth.exchangeCodeForSession(code)
  })

  // Hardware Back: close the top sheet, leave the open form or screen, go back to the map, else send the app to the
  // background (never quit it, so Field Mode keeps tracking).
  await App.addListener('backButton', () => {
    if (document.querySelector('.oi-live')) return // recording an interview: Back must not drop it (use Stop & save)
    const last = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)].pop()
    const target =
      last<HTMLElement>('.sheet-backdrop') ??
      last<HTMLElement>('button[aria-label^="Close survey"]') ??
      last<HTMLElement>('button[aria-label^="Back"]') ??
      document.querySelector<HTMLElement>('.tabbar button:first-of-type:not([aria-current])')
    if (target) target.click()
    else void App.minimizeApp()
  })
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Android app: WebViews can't download or use navigator.share with files, so write to the app cache and open the
 * system share sheet. Resolves false if the person closed the sheet without sending.
 */
export async function shareFile(bytes: Uint8Array, fileName: string, title: string): Promise<boolean> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  const { uri } = await Filesystem.writeFile({ path: fileName, data: toBase64(bytes), directory: Directory.Cache })
  try {
    await Share.share({ title, files: [uri] })
    return true
  } catch (e: unknown) {
    if (e instanceof Error && /cancel/i.test(e.message)) return false
    throw e
  }
}

export type NotifState = 'granted' | 'denied' | 'default'

export async function nativeNotifState(ask: boolean): Promise<NotifState> {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  const p = ask ? await LocalNotifications.requestPermissions() : await LocalNotifications.checkPermissions()
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'default'
}

export async function nativeNotify(title: string, body: string): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  await LocalNotifications.schedule({ notifications: [{ id: Date.now() % 2_000_000_000, title, body }] })
}
