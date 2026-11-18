const defaults={density:'Otomatis',theme:'Terang',contrast:'0',filename:'npwp'};
const session=new Map();

export function readPref(key) {
  if(session.has(key))return session.get(key);
  try {
    return localStorage.getItem('scv2-view-'+key) ?? defaults[key];
  } catch {
    return defaults[key];
  }
}
export function setPref(key,value) {
  try {
    localStorage.setItem('scv2-view-'+key,value);
    session.delete(key);
  } catch {
    session.set(key,value);
  }
}
export function resetAppearance() {
  for(const [key,value] of Object.entries(defaults))setPref(key,value);
}
function filenamePart(value) {
  return Array.from(String(value??'').normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}]+/gu,'-'))
    .slice(0,40).join('').replace(/^-+|-+$/g,'');
}
export function outputFilename(base,extension,wp) {
  if(typeof wp?.npwp!=='string' && !Number.isSafeInteger(wp?.npwp))return base+'.'+extension;
  const id=filenamePart(wp?.npwp);
  if(!id)return base+'.'+extension;
  const name=readPref('filename')==='npwp-nama'?filenamePart(wp.nama):'';
  return [base,id,name].filter(Boolean).join('-')+'.'+extension;
}
