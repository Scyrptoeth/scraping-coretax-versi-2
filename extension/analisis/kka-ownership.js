import {company} from './indicative-source.js';
import {isKkaCorporate,kkaRegistryEntries,relatedPartyRegistryComplete} from './kka-management.js';
import {rowsOf,sptDay} from './model.js';
import {activeShareholders,compareShareholders} from './profile.js';
import {sourceAmount} from './withholding-forms.js';

const text=value=>typeof value==='string'?value:Number.isSafeInteger(value)?String(value):'';
const countRows=rows=>Array.isArray(rows)?rows.length:null;
const verifiedList=value=>Array.isArray(value)&&value.every(row=>row&&typeof row==='object'&&!Array.isArray(row))?value:null;
const version=record=>record.form.version?'Pembetulan '+record.form.version:'Normal';
const noReturn='Induk SPT Badan versi terakhir belum terverifikasi untuk tahun ini.';
const benefit=value=>typeof value==='boolean'?(value?'Ya':'Tidak'):null;

export function kkaOwnership(pkg,year){
  if(!isKkaCorporate(pkg))return [];
  const record=company(pkg,String(year)),ownership=record?.body.ListOfOwnership;
  const context=record?[['SPT Badan',String(year),version(record),record.path]]:[['SPT Badan',String(year),noReturn]];
  return [
    shareholderAttachment(pkg,verifiedList(ownership?.ListOfShareholders),context),
    investmentAttachment(verifiedList(ownership?.InvestmentList),context)
  ];
}

function shareholderAttachment(pkg,reported,context){
  const title='L-2b Pemegang Saham',asOf=sptDay(pkg.manifest.dibuat);
  const files=asOf?kkaRegistryEntries(pkg,'pihak','profil/pihak-terkait.json'):[];
  const registry=files.flatMap(entry=>rowsOf({...entry,pages:entry.pages?.filter(page=>!page?.Errors?.length)})
    .map(row=>({...row,'Berkas sumber':entry.path})));
  const hasRegistry=relatedPartyRegistryComplete(pkg,files),hasReport=Array.isArray(reported);
  const matched=compareShareholders(registry,hasReport?reported:[],{asOf,hasRegistry,hasReport});
  const summary=[['Ukuran','Nilai'],['Pemegang saham tercantum dalam SPT Badan',countRows(reported)],
    ['Total porsi dalam SPT (%)',matched.reportTotal],['Total porsi dalam registrasi (%)',matched.registryTotal]];
  if(hasRegistry&&hasReport)summary.push(['Porsi cocok pada kedua sumber',matched.rows.filter(row=>row.Status==='Cocok').length]);
  const columns=['Nama','NPWP registrasi','NPWP SPT','Porsi registrasi (%)','Porsi SPT (%)','Status','Pencocokan'];
  const compareRows=matched.rows.map(row=>columns.map(key=>
    key==='Status'&&files.length&&!hasRegistry&&row[key]==='Data registrasi belum tersedia'?'Registrasi belum lengkap':row[key]));
  const workbookRows=[[title],...context,
    ['Registrasi',asOf||null,hasRegistry?'Data pihak terkait tersedia':files.length?'Cakupan registrasi belum terkonfirmasi lengkap':
      'Registrasi pihak terkait belum dapat diperiksa',...files.map(entry=>entry.path)],
    ['Porsi SPT mengikuti tahun pajak yang dipilih. Registrasi menggambarkan keadaan saat paket dibuat.'],[],
    ...summary,[],['Pencocokan pemegang saham'],columns,...compareRows,[],['Daftar pada induk SPT Badan'],
    ['Nama','NPWP/NIK','Negara','Porsi (%)','Modal disetor','Dividen','Jabatan']];
  if(hasReport)workbookRows.push(...reported.map(row=>[
    row.Name,text(row.TIN),row.CountryCode,sourceAmount(row.PaidInCapitalPercentage),
    sourceAmount(row.PaidInCapital),sourceAmount(row.Dividend),row.Position
  ]));
  else workbookRows.push(['Daftar pemegang saham belum tersedia dari induk untuk tahun yang dipilih.']);
  const active=activeShareholders(registry,asOf);
  if(active.length)workbookRows.push([],['Pemegang saham berlaku pada registrasi'],
    ['Nama','NPWP/NIK','Porsi (%)','Pemilik manfaat','Berlaku dari','Berlaku sampai','Berkas sumber'],
    ...active.map(row=>[row.PersonName,text(row.PersonNIKTIN),row.Percentage,benefit(row.BenefitialOwner??row.BeneficialOwner),
      sptDay(row.ValidFrom),sptDay(row.ValidTo),row['Berkas sumber']]));
  return {title,rows:summary,workbook:{name:title,rows:workbookRows}};
}

function investmentAttachment(investments,context){
  const title='L-2c Penyertaan',hasReport=Array.isArray(investments);
  const summary=[['Ukuran','Nilai'],['Jumlah penyertaan tercantum dalam SPT Badan',countRows(investments)]];
  const rows=[[title],...context,[],...summary,[],['Nama perusahaan','NPWP','Negara','Nilai penyertaan','Porsi (%)',
    'Utang ke perusahaan','Piutang dari perusahaan','Tahun piutang']];
  if(hasReport)rows.push(...investments.map(row=>[
    row.Name,text(row.Tin??row.TIN),row.CountryCode,sourceAmount(row.Investment),sourceAmount(row.InvestmentPercentage),
    sourceAmount(row.Debt),sourceAmount(row.Receivable),text(row.ReceivableYear)
  ]));
  else rows.push(['Daftar penyertaan belum tersedia dari induk untuk tahun yang dipilih.']);
  return {title,rows:summary,workbook:{name:title,rows}};
}
