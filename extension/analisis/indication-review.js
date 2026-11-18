export const reviewStates=[['pending','Belum diuji'],['explained','Terjelaskan'],['inapplicable','Aturan tidak relevan'],['retained','Dipertahankan untuk pengujian']];
const rules=new Set(['vat-facility','vat-input-late','borrowing-cost','payroll-gap','rent-gap','related-loan','depreciation','entertainment']);

export function validateIndicationReviews(input){
  if(input===undefined)return {};
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Daftar telaah indikasi tidak dikenali.');
  const map={};
  for(const [id,status] of Object.entries(input)){
    if(!rules.has(id)||!reviewStates.some(([key])=>key===status))throw Error('Butir atau status telaah indikasi tidak dikenali.');
    map[id]=status;
  }
  return map;
}
export function validateLoanRate(input){
  if(input===undefined||input===null)return null;
  if(!Number.isFinite(input.percent)||input.percent<0||typeof input.source!=='string'||!input.source.trim())
    throw Error('Isi persentase bunga tahunan dan rujukan untuk skenario piutang afiliasi.');
  return {percent:input.percent,source:input.source.trim()};
}
