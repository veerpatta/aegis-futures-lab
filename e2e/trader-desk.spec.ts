import {test,expect} from "@playwright/test";
for(const width of [360,390,430,1440])for(const mode of ["research","probation","active","paused","locked","error"]){
 test(`${width}px ${mode} account is clear and usable`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route("**/api/events",r=>r.fulfill({json:{events:[],verified:true}}));
  await page.route("**/api/market?*",r=>r.fulfill({json:{price:5000,dataTimestamp:new Date().toISOString(),bars:[]}}));
  const now=new Date().toISOString();
  await page.route("https://*.neon.tech/**/rest/v1/**",r=>{
   const url=r.request().url();if(url.includes("bot_overview")){
    if(mode==="error")return r.fulfill({status:503,json:{message:"fixture unavailable"}});
    return r.fulfill({json:[{account:{equity:10000,peak:10000,open_risk:0,daily_pnl:0,day_key:"2026-09-25",locked:mode==="locked",updated_at:now},release:["active","probation","paused"].includes(mode)?{candidate_key:"2026-09-25.2:opening-continuation-v1:MES",status:mode,reason:"Waiting for fresh evidence",activated_at:now}:null,positions:[],learning:{status:"ok",finished_at:now,started_at:now},model:null}]});
   }return r.fulfill({json:[]});
  });
  await page.goto("/");
  const status=page.getByRole("region",{name:"Bot status"});
  await expect(status).toContainText(mode==="error"?"Status unavailable":mode==="locked"||mode==="paused"?"Paused":mode==="probation"?"Paper probation":mode==="active"?"Paper active":"Researching");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("button",{name:"How it works"}).click();await expect(page.getByRole("dialog")).toBeVisible();await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
  if(mode!=="error"){await page.getByRole("button",{name:"Hide money figures"}).click();await expect(page.getByText("$10,000.00",{exact:true})).toHaveCount(0);}
  await page.goto("/more");await expect(page.getByRole("link",{name:/Guide/}).last()).toBeVisible();
 });
}
