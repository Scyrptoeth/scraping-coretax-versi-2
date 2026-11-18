import {normalizeId} from '../app-data.js';
import {rowsOf} from './model.js';
import {sourceAmount} from './withholding-forms.js';

const rules=[
  {type:'PPH2126',parent:'C',ref:'C.2.2',title:'PPh Pasal 21/26 terutang',field:'A21IncomeTaxWithheld'},
  {type:'UNIFIKASI',parent:'G',ref:'G.2.2',title:'PPh Pasal 23 terutang',field:'TotalWithholding'},
  {type:'UNIFIKASI',parent:'K',ref:'K.2.2',title:'PPh Pasal 4 ayat (2) terutang',field:'TotalWithholding'}
];
const present=v=>v!==null&&v!==undefined&&v!=='';

function identityProblem(pkg,form,entry,row){
  const body=entry.pages[0]?.Payload??entry.pages[0],owner=normalizeId(pkg.manifest.wp?.npwp),month=form.period.slice(-2);
  const periodCode=month+month+form.year;
  if(body.IsFound===false||[body.TIN,row.TaxIdentificationNumber].filter(present).some(id=>normalizeId(id)!==owner)||
    [body.PeriodCode,row.TaxPeriodCode].filter(present).some(v=>![form.period,periodCode].includes(String(v)))||
    present(row.ReturnSheetRecordIdentifier)&&row.ReturnSheetRecordIdentifier!==form.id)return 'Identitas WP, masa atau rekaman induk tidak cocok.';
  return '';
}

// Each shared line keeps the ID and owner of the original main-form workpaper.
// Only an additional, distinct withholding component can introduce a new review ID.
export function projectWithholdingTax(groups,pkg,year,periods,registrations,sourceProblem,revisionProblem,usesOtherCurrency){
  for(const {type,parent,ref,title,field} of rules){
    const legacy=groups.get(type+'/'+parent);
    if(!legacy)continue;
    const key=type+'/'+ref,group={key,ref,title,tax:legacy.tax,lines:[],support:[]};
    const register=registrations[type],months=new Set(register.keys());
    for(const versions of periods.values())if(versions[0].type===type)months.add(versions[0].period);
    const monthly=[];
    for(const month of [...months].sort()){
      const versions=periods.get(type+'/'+month)||[],max=Math.max(...versions.map(f=>f.version)),latest=versions.filter(f=>f.version===max);
      const form=latest.length===1?latest[0]:null,entry=form?.parts.get('induk');
      const source=entry?.path||(form?form.key+'/induk.json':register.get(month)?.[0]?.path||month);
      let why=!form?(latest.length?'Beberapa rekaman memiliki nomor pembetulan terakhir yang sama.':'Induk atas masa yang tercatat pada daftar SPT belum tersedia.'):
        revisionProblem(register.get(month)||[],versions,form)||sourceProblem(pkg,form,'induk',entry);
      const rows=!why?rowsOf(entry):[],row=rows.length===1?rows[0]:null;
      if(!why)why=row?identityProblem(pkg,form,entry,row):'Induk tunggal tidak tersedia.';
      if(!why&&usesOtherCurrency(form.meta,entry.cap,entry.cap?.konteks,entry.pages[0]?.Payload,row))why='Mata uang induk belum dapat dijumlahkan dalam rupiah pada KKP.';
      const matches=legacy.lines.filter(l=>l.period===month&&l.version===max&&l.id.endsWith(type==='PPH2126'?'#'+field:'.'+field));
      if(!why&&matches.length!==1)why=matches.length?'Subtotal pasal muncul beberapa kali pada induk.':'Subtotal pasal belum tersedia pada induk.';
      const line=matches.length===1?matches[0]:null;
      let amount=null,trace=line?.source||source,componentNote='';
      if(!why&&line){
        const n=line.amount;
        if(type==='UNIFIKASI'){
          const offset=/IncomeTaxes\[(\d+)\]/.exec(line.id);
          if(usesOtherCurrency(row.IncomeTaxes?.[Number(offset?.[1])]?.data))why='Mata uang subtotal belum dapat dijumlahkan dalam rupiah pada KKP.';
        }
        if(!why){
          line.canonicalKey=key;group.lines.push(line);
          if(type==='PPH2126'){
            const other=sourceAmount(row.A26IncomeTaxWithheld);
            trace=source+' · A21IncomeTaxWithheld + A26IncomeTaxWithheld';
            if(other!==null&&other!==0){
              group.lines.push({id:source+'#A26IncomeTaxWithheld',ref,groupKey:key,period:month,version:max,topic:'PPh Pasal 26 dipotong',tax:'PPh Pasal 26',
                source:source+' · A26IncomeTaxWithheld',amount:other,partial:false});
            }
            if(n!==null&&other!==null)amount=n+other;
            else why='Nominal PPh Pasal 21 atau Pasal 26 belum tercantum sebagai angka.';
            componentNote='Jumlah Pasal 21 dan 26. Nilai Pasal 21 memakai hasil pengujian yang sama dengan induk C.';
          }else{
            amount=n;if(n===null)why='Nominal pemotongan atau pemungutan belum tercantum sebagai angka.';
            componentNote='Hasil pengujian yang sama juga tampil pada induk '+parent+'.';
          }
        }
      }
      monthly.push({Uraian:'PPh terutang menurut induk',Masa:month,Pembetulan:form?.version??null,Nilai:amount,
        Satuan:'Rp (format KKP)',Sumber:trace,Keterangan:why||componentNote});
    }
    if(!group.lines.length)continue;
    (legacy.support??=[]).push({Uraian:'Pengujian yang terhubung ke '+ref,
      Keterangan:'Perubahan hasil pengujian pemotongan atau pemungutan akan tampil pada kedua indeks. Setiap butir dihitung sekali dalam temuan.'});
    const confirmed=monthly.filter(r=>Number.isFinite(r.Nilai)),complete=confirmed.length===monthly.length;
    group.support.push(...monthly,{Uraian:'Jumlah PPh terutang dari masa SPT dalam paket',Masa:String(year),Nilai:complete?confirmed.reduce((n,r)=>n+r.Nilai,0):null,
      Satuan:'Rp (format KKP)','Masa SPT dalam paket':monthly.length,'Masa terkonfirmasi':confirmed.length,
      'Masa belum terkonfirmasi':monthly.filter(r=>r.Nilai===null).map(r=>r.Masa).join(', '),
      Sumber:monthly.map(r=>r.Masa+' · '+r.Sumber).join('\n'),Keterangan:complete?'Jumlah hanya mencakup masa yang tercatat pada paket.':'Jumlah menunggu konfirmasi seluruh masa SPT yang tercatat.'});
    groups.set(key,group);
  }
}
