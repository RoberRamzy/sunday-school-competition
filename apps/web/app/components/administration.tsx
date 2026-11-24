"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, json, errorText, type Grade, type Translate } from "../api";
import { DeleteConfirmation } from "./delete-confirmation";

type Servant = {id: string; fullName: string; username: string; status: "ACTIVE" | "SUSPENDED"; gradeIds: string[]};

type Staff = Omit<Servant, "gradeIds"> & {role: "SUPER_ADMIN" | "SERVANT"};

export function Administration({ t, currentStaffId }: { t: Translate; currentStaffId: string }) {
  const [accounts, setAccounts] = useState<Staff[]>([]);
  const [deleting, setDeleting] = useState<Staff | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [staff, setStaff] = useState<Servant[]>([]);
  const [gradeId, setGradeId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [gradeRows, staffRows, allStaff] = await Promise.all([api<Grade[]>("/admin/grades"), api<Servant[]>("/admin/servants"), api<Staff[]>("/admin/staff")]);
    setGrades(gradeRows);
    setStaff(staffRows);
    setAccounts(allStaff);
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
    <section className="panel form-stack" aria-labelledby="staff-accounts">
      <h2 id="staff-accounts">{t("Staff accounts", "حسابات الخدام والمديرين")}</h2>
      {deleted && <p className="notice success" role="status">{t("Staff account deleted.", "تم حذف الحساب.")}</p>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t("Staff accounts", "حسابات الخدام والمديرين")}>
        <table className="roster-table data-table"><thead><tr>
          <th scope="col">{t("Name", "الاسم")}</th><th scope="col">{t("Role", "الدور")}</th><th scope="col">{t("Actions", "الإجراءات")}</th>
        </tr></thead><tbody>{accounts.map(account => <tr key={account.id}>
          <td><bdi>{account.fullName} ({account.username})</bdi></td>
          <td>{account.role === "SUPER_ADMIN" ? t("Super admin", "مدير النظام") : t("Servant", "خادم")}</td>
          <td>{account.id === currentStaffId ? t("Current account", "الحساب الحالي") :
            <button type="button" className="link-button danger-text" disabled={busy} onClick={() => { setDeleted(false); setDeleting(account); }}>{t("Delete staff account", "حذف الحساب")}</button>}</td>
        </tr>)}</tbody></table>
      </div>
    </section>
    {deleting && <DeleteConfirmation title={t("Delete staff account", "حذف الحساب")} name={deleting.username}
      consequence={t("This permanently removes the staff account, revokes its sessions, and removes its grade assignments.", "سيُحذف الحساب نهائيًا، وتُلغى جلساته والصفوف المسندة إليه.")}
      path={`/admin/staff/${deleting.id}`} t={t} onCancel={() => setDeleting(null)} onDeleted={() => {
        setDeleting(null);
        setAccounts(rows => rows.filter(row => row.id !== deleting.id));
        setStaff(rows => rows.filter(row => row.id !== deleting.id));
        if (staffId === deleting.id) setStaffId("");
        setDeleted(true);

      }}/>}
  </section>;
}
