import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from '/tmp/cs-youtube-investigation/node_modules/playwright/index.mjs';
const script = readFileSync(new URL('./partner-page.js', import.meta.url), 'utf8');
const jquery = readFileSync('/tmp/revvi-partner-jquery.js','utf8');
const browser = await chromium.launch({executablePath:'/home/crooner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
const origin='https://thes-fantabulous-site-e67dcc.webflow.io';
const booking='/book?businessSlug=lastspot-sandbox&locationId=df893f87-6ca7-4417-88e9-25067b42ee37&offerId=0b3e181e-a718-4098-aa58-9275763f4419';
let passed=0;
async function scenario({flow='revvi-booking',link=booking,status='ACTIVE',active,debug='',locations=false,reject=false,plan='pln_test-plan-0tv40j5v',direct=false},check){
 const page=await browser.newPage();
 try{
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<main data-partner-page data-booking-flow="${flow}" data-booking-link="${link}">
 <i data-tier-id="member-test-plan"></i><div id="offer-accordion"></div><div data-partner-state="correct-tier">Allowed</div><div data-partner-state="wrong-tier">Wrong</div><div class="cta-non-member">Login</div><div data-partner-access-error hidden>Membership could not be checked.</div>
 ${direct?'<a data-partner-booking-link><span class="btn-text"></span></a>':'<div data-partner-booking-link><a><span class="btn-text"></span></a></div>'}
 <span data-selected-location></span>${locations?`<div class="dropdown-location"><div class="location-dropdown-content"><div class="location-dropdown-name" data-location-city="__proto__" data-location-name="Clubville" data-location-booking-link="${booking}" data-location-link="https://affiliate.example/clubville">Clubville</div></div><div class="location-dropdown-content"><div class="location-dropdown-name" data-location-city="Other" data-location-name="Missing">Missing</div></div></div>`:''}</main>`}));
 await page.goto(origin+'/partners/test'+debug);
 await page.addScriptTag({content:jquery});
 await page.evaluate(({status,active,plan,reject})=>{window.$memberstackDom={getCurrentMember:()=>reject?Promise.reject(Error('network')):Promise.resolve({data:{planConnections:[{planId:plan,status,...(active===undefined?{}:{active})}]}})}},{status,active,plan,reject});
 await page.addScriptTag({content:script});await page.waitForTimeout(80);
 await check(page);passed++;
 }finally{await page.close();}
}
try{
 const href=p=>p.locator('[data-partner-booking-link]').evaluate(e=>(e.matches('a')?e:e.querySelector('a')).getAttribute('href'));
 await scenario({},async p=>assert.equal(await href(p),origin+booking));
 await scenario({direct:true},async p=>assert.equal(await href(p),origin+booking));
 await scenario({flow:'affiliate',link:'https://affiliate.example/book'},async p=>assert.equal(await href(p),'https://affiliate.example/book'));
 await scenario({status:'CANCELED'},async p=>assert.equal(await href(p),null));
 await scenario({active:false},async p=>assert.equal(await href(p),null));
 await scenario({plan:'pln_testing-free-plan-v65y0e68'},async p=>assert.equal(await href(p),null));
 await scenario({debug:'?debug=true&tier=member-test-plan'},async p=>assert.equal(await href(p),null));
 await scenario({link:'https://affiliate.example/book'},async p=>assert.equal(await href(p),null));
 await scenario({locations:true},async p=>{assert.equal(await href(p),null);assert.equal(await p.locator('.location-dropdown-name').count(),2);await p.getByRole('button',{name:'Clubville'}).click();assert.equal(await href(p),origin+booking);await p.getByRole('button',{name:'Missing'}).click();assert.equal(await href(p),null);});
 await scenario({flow:'affiliate',locations:true},async p=>{await p.getByRole('button',{name:'Clubville'}).click();assert.equal(await href(p),'https://affiliate.example/clubville');});
 await scenario({reject:true},async p=>{assert.equal(await href(p),null);assert.equal(await p.locator('[data-partner-access-error]').isVisible(),true);});
 console.log(`PASS: ${passed} partner-page browser scenarios`);
}finally{await browser.close();}
