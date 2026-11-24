"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, json, errorText, type Grade, type Translate } from "../api";

type Servant = {id: string; fullName: string; username: string; status: "ACTIVE" | "SUSPENDED"; gradeIds: string[]};

export function Administration({ t }: { t: Translate }) {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [staff, setStaff] = useState<Servant[]>([]);
  const [gradeId, setGradeId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [gradeRows, staffRows] = await Promise.all([api<Grade[]>("/admin/grades"), api<Servant[]>("/admin/servants")]);
    setGrades(gradeRows);
    setStaff(staffRows);
  }
  useEffect(() => {refresh().catch(setError);}, []);
  const grade = grades.find(row => row.id === gradeId);
  const servant = staff.find(row => row.id === staffId);
  async function save(event: FormEvent<HTMLFormElement>, section: "grades" | "servants") {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const id = section === "grades" ? gradeId : staffId;
    const data = section === "grades" ? {name: values.get("name")} : {
      fullName: values.get("fullName"), username: values.get("username"),
      gradeIds: values.getAll("gradeIds"),
      ...(values.get("password") ? {password: values.get("password")} : {}),
      ...(id ? {status: values.get("status")} : {})
    };
    setError(undefined);
    setNotice(false);
    setBusy(true);
    try {
      await api("/admin/" + section + (id ? "/" + id : ""), json(id ? "PATCH" : "POST", data));
      await refresh();
      form.reset();
      if (section === "grades") setGradeId(""); else setStaffId("");
      setNotice(true);
    } catch (err) {setError(err);} finally {setBusy(false);}
  }
  return <section>
    <h1>{t("Staff and grades","الخدام والصفوف")}</h1>
    {error ? <p role="alert" className="notice error">{errorText(error,t)}</p> : null}
    {notice && <p role="status">{t("Changes saved.","تم حفظ التغييرات.")}</p>}
    <h2>{t("Grades","الصفوف")}</h2>
    <form className="form-stack" onSubmit={e=>save(e,"grades")}>
      <label>{t("Grade to manage","الصف المطلوب تعديله")}<select value={gradeId} onChange={e=>setGradeId(e.target.value)}><option value="">{t("New grade","صف جديد")}</option>{grades.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label>{t("Grade name","اسم الصف")}<input key={gradeId} name="name" required defaultValue={grade?.name} /></label>
      <button disabled={busy} className="button primary">{t("Save grade","حفظ الصف")}</button>
    </form>
    <h2>{t("Servants","الخدام")}</h2>
    <label>{t("Servant to manage","الخادم المطلوب تعديله")}<select value={staffId} onChange={e=>setStaffId(e.target.value)}><option value="">{t("New servant","خادم جديد")}</option>{staff.map(s=><option key={s.id} value={s.id}>{s.fullName} ({s.username})</option>)}</select></label>
    <form key={staffId} className="form-stack" onSubmit={e=>save(e,"servants")}>
      <label>{t("Full name","الاسم بالكامل")}<input name="fullName" required defaultValue={servant?.fullName}/></label>
      <label>{t("Username","اسم المستخدم")}<input name="username" required defaultValue={servant?.username} dir="ltr" autoComplete="off"/></label>
      <label>{staffId ? t("New password (optional)","كلمة مرور جديدة (اختياري)") : t("Password","كلمة المرور")}<input type="password" name="password" minLength={12} required={!staffId} autoComplete="new-password" /></label>
      <fieldset><legend>{t("Assigned grades","الصفوف المسندة")}</legend>{grades.map(g=><label key={g.id} style={{display:"flex",alignItems:"center",gap:8}}><input style={{width:"auto"}} type="checkbox" name="gradeIds" value={g.id} defaultChecked={servant?.gradeIds.includes(g.id)}/>{g.name}</label>)}</fieldset>
      {servant && <label>{t("Account status","حالة الحساب")}<select name="status" defaultValue={servant.status}><option value="ACTIVE">{t("Active","نشط")}</option><option value="SUSPENDED">{t("Suspended","موقوف")}</option></select></label>}
      <button disabled={busy} className="button primary">{t("Save servant","حفظ الخادم")}</button>
    </form>
  </section>;
}
