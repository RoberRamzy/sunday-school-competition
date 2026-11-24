"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api, errorText, json, type Language, type Principal, type Theme, type Translate } from "../api";
import { Icon } from "./ui-icon";
import { SignIn } from "./sign-in";
import { Staff } from "./staff";
import { Student } from "./student";

export function Portal({ staffEntry = false, initialLanguage, initialTheme, initialPrincipal }: {
  staffEntry?: boolean; initialLanguage: Language; initialTheme: Theme; initialPrincipal: Principal | null;
}) {
  const [language, setLanguage] = useState(initialLanguage);
  const [principal, setPrincipal] = useState(initialPrincipal);
  const [theme, setTheme] = useState(initialTheme);
  const [error, setError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const t: Translate = (en, ar) => language === "ar" ? ar : en;
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    api<{ theme: Theme }>("/appearance", options).then(({ theme }) => setTheme(theme)).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  useEffect(() => {
    if (!principal) return;
    const checkSession = async () => {
      try {
        setPrincipal(await api<Principal>("/auth/me"));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setPrincipal(null);
          setError(error);
        }
      }
    };
    window.addEventListener("focus", checkSession);
    return () => window.removeEventListener("focus", checkSession);
  }, [principal]);

  async function logout() {
    setLoggingOut(true);
    setError(null);
    try {
      await api("/auth/logout", json("POST"));
      setPrincipal(null);
    } catch (error) {
      setError(error);
    } finally {
      setLoggingOut(false);
    }
  }

  return <div className="site" data-theme={theme} dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
    <a className="skip-link" href="#main-content">{t("Skip to content", "انتقل إلى المحتوى")}</a>
    <header className="site-header">
      <div className="header-inner">
        <Link className="wordmark" href={staffEntry ? "/staff" : "/"} prefetch={false}>
          <span className="brand-icon"><Icon name="book" size={23}/></span>
          <span>{t("Sunday School", "مدارس الأحد")}<small>{t("Competition", "المسابقة")}</small></span>
        </Link>
        <nav aria-label={t("Site", "الموقع")}>
          <button className="utility language" type="button" onClick={() => {
            const next: Language = language === "en" ? "ar" : "en";
            document.cookie = `sunday-school-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
            setLanguage(next);
          }}><Icon name="globe" size={17}/><span lang={language === "en" ? "ar" : "en"}>{t("العربية", "English")}</span></button>
          {principal ? <button className="utility logout" type="button" onClick={logout} disabled={loggingOut}>
            <Icon name="logout" size={18}/>{t("Sign out", "تسجيل الخروج")}
          </button> : !staffEntry && <Link className="utility staff-link" href="/staff" prefetch={false}>{t("Staff sign in", "دخول الخدام")}</Link>}
        </nav>
      </div>
    </header>
    {error ? <p className="site-notice notice error" role="alert">{errorText(error, t)}</p> : null}
    {!principal ? <SignIn staff={staffEntry} t={t} theme={theme} onSignIn={(next) => { setError(null); setPrincipal(next); }} />
      : principal.role === "STUDENT" ? <Student principal={principal} language={language} t={t} />
      : <Staff principal={principal} theme={theme} setTheme={setTheme} language={language} />}
    <footer className="site-footer"><span>{t("Sunday School Competition", "مسابقة مدارس الأحد")}</span><span>{t("Need help? Contact your servant.", "تحتاج مساعدة؟ تواصل مع خادمك.")}</span></footer>
  </div>;
}
