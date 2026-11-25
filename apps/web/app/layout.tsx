import type { Metadata } from "next";
import type { ReactNode } from "react";
import { readLanguage } from "./initial-state";
import { ChristmasProvider } from "./components/christmas-effects";
import "./styles.css";

export const metadata: Metadata = {
  title: "Sunday School Competition",
  description: "The Sunday School competition portal for students and staff.",
};

export default async function Layout({ children }: { children: ReactNode }) {
  const language = await readLanguage();
  return <html lang={language} dir={language === "ar" ? "rtl" : "ltr"}><body><ChristmasProvider>{children}</ChristmasProvider></body></html>;
}
