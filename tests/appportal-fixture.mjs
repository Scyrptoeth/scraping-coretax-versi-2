export const owner='0000000000000017';
export const headers=['Nomor dokumen','Masa','Tahun','NPWP pemilik','DPP','PPN'];
export function portalEntry(part,rows,{npwp=owner,period='2025-01',version=0,id='demo-'+period+'-'+version}={}){
  const [year,month]=period.split('-');
  const key='spt/PPN/'+period+'/p'+String(version).padStart(2,'0')+'_'+id;
  const cap={sumber:'sptisi',lengkap:true,halaman:1,total:rows.length,baris:rows.length,konteks:{npwp,bagian:part,jenisBagian:'grid',
    spt:{npwp,recordId:id,jenis:'VAT_VATR',tahun:Number(year),masa:month+month+year,pemb:version}}};
  return {path:key+'/'+part+'.json',cap,pages:[{IsSuccessful:true,Payload:{TotalRecords:rows.length,Data:rows}}]};
}
export function annexDoc(number,base=100,vat=11){return {DocumentNumber:number,TaxBase:base,VAT:vat};}
export function portalRow(number,base='100',vat='11',y='2025',m='01',wp=owner){return [number,m,y,wp,base,vat];}
