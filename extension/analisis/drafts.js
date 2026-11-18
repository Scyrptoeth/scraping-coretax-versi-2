import { createDocx } from "../archive/document.js";
import { readXlsx } from "../archive/read-table.js";
import { box, button, card, download, el, exportSheets, field, notice, select, toggleSet } from "./ui.js";
import { allowedDrafts, blankFinding, draftFindings, draftOutput, draftSheets, draftTitles, importAnswers, newDraft, suggestQuestions, visibleFindings } from "./draft-model.js";

export function printOutput(spec) {
  const win = window.open("", "_blank", "popup,width=980,height=720");
  if (!win) { notice("Izinkan jendela cetak untuk membuat PDF.", true); return; }
  win.opener = null;
  win.document.documentElement.lang = "id";
  win.document.title = spec.title;
  win.document.body.append(buildPreview(spec));
  win.addEventListener("afterprint", () => win.close(), {once:true});
  win.focus();
  win.print();
}
function buildPreview(spec) {
  const node = el("article",null,"card");
  node.append(el("h2",spec.title));
  for (const p of spec.paragraphs) node.append(el("p",p));
  for (const t of spec.tables) {
    node.append(el("h3",t.title));
    const table=el("table"), wrap=box("scroll",table);
    for (const [i, row] of t.rows.entries()) {
      const tr=el("tr");
      for (const value of row) tr.append(el(i===0?"th":"td", String(value ?? "")));
      table.append(tr);
    }
    node.append(wrap);
  }
  return node;
}
function safeName(value) { return String(value || "konsep").replace(/[^A-Za-z0-9_-]/g,"-").slice(0,60); }

export function renderDrafts(target, state, pkg, work, onSave) {
  const npwp=pkg.manifest.wp?.npwp || "", year=String(state.year ?? "");
  const allowed=allowedDrafts(state.role);
  if (!allowed.length) {
    target.append(card("Berita acara",el("p","Pilih peran AR atau Pemeriksa untuk menyiapkan konsep.")));
    return;
  }
  if (!Array.isArray(work.drafts)) work.drafts=[];
  const scope=() => work.drafts.filter(d=>d && d.npwp===npwp && d.year===year);
  const host=box("drafts"), save=()=>Promise.resolve(onSave?.()).catch(error=>notice(error.message,true));
  target.append(host);
  let type=allowed.includes(state.draftType)?state.draftType:allowed[0], active=state.draftId || "";
  function choose(doc) { active=doc.id;type=doc.type;state.draftId=active;state.draftType=type;paint(); }
  function add(source) { const doc=newDraft(type,pkg,year,source,work.rows,work.dispositions);work.drafts.push(doc);save();choose(doc); }
  function paint() {
    const available=scope().filter(d=>d.type===type);
    const doc=available.find(d=>d.id===active) || available.at(-1);
    const tools=box("toolbar",toggleSet(allowed.map(item=>[item,item]),type,next=>{type=next;state.draftType=type;active="";paint();}),
      button(type+" baru",()=>add(null),""));
    if (available.length) {
      tools.append(select(available.map((d,i)=>[d.id,d.number || type+" "+(i+1)]), doc.id, id=>{active=id;state.draftId=id;paint();},"Pilih konsep"));
    }
    const letters=scope().filter(d=>d.type==="SP2DK");
    if (type==="BAP2DK" && letters.length) {
      tools.append(select([["","Pilih SP2DK"],...letters.map((d,i)=>[d.id,d.number || "SP2DK "+(i+1)])],"",id=>{
        const source=letters.find(d=>d.id===id);
        if(source)add(source);
      },"Buat dari SP2DK"));
    }
    host.replaceChildren(card(draftTitles[type], tools));
    if(!doc) {host.append(el("p","Belum ada konsep "+type+" untuk WP dan tahun ini.","hint"));return;}
    const preview=box("preview"), update=()=>{preview.replaceChildren(buildPreview(draftOutput(doc)));};
    function input(label, item, key, kind="text") {
      const node=el(kind==="area"?"textarea":"input");
      if (kind!=="area") node.type=kind;
      node.value=item[key] ?? "";
      node.oninput=()=>{item[key]=node.value;save();update();};
      return field(label,node);
    }
    const fileBase=type+"-"+safeName(doc.year)+"-"+safeName(doc.number);
    const word=async (variant="main")=>{
      try { download(await createDocx(draftOutput(doc,variant)),fileBase+(variant==="main"?"":"-"+variant)+".docx"); }
      catch(e) { notice("Word gagal dibuat. "+e.message,true); }
    };
    const actions=box("toolbar",button("Unduh Word",()=>word()),button("Cetak / PDF",()=>printOutput(draftOutput(doc,"main"))),
      button("Unduh Excel",()=>exportSheets(draftSheets(doc),fileBase)));
    if(type==="BAPK")actions.append(button("Surat panggilan (Word)",()=>word("invitation")),button("Naskah tanpa jawaban",()=>word("blank")));
    actions.append(button("Hapus konsep",()=>{
      if(!window.confirm("Hapus konsep "+type+" yang sedang dibuka?"))return;
      work.drafts=work.drafts.filter(d=>d.id!==doc.id);active="";save();paint();
    }));
    const form=card("Isian konsep",box("row",input("Nomor",doc,"number"),input("Tanggal",doc,"date","date"),
      input("Unit kerja",doc,"office"),input("Petugas",doc,"officer"),input("Dasar penugasan",doc,"assignment"),
      input("Penerima",doc,"recipient"),input("Narahubung",doc,"contact")));
    if(type!=="SP2DK")form.append(box("row",input("Tempat",doc,"place"),input("Waktu pelaksanaan",doc,"time","datetime-local"),
      input("Peserta",doc,"participant"),input("Agenda",doc,"agenda")));
    form.append(input("Uraian",doc,"narrative","area"),input("Catatan hasil",doc,"conclusion","area"));
    if(type==="BAPK"){
      form.append(box("row",input("Nomor surat panggilan",doc,"appointmentNumber"),input("Tanggal surat panggilan",doc,"appointmentDate","date")));
    }
    host.append(actions,form);
    if(type==="BAPK"){
      const questions=card("Pertanyaan dan jawaban"), file=el("input");file.type="file";file.accept=".xlsx";
      file.onchange=async()=>{
        if(!file.files.length)return;
        try{const n=importAnswers(doc,await readXlsx(file.files[0]));await save();paint();notice(n+" jawaban terbaca dari Excel.");}
        catch(error){notice(error.message,true);}
      };
      questions.append(box("toolbar",button("Usulkan pertanyaan dari data",()=>{
        const n=suggestQuestions(doc,pkg,work.rows);save();paint();notice(n+" usulan pertanyaan ditambahkan.");
      }),button("Tambah pertanyaan",()=>{
        doc.questions.push({id:crypto.randomUUID(),text:"",answer:"",note:"",source:"Isian petugas",selected:true});save();paint();
      }),field("Impor jawaban dari Excel",file)));
      for(const [index,q] of doc.questions.entries()){
        const check=el("input");check.type="checkbox";check.checked=q.selected;
        check.onchange=()=>{q.selected=check.checked;save();update();};
        questions.append(card("Pertanyaan "+(index+1),field("Cetak pertanyaan ini",check),input("Pertanyaan",q,"text","area"),
          input("Jawaban",q,"answer","area"),input("Catatan internal",q,"note"),el("small",q.source || ""),
          button("Hapus pertanyaan",()=>{if(!window.confirm("Hapus pertanyaan ini?"))return;doc.questions.splice(index,1);save();paint();})));
      }
      host.append(questions);
    } else {
      const grid=card("Data untuk klarifikasi");
      grid.append(select([["all","Berbukti + indikatif"],["verified","Berbukti saja"]],doc.scope,value=>{
        if(doc.findings.length && !window.confirm("Susun ulang baris temuan dari sumber? Suntingan pada baris, jawaban WP, dan nilai pembahasan akan diganti. Uraian dan catatan konsep tetap tersimpan.")) {
          paint();return;
        }
        const origin=doc.related && scope().find(d=>d.id===doc.related.id && d.type==='SP2DK');
        doc.findings=draftFindings(pkg,year,work.rows,work.dispositions,origin);
        doc.scope=value;save();paint();
      },"Temuan yang dimasukkan"),button("Tambah baris",()=>{const r=blankFinding();doc.findings.push(r);doc.scope="all";save();paint();}));
      for(const [index,f] of visibleFindings(doc).entries()) {
        const section=card("Baris "+(index+1),box("row",input("Jenis",f,"kind"),input("Periode",f,"period"),
          select([["indikatif","Indikatif"],["berbukti","Berbukti"]],f.status,value=>{f.status=value;save();paint();},"Status")),
          input("Uraian data",f,"detail","area"),input("Rujukan data",f,"source"),input("Nilai penelitian",f,"amount","number"));
        if(type==="BAP2DK")section.append(box("row",input("Menurut WP",f,"taxpayer","number"),input("Sesudah pembahasan",f,"discussed","number"),input("Disetujui",f,"agreed","number")));
        section.append(button("Hapus baris",()=>{if(!window.confirm("Hapus baris klarifikasi ini?"))return;doc.findings=doc.findings.filter(r=>r!==f);save();paint();}));
        grid.append(section);
      }
      host.append(grid);
    }
    update();host.append(preview);
  }
  paint();
}
