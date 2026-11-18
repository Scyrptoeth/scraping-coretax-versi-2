import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createXlsx } from "../extension/archive/table.js";
import { decodeText, readZip } from "../extension/archive/zip.js";

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root=new URL("../extension/",import.meta.url);
const server=createServer(async (req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/"){
    res.setHeader("content-type","text/html");
    res.end('<!doctype html><html lang="id"><head><meta charset="utf-8"><link rel="stylesheet" href="/analisis/viewer.css"></head><body><div id="status"></div><main id="screen"></main></body></html>');
    return;
  }
  try{
    const file=new URL("."+url.pathname,root);
    if(!file.href.startsWith(root.href))throw Error();
    res.setHeader("content-type",file.pathname.endsWith(".css")?"text/css":"text/javascript");
    res.end(await readFile(fileURLToPath(file)));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined});
  const page=await browser.newPage({acceptDownloads:true});
  await page.goto("http://127.0.0.1:"+server.address().port);
  await page.evaluate(async()=>{
    const {renderWork}=await import("/analisis/work.js");
    const state={role:"AR",year:"2025",section:"ba",work:new Map(),
      pkg:{manifest:{wp:{npwp:"0000000000000099",nama:"Contoh uji"}},forms:[],entries:[],years:["2025"],report:{manifestHash:"synthetic-test",valid:true}}};
    state.repaint=()=>{const target=document.getElementById("screen");target.replaceChildren();renderWork(target,state);};
    window.testState=state;state.repaint();
  });
  await page.getByRole("button",{name:"SP2DK baru"}).click();
  await page.getByLabel("Nomor",{exact:true}).fill("S-123");
  await page.getByRole("button",{name:"Tambah baris"}).click();
  await page.getByLabel("Uraian data").fill("Transaksi contoh");
  await page.getByLabel("Nilai penelitian").fill("0");
  await page.getByRole("button",{name:"BAP2DK",exact:true}).click();
  await page.getByLabel("Buat dari SP2DK").selectOption({label:"S-123"});
  assert.equal(await page.getByLabel("Uraian data").inputValue(),"Transaksi contoh");
  assert.equal(await page.getByLabel("Menurut WP",{exact:true}).inputValue(),"");
  assert.equal(await page.getByLabel("Nilai penelitian").inputValue(),"0");
  await page.evaluate(()=>{window.testState.role="Pemeriksa";window.testState.repaint();});
  await page.getByRole("button",{name:"BAPK baru"}).click();
  await page.getByRole("button",{name:"Usulkan pertanyaan dari data"}).click();
  await page.getByLabel("Cetak pertanyaan ini").check();
  await page.getByLabel("Catatan internal").fill("Kendali internal sintetis");
  const id=await page.evaluate(()=>[...window.testState.work.values()][0].drafts.find(d=>d.type==="BAPK").questions[0].id);
  const workbook=await createXlsx({sheets:[{name:"Kendali pertanyaan",rows:[["ID","Jawaban"],[id,"Jawaban dari Excel"]]}]});
  await page.getByLabel("Impor jawaban dari Excel").setInputFiles({name:"kendali.xlsx",mimeType:workbook.type,buffer:Buffer.from(await workbook.arrayBuffer())});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("1 jawaban terbaca"));
  assert.equal(await page.getByLabel("Jawaban",{exact:true}).inputValue(),"Jawaban dari Excel");
  const [file]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Unduh Word",exact:true}).click()]);
  const doc=await readZip(await readFile(await file.path()));
  const text=decodeText(doc.get("word/document.xml").data);
  assert.match(text,/Jawaban dari Excel/);
  assert.doesNotMatch(text,/Kendali internal sintetis/);
  console.log("AR SP2DK → BAP2DK, Pemeriksa BAPK, XLSX import and native Word download passed in Chromium.");
}finally{await browser?.close();server.close();}
