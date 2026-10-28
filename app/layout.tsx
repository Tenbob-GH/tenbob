import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";
import { Header } from "@/components/Header";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tenbob — XRPL NFT Marketplace",
  description: "Native XLS-20 NFTs on the XRP Ledger. No wrappers, no Ethereum.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${syne.variable} ${plex.variable} ${plexMono.variable} font-sans bg-ink-950 text-[#f4f6ea] bg-grain antialiased`}>
        <WalletProvider>
          <Header />
          <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
