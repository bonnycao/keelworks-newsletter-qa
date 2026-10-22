import express from 'express';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import ExcelJS from 'exceljs';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const app = express();
const port = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({limit:'20kb'}));
app.use(express.static(path.join(__dirname,'public')));
const jobs = new Map();
const clean = v => String(v ?? '').replace(/[\u0000-\u001f]/g,' ').slice(0,2000);
const add = (arr,category,defect,description,solution,severity='Medium',viewport='All',status='Detected') => arr.push({id:`QA-${String(arr.length+1).padStart(3,'0')}`,category,defect,description:clean(description),solution,severity,viewport,status});
function privateIp(ip){
 if(net.isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a>=224||a===100&&b>=64&&b<=127;}
 if(net.isIP(ip)===6){const v=ip.toLowerCase();return v==='::1'||v==='::'||v.startsWith('fc')||v.startsWith('fd')||v.startsWith('fe8')||v.startsWith('fe9')||v.startsWith('fea')||v.startsWith('feb')||v.startsWith('::ffff:');}
 return true;
}
async function validateUrl(raw){
 let url;try{url=new URL(raw);}catch{throw new Error('Enter a valid URL.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Only public HTTP(S) URLs are allowed.');
 if(url.port&&!['80','443'].includes(url.port))throw new Error('Custom ports are not supported.');
 if(url.hostname==='localhost'||url.hostname.endsWith('.local')||net.isIP(url.hostname))throw new Error('Use a public website hostname.');
 const ips=await dns.lookup(url.hostname,{all:true});if(!ips.length||ips.some(x=>privateIp(x.address)))throw new Error('The address must resolve to a public server.');
 return url.href;
}
const designSystem = JSON.parse(
  readFileSync(
    path.join(__dirname, 'design-system', 'design-system.json'),
    'utf8'
  )
);

const specs = {
  body: designSystem.typography['Body/Regular'],
  h1: designSystem.typography['Heading/H1'],
  h2: designSystem.typography['Heading/H2']
};

const colorSpecs = {
  donateButton: {
    background: designSystem.donateButton.background.light,
    text: designSystem.donateButton.textColor
  },
  footer: {
    background: designSystem.footer.background,
    text: designSystem.footer.textColor
  }
};

async function audit(url){
 const issues=[];const browser=await chromium.launch({headless:true});
 const summary={url,checkedAt:new Date().toISOString(),screens:[],checks:0,notes:['Typography rules are initial reference values and should be confirmed against the final Figma Design System.','Grammar, factual accuracy, content organization and intended image cropping require editorial or visual review.','Automated accessibility testing cannot certify full WCAG compliance.']};
 try{
  for(const vp of [{name:'Desktop',width:1440,height:900},{name:'Tablet',width:768,height:1024},{name:'Mobile',width:390,height:844}]){
   const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},deviceScaleFactor:1,ignoreHTTPSErrors:false});
   const page=await context.newPage();
   page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
   await page.route('**/*', async route=>{
    const u=route.request().url();
    try{const dest=await validateUrl(u);if(dest)await route.continue();}catch{await route.abort();}
   });
   try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(1200);}
   catch(e){add(issues,'Functionality','Page load failure',`${vp.name}: ${e.message}`,'Confirm the URL is accessible and the server responds correctly.','High',vp.name);await context.close();continue;}
   const data=await page.evaluate((rules)=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const metric=e=>{const s=getComputedStyle(e);return {fontSize:parseFloat(s.fontSize),lineHeight:parseFloat(s.lineHeight),fontFamily:s.fontFamily,tag:e.tagName.toLowerCase(),text:e.textContent.trim().slice(0,65)}};
    const imgs=[...document.images].filter(visible).map(e=>({src:e.currentSrc||e.src,alt:e.getAttribute('alt'),complete:e.complete,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,fit:getComputedStyle(e).objectFit}));
    const links=[...document.querySelectorAll('a[href]')].filter(visible).map(e=>({text:e.innerText.trim().slice(0,65),href:e.href}));
    const overflow=[...document.querySelectorAll('body *')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+3||r.left< -3}).slice(0,8).map(e=>({tag:e.tagName.toLowerCase(),className:String(e.className).slice(0,70)}));
    return {title:document.title,imgs,links,overflow,scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,typography:Object.fromEntries(Object.keys(rules).map(k=>[k,[...document.querySelectorAll(k==='body'?'p':k)].filter(visible).slice(0,15).map(metric)])),headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(e=>({level:Number(e.tagName[1]),text:e.textContent.trim().slice(0,65)}))};
   },specs);
   summary.screens.push({viewport:vp.name,width:vp.width,height:vp.height,title:data.title});
   summary.checks+=data.imgs.length+data.links.length+Object.values(data.typography).reduce((n,a)=>n+a.length,0);
   if(data.scrollWidth>vp.width+3)add(issues,'Layout','Horizontal page overflow',`${vp.name}: content width ${data.scrollWidth}px exceeds viewport ${vp.width}px.`,'Remove fixed-width overflow and test responsive containers.','High',vp.name);
   for(const o of data.overflow)add(issues,'Layout','Element extends outside viewport',`${vp.name}: <${o.tag}> ${o.className}`,'Inspect width, padding, positioning and responsive styles.','Medium',vp.name);
   for(const [tag,els] of Object.entries(data.typography))for(const e of els){const s=specs[tag];if(Math.abs(e.fontSize-s.fontSize)>1)add(issues,'Typography',`${tag.toUpperCase()} font size mismatch`,`${vp.name}: “${e.text}” uses ${e.fontSize}px; reference ${s.fontSize}px.`,'Apply the approved design-system typography token.','Medium',vp.name);
    if(Number.isFinite(e.lineHeight)&&Math.abs(e.lineHeight-s.lineHeight)>2)add(issues,'Typography',`${tag.toUpperCase()} line-height mismatch`,`${vp.name}: “${e.text}” uses ${e.lineHeight}px; reference ${s.lineHeight}px.`,'Apply the approved design-system line-height token.','Medium',vp.name);
   }
   for(const img of data.imgs){if(!img.complete||!img.naturalWidth)add(issues,'Images','Broken image',`${vp.name}: ${img.src}`,'Correct image URL or restore the asset.','High',vp.name);
    if(img.alt===null)add(issues,'Accessibility','Missing image alt attribute',`${vp.name}: ${img.src}`,'Provide meaningful alt text or alt="" for decorative images.','Medium',vp.name);
    if(img.naturalWidth&&img.naturalHeight&&img.width&&img.height){const natural=img.naturalWidth/img.naturalHeight,rendered=img.width/img.height;if(Math.abs(natural-rendered)/natural>0.08&&img.fit==='fill')add(issues,'Images','Potential image stretching',`${vp.name}: ${img.src} natural ratio ${natural.toFixed(2)}, displayed ratio ${rendered.toFixed(2)}.`,'Use height:auto to preserve intrinsic ratio, or object-fit:cover with intentional cropping.','High',vp.name);}
   }
   for(const link of data.links)if(link.href.startsWith('javascript:')||link.href==='#'||link.href.endsWith('/#'))add(issues,'Functionality','Placeholder link',`${vp.name}: “${link.text}” points to ${link.href}.`,'Replace with a valid destination or remove the nonfunctional link.','Medium',vp.name);
   let previous=0;for(const h of data.headings){if(previous&&h.level>previous+1)add(issues,'Accessibility','Skipped heading level',`${vp.name}: heading “${h.text}” jumps from H${previous} to H${h.level}.`,'Use logical heading hierarchy.','Medium',vp.name);previous=h.level;}
   if(vp.name==='Desktop'){
    try{const axe=await new AxeBuilder({page}).analyze();for(const v of axe.violations)for(const n of v.nodes.slice(0,12))add(issues,'Accessibility',v.help,`${v.id}: ${n.target.join(', ')}. ${v.description}`,v.helpUrl,v.impact==='critical'||v.impact==='serious'?'High':'Medium',vp.name);}catch(e){summary.notes.push('Accessibility scan did not complete: '+e.message);}
   }
   await context.close();
  }
 }finally{await browser.close();}
 const unique=new Map();for(const x of issues){const key=[x.category,x.defect,x.description,x.viewport].join('|');if(!unique.has(key))unique.set(key,x);}
 summary.issues=[...unique.values()].map((x,i)=>({...x,id:`QA-${String(i+1).padStart(3,'0')}`}));summary.count=summary.issues.length;return summary;
}
app.post('/api/audit',async(req,res)=>{
 try{const url=await validateUrl(req.body?.url);const result=await audit(url);const id=crypto.randomUUID();jobs.set(id,result);if(jobs.size>25)jobs.delete(jobs.keys().next().value);res.json({id,...result});}
 catch(e){res.status(400).json({error:clean(e.message)});}
});
app.get('/api/export/:id',async(req,res)=>{
 const result=jobs.get(req.params.id);if(!result)return res.status(404).send('Run a QA scan first.');
 const wb=new ExcelJS.Workbook();wb.creator='KeelWorks Newsletter QA';const ws=wb.addWorksheet('QA Defects',{views:[{state:'frozen',ySplit:1}]});
 ws.columns=[{header:'Defect ID',key:'id',width:13},{header:'Category',key:'category',width:21},{header:'Defect',key:'defect',width:36},{header:'Defect Description',key:'description',width:75},{header:'Change Solution',key:'solution',width:76},{header:'Severity',key:'severity',width:13},{header:'Viewport',key:'viewport',width:13},{header:'Status',key:'status',width:17}];
 ws.addRows(result.issues);ws.autoFilter={from:'A1',to:'H1'};ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF263C63'}};ws.getRow(1).height=28;
 ws.eachRow((row,i)=>{if(i>1){row.alignment={vertical:'top',wrapText:true};row.height=44;if(i%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F5F9'}};}});
 const info=wb.addWorksheet('Scan Summary');info.addRows([['KeelWorks Newsletter QA Scan'],['URL',result.url],['Checked at',result.checkedAt],['Total findings',result.count],['Note','Automated results require human review.'],...result.notes.map(n=>['Limitation',n])]);info.getColumn(1).width=22;info.getColumn(2).width=110;info.getColumn(2).alignment={wrapText:true};
 res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="KeelWorks_Newsletter_QA.xlsx"');await wb.xlsx.write(res);res.end();
});
app.listen(port,()=>console.log(`KeelWorks QA ready at http://localhost:${port}`));
