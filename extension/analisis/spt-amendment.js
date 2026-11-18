import {differences,payloads,worksheet} from './model.js';

const numberFields=['DocumentNumber','TaxInvoiceNumber','InvoiceNumber','WithholdingSlipsNumber','WithholdingSlipNumber'];
const fiscalFields={TaxBase:'DPP',OtherTaxBase:'DPP nilai lain',VAT:'PPN',STLG:'PPnBM',IncomeTax:'PPh'};

function readGrid(entry){
  if(!entry)return null;
  const rows=[];
  let complete=entry.cap?.lengkap===true;
  for(const [i,page] of (entry.pages||[]).entries()){
    if(page?.IsSuccessful===false){complete=false;continue;}
    const body=page?.Payload??page,table=Array.isArray(body)?body:body?.Data??body?.rows;
    if(!Array.isArray(table))return null;
    table.forEach((value,j)=>rows.push({value,location:entry.path+' · halaman '+(i+1)+', baris '+(j+1)}));
  }
  const expected=[entry.cap?.baris,entry.cap?.total,...(entry.pages||[]).map(p=>p?.Payload?.TotalRecords)];
  if(!entry.pages?.length||expected.some(n=>Number.isFinite(n)&&n!==rows.length))complete=false;
  return {rows,complete};
}

function documentKey(value){
  const ids=[];
  for(const field of numberFields){
    const raw=value?.[field];
    if(typeof raw!=='string'&&!(typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>0))continue;
    const id=String(raw).trim();
    if(id&&!/^(?:[-–—]+|0+|n\/?a|null|undefined)$/i.test(id))ids.push([field,id]);
  }
  return ids.length&&ids.every(([,id])=>id===ids[0][1])?ids[0]:null;
}

function indexed(grid){
  const byId=new Map(),unknown=[],fields=new Set();
  for(const row of grid?.rows||[]){
    const key=documentKey(row.value);
    if(!key){unknown.push(row);continue;}
    const [field,id]=key;fields.add(field);
    if(!byId.has(id))byId.set(id,[]);
    byId.get(id).push(row);
  }
  return {byId,unknown,fields};
}

function amount(grid,field){
  if(!grid)return {total:null,count:0};
  const values=grid.rows.map(r=>r.value?.[field]).filter(Number.isFinite);
  return {total:values.length===grid.rows.length&&(values.length||grid.complete)?values.reduce((s,v)=>s+v,0):null,count:values.length};
}

export function compareSptPart(part,previous,current){
  const before=readGrid(previous),after=readGrid(current);
  const declared=[previous,current].map(e=>e?.cap?.konteks?.jenisBagian).filter(Boolean);
  const tabular=(before!==null||after!==null)&&(!previous||before!==null)&&(!current||after!==null);
  const isGrid=part!=='induk'&&!part.endsWith('-total')&&(declared.includes('grid')||(!declared.length&&tabular));
  if(!isGrid)return {kind:'fields',changes:differences(payloads(previous),payloads(current))};

  const left=indexed(before),right=indexed(after),changes=[],unmatched=[],totals=[],notes=[];
  function unpaired(side,row,key,reason){
    unmatched.push({Versi:side,Dokumen:key,Alasan:reason,Sumber:row.location});
  }
  const grids=[['Sebelumnya',before,left],['Sekarang',after,right]];
  for(const [side,grid,index] of grids){
    if(!grid)notes.push(side+' · bagian tidak tersedia atau format tabel tidak terbaca.');
    else if(!grid.complete)notes.push(side+' · cakupan tabel belum dapat dipastikan.');
    for(const row of index.unknown)unpaired(side,row,null,'Nomor dokumen kosong, tidak dikenali, atau saling bertentangan.');
  }
  let added=0,removed=0,changed=0,matched=0;
  for(const key of new Set([...left.byId.keys(),...right.byId.keys()])){
    const old=left.byId.get(key)||[],now=right.byId.get(key)||[];
    if(old.length>1||now.length>1){
      for(const [side,rows] of [['Sebelumnya',old],['Sekarang',now]])for(const row of rows)unpaired(side,row,key,'Nomor dokumen berulang.');
      continue;
    }
    const a=old[0],b=now[0];
    const refs={'Sumber sebelumnya':a?.location,'Sumber sekarang':b?.location};
    if(a&&b){
      matched++;
      const fields=differences(a.value,b.value);
      if(fields.length)changed++;
      for(const field of fields)changes.push({Status:'Berubah',Dokumen:key,...field,...refs});
    }else{
      const other=a?after:before,hasUnknown=(a?right:left).unknown.length;
      if(!other?.complete||hasUnknown){
        unpaired(a?'Sebelumnya':'Sekarang',a||b,key,'Versi pembanding tidak lengkap atau memuat baris tanpa nomor yang pasti.');
        continue;
      }
      if(a)removed++;else added++;
      changes.push({Status:a?'Hilang':'Baru',Dokumen:key,Isian:'Dokumen',Sebelumnya:a?key:null,Sekarang:b?key:null,...refs});
    }
  }
  for(const [field,label] of Object.entries(fiscalFields)){
    if(!grids.some(([,grid])=>grid?.rows.some(r=>r.value&&Object.hasOwn(r.value,field))))continue;
    const a=amount(before,field),b=amount(after,field);
    totals.push({Nominal:label,Isian:field,Sebelumnya:a.total,Sekarang:b.total,
      Selisih:before?.complete&&after?.complete&&a.total!==null&&b.total!==null?b.total-a.total:null,
      'Baris bernilai sebelumnya':a.count,'Baris bernilai sekarang':b.count});
  }
  const summary={'Kolom nomor dokumen':[...new Set([...left.fields,...right.fields])].join(', ')||null,
    'Baris sebelumnya':before?before.rows.length:null,'Baris sekarang':after?after.rows.length:null,
    'Dokumen berpasangan':matched,'Dokumen berubah':changed,'Dokumen baru':added,'Dokumen hilang':removed,'Baris perlu dicocokkan':unmatched.length};
  return {kind:'grid',summary,changes,unmatched,totals,notes};
}

export function amendmentSheets(comparison,title){
  const rows=[['Perbandingan',title],...Object.entries(comparison.summary),...comparison.notes.map(n=>['Cakupan',n])];
  const sheets=[{name:'Ringkasan',rows}];
  for(const [name,data] of [['Perubahan',comparison.changes],['Nominal lampiran',comparison.totals],['Perlu dicocokkan',comparison.unmatched]]){
    if(data.length)sheets.push({name,rows:worksheet(data)});
  }
  return sheets;
}
