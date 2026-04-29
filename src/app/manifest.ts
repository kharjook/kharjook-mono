import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/login?source=pwa',
    name: 'خرجوک',
    short_name: 'خرجوک',
    description: 'مدیریت سبد دارایی و تراکنش‌ها',
    start_url: '/login?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#0F1015',
    theme_color: '#0F1015',
    prefer_related_applications: false,
    lang: 'fa',
    dir: 'rtl',
    categories: ['finance', 'productivity'],
    shortcuts: [
      {
        name: 'ثبت تراکنش',
        short_name: 'تراکنش',
        url: '/transactions/new',
      },
      {
        name: 'بروزرسانی قیمت‌ها',
        short_name: 'قیمت‌ها',
        url: '/prices',
      },
      {
        name: 'سررسیدها',
        short_name: 'سررسید',
        url: '/deadlines',
      },
    ],
    icons: [
      {
        src: '/icon-192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
