import { chromium } from '@playwright/test';
const base = process.env.AEGIS_UI_BASE || 'http://127.0.0.1:3101';
const browser=await chromium.launch({headless:true});
for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const route of ['/','/brain','/guide']){
  await page.goto(base+route,{waitUntil:'networkidle'});
  if(route!='/guide')await page.getByRole('heading',{name:'No strategy qualifies for paper activation yet'}).waitFor({timeout:30000});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow)throw new Error('Horizontal overflow '+width+' '+route);
  const alerts=await page.getByRole('alert').allTextContents();
  console.log(JSON.stringify({width,route,alerts,errors}));
  if(alerts.some(a=>a.includes('could not be loaded'))||errors.length)throw new Error('Browser runtime or database read error');
  if(route==='/'){await page.getByText('Training, recovery and risk limits',{exact:true}).click();await page.screenshot({path:`test-results/practice-desk-${width}.png`,fullPage:false});}
 }
 await context.close();
}
await browser.close();
