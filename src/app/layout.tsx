import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/shared/components/ServiceWorkerRegistrar';

const iranSansX = localFont({
  variable: '--font-sans',
  display: 'swap',
  src: [
    {
      path: './fonts/Iransansx/woff2/IRANSansX-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/Iransansx/woff2/IRANSansX-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/Iransansx/woff2/IRANSansX-DemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './fonts/Iransansx/woff2/IRANSansX-ExtraBold.woff2',
      weight: '800',
      style: 'normal',
    },
  ],
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
      className={`${iranSansX.variable} h-full antialiased ss02`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
