import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'lk.spatren.field',
  appName: 'SPATREN',
  webDir: 'dist',
  android: { backgroundColor: '#0b1520' },
  plugins: { LocalNotifications: { iconColor: '#BED43D' } },
}

export default config
