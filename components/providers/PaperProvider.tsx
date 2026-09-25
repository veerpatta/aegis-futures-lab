"use client";
import {createContext,useContext,useState,useEffect,useCallback,useRef} from "react";
import {getNeon} from "@/lib/neon/client";
import type {BotOverview,Candidate,Activity} from "@/lib/paper/overview";
type State={data:BotOverview|null;candidates:Candidate[];activity:Activity[];errors:string[];loadedAt:string|null;loading:boolean;refresh:()=>void};
const Context=createContext<State>({data:null,candidates:[],activity:[],errors:[],loadedAt:null,loading:true,refresh:()=>{}});
export function PaperProvider({children}:{children:React.ReactNode}) {
 const [data,setData]=useState<BotOverview|null>(null),[candidates,setCandidates]=useState<Candidate[]>([]),[activity,setActivity]=useState<Activity[]>([]);
 const [errors,setErrors]=useState<string[]>([]),[loadedAt,setLoadedAt]=useState<string|null>(null),[loading,setLoading]=useState(true);
 const busy=useRef(false),mounted=useRef(true);
 const refresh=useCallback(async()=>{if(busy.current)return;busy.current=true;
  try {const db=getNeon();const results=await Promise.allSettled([db.from("bot_overview").select("*").limit(1),db.from("candidate_progress").select("*"),db.from("bot_activity").select("*").order("at",{ascending:false}).limit(20)]);
   if(!mounted.current)return;const failed:string[]=[];
   results.forEach((r,i)=>{const label=["Account","Research","Activity"][i];if(r.status==="rejected"||r.value.error){failed.push(label);return;}
    if(i===0){const row=r.value.data?.[0];if(!row){failed.push(label);return;}setData(row as BotOverview);setLoadedAt(new Date().toISOString());}
    if(i===1)setCandidates((r.value.data??[]) as Candidate[]);if(i===2)setActivity((r.value.data??[]) as Activity[]);
   });setErrors(failed);
  }catch{if(mounted.current)setErrors(["Account","Research","Activity"]);}finally{busy.current=false;if(mounted.current)setLoading(false);}
 },[]);
 useEffect(()=>{mounted.current=true;void refresh();const timer=setInterval(()=>void refresh(),60000);return()=>{mounted.current=false;clearInterval(timer);};},[refresh]);
 return <Context.Provider value={{data,candidates,activity,errors,loadedAt,loading,refresh}}>{children}</Context.Provider>;
}
export const usePaper=()=>useContext(Context);
