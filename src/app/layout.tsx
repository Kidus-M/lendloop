import type { Metadata } from "next";
import {
  Atkinson_Hyperlegible_Next,
  Big_Shoulders,
  Big_Shoulders_Stencil,
} from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

const bigShoulders = Big_Shoulders({
  subsets: ["latin"],
  variable: "--font-big-shoulders",
});

const bigShouldersStencil = Big_Shoulders_Stencil({
  subsets: ["latin"],
  variable: "--font-big-shoulders-stencil",
});

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson",
});

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fonts = `${bigShoulders.variable} ${bigShouldersStencil.variable} ${atkinson.variable}`;

  return (
    <html lang="en" className={fonts}>
      <body className="min-h-dvh antialiased">
        {/* `dynamic` renders per request, which the CSP nonce in proxy.ts requires. */}
        <ClerkProvider dynamic>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
