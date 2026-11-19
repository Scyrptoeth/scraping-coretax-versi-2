import {filingAndPaymentReport} from './formal-compliance.js';
import {compare} from './model.js';

export function kkaCompliance(pkg,year){
  const title='L-4a Kepatuhan Formal';
  const {rows:detail,filings}=filingAndPaymentReport(pkg,year);
  const counts=new Map();
  for(const [type,,,,,,status] of filings){
    if(!counts.has(type))counts.set(type,{total:0,onTime:0,late:0,unknown:0});
    const count=counts.get(type);
    count.total++;
    if(status==='Tepat')count.onTime++;
    else if(status==='Lewat batas')count.late++;
    else count.unknown++;
  }
  const summary=[['Jenis SPT','SPT normal tercatat','Dalam batas','Lewat batas','Tanggal belum lengkap']];
  for(const [type,count] of [...counts].sort(([a],[b])=>compare(a,b))){
    const comparable=count.total>count.unknown;
    summary.push([type,count.total,comparable?count.onTime:null,comparable?count.late:null,count.unknown]);
  }
  if(!counts.size)summary.push(['SPT normal belum tercantum dalam paket',null,null,null,null]);
  const notes=[
    ['Tahun pajak',String(year)],
    ['Batas lapor memakai tanggal yang tercantum pada sumber dan penyesuaian akhir pekan. Periksa hari libur dan relaksasi yang berlaku.'],
    ['Jumlah dan status mengikuti baris yang terbaca dalam paket. Masa yang belum tercantum perlu dicocokkan dengan daftar pelaporan.']
  ];
  return {title,rows:summary,workbook:{name:title,rows:[[title],...notes,[],...summary,[],...detail]}};
}
