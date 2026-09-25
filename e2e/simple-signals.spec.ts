import {test,expect} from "@playwright/test";
for(const width of [360,390,430,1440])test(`${width}px Home and Signals keep prices clear`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const now=new Date().toISOString();
 const signal={id:1,tier:"A",symbol:"MES",direction:"long",entry_price:5000,stop_price:4995,target_price:5010,rr:2,signal_ts:now,status:"triggered",pnl_usd:null,exit_ts:null};
 await page.route("**/api/events",r=>r.fulfill({json:{events:[],verified:true}}));
 await page.route("**/api/market?*",r=>r.fulfill({json:{price:5000,dataTimestamp:now,bars:[]}}));
 await page.route("https://*.neon.tech/**/rest/v1/**",r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith("/signals")?[signal,{...signal,id:2,status:"hit_target",exit_ts:now,pnl_usd:47.6},{...signal,id:3,suppressed:true}]:[]}));
 await page.goto("/");
 const numbers=page.getByRole("region",{name:"Today's signals"});
 await expect(numbers).toContainText("1 closed");await expect(numbers).toContainText("47.60");
 const cards=page.getByRole("region",{name:"Signals at a glance"});
 await expect(cards.getByRole("button")).toHaveCount(2);
 const entry=cards.getByText("5000.00").first();await expect(entry).toBeVisible();expect((await entry.boundingBox())!.y).toBeLessThan(750);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await cards.getByRole("button").first().click();await expect(page.getByRole("dialog")).toBeVisible();await page.keyboard.press("Escape");
 await page.goto("/signals");await expect(page.getByRole("button",{name:"Open · 1",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"History",exact:true}).click();await expect(page.getByRole("region",{name:"Signals at a glance"})).toContainText("47.60");
 await expect(page.getByText("More details",{exact:true})).toBeVisible();expect(await page.locator("details").first().getAttribute("open")).toBeNull();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width<768){const nav=page.getByRole("navigation",{name:/primary/i});await expect(nav).toContainText("Signals");await expect(nav).toContainText("Bot");}
});
