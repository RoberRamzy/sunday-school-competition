"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, errorText, json, type Language, type Principal, type Theme, type Translate } from "../api";
import { Icon } from "./ui-icon";
import { Roster } from "./roster";
import { Administration } from "./administration";
import { StaffCompetitions } from "./staff-competitions";
import { AdminOverallLeaderboard } from "./leaderboard";

type Section = "roster" | "appearance" | "administration" | "competitions" | "standings";

export function Staff({ principal, theme, setTheme, language }: {
  principal: Principal; theme: Theme; setTheme: (theme: Theme) => void; language: Language;
}) {
  const [section, setSection] = useState<Section>("roster");
  const admin = principal.role === "SUPER_ADMIN";
  const t: Translate = (en, ar) => language === "ar" ? ar : en;
  return <main id="main-content" className="workspace">
    <aside className="workspace-sidebar">
      <div className="workspace-identity">
        <span className="staff-season-accent"><Icon name="star" size={15}/></span>
        <span className="identity-icon"><Icon name="users" size={22}/></span>
        <div><bdi>{principal.displayName}</bdi><small>{admin ? t("Super admin", "مدير النظام") : t("Servant", "خادم")}</small></div>
      </div>
      <nav aria-label={t("Staff workspace", "لوحة الخدام")}>
        <button type="button" aria-current={section === "roster" ? "page" : undefined} onClick={() => setSection("roster")}><Icon name="users" size={19}/>{t("Student roster", "قائمة الطلاب")}</button>
        <button type="button" aria-current={section === "competitions" ? "page" : undefined} onClick={() => setSection("competitions")}><Icon name="calendar" size={19}/>{t("Competitions", "المسابقات")}</button>
        {admin && <button type="button" aria-current={section === "standings" ? "page" : undefined} onClick={() => setSection("standings")}><Icon name="star" size={19}/>{t("Overall leaderboard", "لوحة الترتيب العامة")}</button>}
        {admin && <button type="button" aria-current={section === "administration" ? "page" : undefined} onClick={() => setSection("administration")}><Icon name="users" size={19}/>{t("Staff and grades", "الخدام والصفوف")}</button>}
        {admin && <button type="button" aria-current={section === "appearance" ? "page" : undefined} onClick={() => setSection("appearance")}><Icon name="palette" size={19}/>{t("Appearance", "المظهر")}</button>}
      </nav>
    </aside>
    <div className="workspace-main">
      {section === "competitions" ? <StaffCompetitions admin={admin} language={language} t={t} />
        : admin && section === "standings" ? <AdminOverallLeaderboard t={t}/>
        : admin && section === "appearance" ? <Appearance theme={theme} setTheme={setTheme} t={t} />
        : admin && section === "administration" ? <Administration t={t} currentStaffId={principal.id} />
        : <Roster admin={admin} t={t} />}
    </div>
  </main>;
}

function Appearance({ theme, setTheme, t }: { theme: Theme; setTheme: (theme: Theme) => void; t: Translate }) {
  const [draft, setDraft] = useState(theme);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const selected = changed ? draft : theme;

  useEffect(() => {
    setSaved(false);
  }, [selected]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ theme: Theme }>("/admin/appearance", json("PUT", { theme: selected }));
      setTheme(result.theme);
      setChanged(false);
      setSaved(true);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="appearance-title">
    <h1 id="appearance-title">{t("Appearance", "المظهر")}</h1>
    <p className="subtle section-description">{t("Choose the theme for the entire competition site.", "اختر مظهر موقع المسابقة للجميع.")}</p>
    <form onSubmit={save}>
      <fieldset className="theme-options">
        <legend className="visually-hidden">{t("Site theme", "مظهر الموقع")}</legend>
        {(["classic", "christmas"] as const).map((value) => <label key={value} className="theme-option">
          <input type="radio" name="theme" value={value} checked={selected === value} disabled={busy} onChange={() => {
            setDraft(value);
            setChanged(true);
            setError(null);
          }} />
          <span className={`theme-preview preview-${value}`} aria-hidden="true"/>
          <span className="theme-label">{value === "classic" ? t("Classic", "كلاسيكي") : t("Christmas in Bethlehem", "عيد الميلاد في بيت لحم")}</span>
          <span className="theme-check"><Icon name="check" size={16}/></span>
        </label>)}
      </fieldset>
      <div className="save-row">
        <button className="button primary" disabled={busy || theme === selected}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Save theme", "حفظ المظهر")}</button>
        {saved && <span role="status">{t("Theme updated.", "تم تحديث المظهر.")}</span>}
      </div>
      {error ? <p className="notice error" role="alert">{errorText(error, t)}</p> : null}
    </form>
  </section>;
}
