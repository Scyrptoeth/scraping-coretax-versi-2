import {checkedCompanyEntry,checkedCompanyTable} from './kkp-company-annexes.js';
import {sourceAmount} from './withholding-forms.js';

const fiscalParts = ['l9-1-1','l9-1-2','l9-1-3','l9-1-4','l9-1-5','l9-2-1','l9-2-2','l9-3-1','l9-3-2','l9-3-3','l9-3-4','l9-3-5'];
const finite=Number.isFinite;

export function fiscalComparisons(pkg,year,index) {
  const output=new Map();
  const group=index.groups.find(g=>g.key==='BADAN/B.7');
  const parents=pkg.forms.filter(f=>f.type==='BADAN'&&f.period===year);
  if(!group||!parents.length)return output;
  const last=Math.max(...parents.map(f=>f.version)),forms=parents.filter(f=>f.version===last);
  if(forms.length!==1||!checkedCompanyEntry(pkg,forms[0],'induk'))return output;
  const form=forms[0];
  const control=index.groups.find(g=>g.key==='BADAN/B')?.support?.find(r=>r.Kode==='A4020');
  if(!control||control.Satuan==='Bertentangan atau tidak dikenali')return output;
  function account(code) {
    const line=group.lines.find(l=>l.id.endsWith('/account-'+code));
    const cost=group.support.find(s=>s.Uraian==='Biaya komersial · '+code);
    return line && !line.partial && finite(line.amount) && finite(cost?.Nilai) && cost.Nilai>=0 ? {line,cost} : null;
  }
  // Only compare like-for-like annual inputs. Missing, filtered or ambiguous schedules cannot establish a zero.
  const depreciation=account('5314');
  if(depreciation&&!Array.from(form.parts.keys()).some(k=>/^l9-\d/.test(k)&&!fiscalParts.includes(k))) {
    const tables=fiscalParts.map(part=>checkedCompanyTable(pkg,form,part));
    if(tables.every(Array.isArray)) {
      const values=tables.flat().map(r=>sourceAmount(r?.FiscalYearValue));
      if(values.every(v=>finite(v)&&v>=0)) {
        const {line,cost}=depreciation;
        const value=Math.max(0,cost.Nilai-values.reduce((sum,n)=>sum+n,0));
        if(finite(value)&&value!==line.amount)output.set(line.id,{value,
          source:[cost.Sumber,...fiscalParts.map(k=>form.parts.get(k).path)].join(' · '),
          note:'Biaya penyusutan dan amortisasi pada L1 dikurangi jumlah nilai fiskal tahun berjalan pada rincian L9, dibatasi paling rendah nol. Cocokkan aset, masa manfaat, dan metode dengan bukti.'});
      }
    }
  }
  const entertainment=account('5321'),list=checkedCompanyTable(pkg,form,'l11a-2');
  if(entertainment&&list?.length===0) {
    const {line,cost}=entertainment;
    if(cost.Nilai!==line.amount)output.set(line.id,{value:cost.Nilai,
      source:cost.Sumber+' · '+form.parts.get('l11a-2').path,
      note:'Daftar nominatif L11A tabel 2 yang lengkap pada paket berisi nol baris. Biaya jamuan menjadi pembanding awal. Periksa rincian biaya, tujuan usaha, dan bukti pendukung.'});
  }
  return output;
}
