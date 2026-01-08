import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/sonner';
import { KeyboardShortcuts } from '@/components/common/KeyboardShortcuts';
import { GlobalNav } from '@/components/common/GlobalNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'myTangerine - 주문 관리',
  description: '감귤 주문 관리 시스템',
  manifest: '/manifest.json',
  themeColor: '#f97316',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'myTangerine',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <Providers>
          <GlobalNav />
          {children}
        </Providers>
        <Toaster />
        <KeyboardShortcuts />
      </body>
    </html>
  );
}
