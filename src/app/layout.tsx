import type { Metadata, Viewport } from 'next';
import { Vazirmatn } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/shared/components/ServiceWorkerRegistrar';

const vazirmatn = Vazirmatn({
  variable: '--font-sans',
  subsets: ['arabic', 'latin'],
  display: 'swap',
  weight: ['300', '400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'خرجوک',
  description: 'مدیریت سبد دارایی',
  applicationName: 'خرجوک',
  appleWebApp: {
    capable: true,
    title: 'خرجوک',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#0F1015',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatn.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
