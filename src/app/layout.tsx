import type { Metadata } from 'next';
import { Sidebar, MobileNav } from '@/components/layout/Sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Macro Dashboard',
  description: 'Macro investing & analytics dashboard — FRED, Alpaca, EDGAR, Finnhub',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <MobileNav />
        <main className="md:ml-[220px] min-h-screen pb-20 md:pb-0">
          <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
