import type React from "react";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata = {
  title: "SocialHub Pro - Multi-Platform Social Media Management",
  description:
    "Professional social media management dashboard for Instagram and YouTube. Manage multiple accounts, post content, and track analytics.",
  generator: "v0.app",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans">
        {children}
        <Toaster richColors theme="dark" position="top-right" />
      </body>
    </html>
  );
}
