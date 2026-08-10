import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import '@openmaic/renderer/fonts.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';
import { AccessCodeGuard } from '@/components/access-code-guard';
import { DomIntegrityGuard } from '@/components/dom-integrity-guard';
import { PRODUCT_BRAND } from '@/lib/product-brand';

const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  variable: '--font-sans',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: `${PRODUCT_BRAND.fullName}｜${PRODUCT_BRAND.category}`,
  description: PRODUCT_BRAND.description,
  applicationName: PRODUCT_BRAND.fullName,
  icons: {
    icon: '/brand/vaultide-app-icon.png',
    apple: '/brand/vaultide-app-icon.png',
  },
  other: {
    google: 'notranslate',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      dir="ltr"
      translate="no"
      className={`${inter.variable} notranslate`}
      suppressHydrationWarning
    >
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <I18nProvider>
            <DomIntegrityGuard />
            <AccessCodeGuard>
              <ServerProvidersInit />
              {children}
            </AccessCodeGuard>
            <Toaster position="top-center" />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
