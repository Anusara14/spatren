import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'lk.spatren.field',
  appName: 'SPATREN',
  webDir: 'dist',
  android: { backgroundColor: '#000000' },
  plugins: {
    LocalNotifications: { iconColor: '#BED43D' },
    // Self-hosted updates (see src/lib/updates.ts): no Capgo cloud, no stats sent anywhere.
    CapacitorUpdater: { autoUpdate: false, statsUrl: '', updateUrl: '', channelUrl: '', appReadyTimeout: 15000, autoDeletePrevious: true, resetWhenUpdate: true },
  },
}

export default config
