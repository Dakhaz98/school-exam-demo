import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'School Exam Demo',
  description: 'Multi-tenant SaaS exam platform — scheduling, proctoring, and security events.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" className={inter.variable}>
      <body className={`${inter.className} antialiased min-h-screen`}>{children}</body>
    </html>
  );
}
