import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { PullToRefresh } from "@/components/PullToRefresh";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CB POS",
  description: "Retail point-of-sale",
};

// Lock the zoom so focusing a field on iOS doesn't blow the layout up.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col overflow-x-clip">
        <PullToRefresh />
        {user && <Nav user={user} />}
        <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
