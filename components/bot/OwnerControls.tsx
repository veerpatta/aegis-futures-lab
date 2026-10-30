"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getNeon } from "@/lib/neon/client";
import { changeOwnerPassword } from "@/lib/neon/change-password";
import styles from "./ai-research.module.css";

type Command = { id:string; action:string; reason:string; status:string; result:string|null; created_at:string };
type ControlState = { commands:Command[]; campaign:{id:string;status:string}|null };

export default function OwnerControls() {
  const [state,setState]=useState<ControlState|null>(null), [message,setMessage]=useState("Sign in above to use owner controls."), [reason,setReason]=useState(""), [busy,setBusy]=useState(false);
  const [currentPassword,setCurrentPassword]=useState(""), [newPassword,setNewPassword]=useState("");
  const refreshVersion=useRef(0);
  const token = async () => { const {data,error}=await getNeon().auth.getSession(); if(error || !data.session?.access_token) throw new Error("Sign in to use owner controls."); return data.session.access_token; };
  const refresh = useCallback(async () => {
    const version=++refreshVersion.current;
    try {
      const res=await fetch("/api/controls",{headers:{Authorization:`Bearer ${await token()}`},cache:"no-store"});
      if(!res.ok) throw new Error("Owner controls unavailable. Sign in as the owner.");
      const data=await res.json() as ControlState; if(version===refreshVersion.current) { setState(data); setMessage(""); }
    } catch(err) { if(version===refreshVersion.current) { setState(null); setMessage(err instanceof Error ? err.message : "Controls unavailable."); } }
  },[]);
  useEffect(()=>{ void refresh(); const {data:{subscription}}=getNeon().auth.onAuthStateChange(()=>{ setState(null); setReason(""); setCurrentPassword(""); setNewPassword(""); void refresh(); }); return ()=>{ refreshVersion.current++; subscription.unsubscribe(); }; },[refresh]);
  const send = async (action:string) => {
    if (!state || reason.trim().length<8) { setMessage("Give a reason of at least 8 characters."); return; }
    setBusy(true); setMessage("");
    try {
      const res=await fetch("/api/controls",{method:"POST",headers:{Authorization:`Bearer ${await token()}`,"Content-Type":"application/json"},body:JSON.stringify({action,reason,expectedId:state.campaign?.id ?? null})});
      if(!res.ok) throw new Error("Command could not be recorded. Refresh and check for a pending command.");
      setReason(""); await refresh(); setMessage("Command recorded. It will be checked by the next learner tick; refresh to see its result.");
    } catch(err) { setMessage(err instanceof Error ? err.message : "Command unavailable."); } finally { setBusy(false); }
  };
  const changePassword = async (event:FormEvent) => {
    event.preventDefault(); if(newPassword.length<12) { setMessage("Use at least 12 characters for your new password."); return; }
    setBusy(true); setMessage("");
    try {
      await changeOwnerPassword(currentPassword,newPassword);
      setCurrentPassword(""); setNewPassword(""); setMessage("Password changed. Other sessions were signed out.");
    } catch { setMessage("Password could not be changed. Check your current password and try again."); } finally { setBusy(false); }
  };
  return <section className={`${styles.research} ${styles.form}`} aria-label="Owner controls">
    <h3>Owner controls</h3><p>Virtual learner only. Pause stops new entries while open trades continue to be managed. Stop waits until open and pending trades are settled. Starting a new campaign keeps earlier results.</p>
    {state && <><p>Campaign: {state.campaign ? `${state.campaign.id} · ${state.campaign.status}` : "none registered"}</p>
      <label htmlFor="owner-reason">Reason</label><textarea id="owner-reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} />
      <div className={styles.actions}>{(["pause","resume","stop","start"] as const).map(action=><button type="button" key={action} disabled={busy || state.commands.some(c=>c.status==="pending")} onClick={()=>void send(action)}>{action[0].toUpperCase()+action.slice(1)}</button>)}</div>
      <button type="button" onClick={()=>void refresh()}>Refresh status</button>
      <ul>{state.commands.map(c=><li key={c.id}>{c.action} · {c.status} · {c.reason}{c.result ? ` · ${c.result}` : ""}</li>)}</ul>
      <form className={styles.form} onSubmit={e=>void changePassword(e)}><h4>Change password</h4><label htmlFor="old-password">Current password</label><input id="old-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} /><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} /><button disabled={busy}>Change password</button></form>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
