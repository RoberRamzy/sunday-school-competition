"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api, DEFAULT_GROUP_ID, errorText, groupHome, json, type CompetitionGroup, type Language, type Principal, type Theme, type Translate } from "../api";
import { Icon } from "./ui-icon";
import { Roster } from "./roster";
import { Administration } from "./administration";
import { StaffCompetitions } from "./staff-competitions";
import { AdminOverallLeaderboard } from "./leaderboard";

type Section = "roster" | "appearance" | "administration" | "competitions" | "standings" | "groups";

export function Staff({ principal, groupId, theme, setTheme, language }: {
  principal: Principal; groupId: string; theme: Theme; setTheme: (theme: Theme) => void; language: Language;
}) {
  const [section, setSection] = useState<Section>("roster");
  const admin = principal.role === "SUPER_ADMIN";
  const [groups, setGroups] = useState<CompetitionGroup[]>([]);
  const [groupsError, setGroupsError] = useState<unknown>(null);

  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    api<CompetitionGroup[]>("/admin/groups", { signal: controller.signal }).then(setGroups).catch(error => {
      if (!controller.signal.aborted) setGroupsError(error);
    });
    return () => controller.abort();
  }, [admin]);
  const t: Translate = (en, ar) => language === "ar" ? ar : en;
  return <main id="main-content" className="workspace">
    <aside className="workspace-sidebar">
      <div className="workspace-identity">
        <span className="staff-season-accent"><Icon name="star" size={15}/></span>
        <span className="identity-icon"><Icon name="users" size={22}/></span>
        <div><bdi>{principal.displayName}</bdi><small>{admin ? t("Super admin", "مدير النظام") : t("Servant", "خادم")}</small></div>
      </div>
      {admin && groups.length > 0 && <label className="workspace-group">
        {t("Current group", "المجموعة الحالية")}
        <select value={groupId} onChange={event => window.location.assign(event.target.value === DEFAULT_GROUP_ID ? "/staff" : `/staff?group=${event.target.value}`)}>
          {!groups.some(group => group.id === groupId) && <option value={groupId}>{t("Group unavailable", "المجموعة غير متاحة")}</option>}
          {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </label>}
      <nav aria-label={t("Staff workspace", "لوحة الخدام")}>
        <button type="button" aria-current={section === "roster" ? "page" : undefined} onClick={() => setSection("roster")}><Icon name="users" size={19}/>{t("Student roster", "قائمة الطلاب")}</button>
        <button type="button" aria-current={section === "competitions" ? "page" : undefined} onClick={() => setSection("competitions")}><Icon name="calendar" size={19}/>{t("Competitions", "المسابقات")}</button>
        <button type="button" aria-current={section === "standings" ? "page" : undefined} onClick={() => setSection("standings")}><Icon name="star" size={19}/>{t("Overall leaderboard", "لوحة الترتيب العامة")}</button>
        {admin && <button type="button" aria-current={section === "administration" ? "page" : undefined} onClick={() => setSection("administration")}><Icon name="users" size={19}/>{t("Staff and grades", "الخدام والصفوف")}</button>}
        {admin && <button type="button" aria-current={section === "groups" ? "page" : undefined} onClick={() => setSection("groups")}><Icon name="users" size={19}/>{t("Competition groups", "مجموعات المسابقة")}</button>}
        {admin && <button type="button" aria-current={section === "appearance" ? "page" : undefined} onClick={() => setSection("appearance")}><Icon name="palette" size={19}/>{t("Appearance", "المظهر")}</button>}
      </nav>
    </aside>
    <div className="workspace-main">
      {section === "competitions" ? <StaffCompetitions admin={admin} language={language} t={t} />
        : section === "standings" ? <AdminOverallLeaderboard t={t} groupId={groupId}/>
        : admin && section === "groups" ? <GroupSetup groupId={groupId} t={t} loadError={groupsError}/>
        : admin && section === "appearance" ? <Appearance theme={theme} setTheme={setTheme} t={t} />
        : admin && section === "administration" ? <Administration t={t} language={language} currentStaffId={principal.id} />
        : <Roster t={t} />}
    </div>
  </main>;
}

function GroupSetup({ groupId, t, loadError }: { groupId: string; t: Translate; loadError: unknown }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const home = groupHome(groupId);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    setBusy(true);
    setError(null);
    try {
      const group = await api<CompetitionGroup>("/admin/groups", json("POST", { name }));
      window.location.assign(`/staff?group=${group.id}`);
    } catch (error) {
      setError(error);
      setBusy(false);
    }
  }

  return <section className="form-stack" aria-labelledby="competition-groups-heading">
    <h1 id="competition-groups-heading">{t("Competition groups", "مجموعات المسابقة")}</h1>
    <div className="panel form-stack">
      <h2>{t("Student sign-in link", "رابط دخول الطلاب")}</h2>
      <p>{t("Share this link with students in the current group. Set up its grades and staff under Staff and grades.", "شارك الرابط مع طلاب المجموعة الحالية. أضف صفوفها وخدامها من قسم الخدام والصفوف.")}</p>
      <div className="record-actions">
        <Link className="button" href={home} prefetch={false} target="_blank">{t("Open student link", "فتح رابط الطلاب")}</Link>
        <button className="button" type="button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(new URL(home, window.location.origin).href);
            setCopied(true);
          } catch (error) { setError(error); }
        }}>{t("Copy student link", "نسخ رابط الطلاب")}</button>
        {copied && <span role="status">{t("Link copied.", "تم نسخ الرابط.")}</span>}
      </div>
    </div>
    <form className="panel form-stack" onSubmit={create}>
      <h2>{t("Create a group", "إنشاء مجموعة")}</h2>
      <label>{t("Group name", "اسم المجموعة")}<input name="name" dir="auto" required maxLength={150} disabled={busy}/></label>
      <div><button className="button primary" disabled={busy}>{t("Create group", "إنشاء المجموعة")}</button></div>
    </form>
    {Boolean(error || loadError) && <p role="alert" className="notice error">{errorText(error || loadError, t)}</p>}
  </section>;
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
