import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { localeDirection } from '@/i18n/config';
import { SessionProvider } from '@/components/providers/session-provider';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = localeDirection[locale as keyof typeof localeDirection] || 'rtl';

  return (
    <html lang={locale} dir={dir} className="dark">
      <head>
        <title>ScoutZero | منصة استكشاف المواهب والذكاء التكتيكي</title>
        <meta name="description" content="منظومة استكشاف المواهب وماني بول الدوري المصري" />
      </head>
      <body className="antialiased min-h-screen bg-[#0B0F17] text-slate-100 selection:bg-emerald-500 selection:text-black">
        <SessionProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
            <Toaster />
          </NextIntlClientProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
