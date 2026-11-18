import {checkIdentity,rowsOf} from './app-data.js';
import {periodLabel} from './app-package-entries.js';

const key=s=>String(s).trim().toLowerCase().replace(/[\s_-]/g,'');
const flags=new Set(['iscancelled','iscanceled','dibatalkan','transaksidibatalkan','statuspembatalan','cancellationstatus']);
function flagValue(v){
  if(v===true || v===1)return 'cancelled';
  if(v===false || v===0)return 'active';
  if(typeof v!=='string')return 'unknown';
  const s=v.trim().toLowerCase();
  if(['true','1','ya','batal','dibatalkan','cancelled','canceled'].includes(s))return 'cancelled';
  if(['false','0','tidak','tidak dibatalkan','tidak batal','aktif','active'].includes(s))return 'active';
  return 'unknown';
}
function rowStatus(row){
  const states=new Set(Object.entries(row||{}).filter(([k,v])=>flags.has(key(k)) && v!=null && String(v).trim()!=='').map(([,v])=>flagValue(v)));
  return {state:states.size===1?[...states][0]:'unknown',missing:!states.size,conflict:states.size>1};
}
const declaredStatus=filter=>({aktif:'active',batal:'cancelled'})[filter];
function effectiveStatus(row,selection){
  if(!selection || selection.jenis==='total')return row.state;
  const declared=declaredStatus(selection.filterPembatalanDilaporkan || selection.filterPembatalanSumber);
  if(declared && row.state!=='unknown' && row.state!==declared)return 'unknown';
  if(declared && row.missing && !selection.konflikStatus && selection.filterPembatalanSumber!=='bertentangan')return declared;
  return row.state;
}
export const ledgerCancellation=(row,selection)=>effectiveStatus(rowStatus(row),selection);

const filterBlocks=p=>[p,p?.Payload,p?.Request,p?.Query,p?.Payload?.Request,p?.Payload?.Query].filter(b=>b && typeof b==='object' && Object.hasOwn(b,'Filters'));
const isDisjunction=obj=>[obj?.Operator,obj?.Logic,obj?.LogicalOperator,obj?.FilterOperator].some(v=>String(v).toLowerCase()==='or');
function monthFromQuery(page,rows){
  if(rows.some(r=>Object.keys(r||{}).some(k=>['periodcode','taxperiodcode','taxperiod','masapajak','periodepajak','taxyear','tahunpajak'].includes(key(k)))))return '';
  const months=new Set();
  for(const block of filterBlocks(page)){
    if(!Array.isArray(block.Filters) || isDisjunction(block) || block.Filters.some(isDisjunction))return '';
    const period=block.Filters.filter(f=>key(f?.PropertyName)==='periodcode');
    if(!period.length || period.some(f=>String(f.MatchMode).toLowerCase()!=='equals'))return '';
    for(const f of period)months.add(periodLabel([{PeriodCode:f.Value}],true));
  }
  const [month]=months;
  return months.size===1 && /^\d{4}-\d{2}$/.test(month)?month:'';
}
export function checkLedgerScope(item,page){
  if(item.source!=='bb' && item.source!=='bbtotal')return;
  const rows=rowsOf(page),[from,to]=String(item.period).split(' s.d. ');
  function verifyPeriod(period){
    if(!period || !from || !to)return;
    if(period<from.slice(0,period.length) || period>to.slice(0,period.length))throw Error('Masa buku besar pada sumber berada di luar periode yang dipilih.');
  }
  for(const row of rows){
    for(const [field,value] of Object.entries(row||{}))if(key(field)==='taxpayertin')checkIdentity([{NPWP:value}],item.wp);
    verifyPeriod(periodLabel([row],true));
  }
  verifyPeriod(monthFromQuery(page,rows));
}
function sourceFilters(item,month){
  const scopes=[],other=[];
  for(const block of filterBlocks(item.page)){
    const filters=block.Filters;
    if(!Array.isArray(filters)){scopes.push('tidak-diketahui');continue;}
    const cancellation=new Set();let additional=false;
    if(isDisjunction(block) || filters.some(isDisjunction))cancellation.add('tidak-diketahui');
    for(const f of filters){
      if(!f || typeof f!=='object' || !f.PropertyName){additional=true;cancellation.add('tidak-diketahui');continue;}
      const property=key(f.PropertyName);
      if(property==='iscancelled' || property==='iscanceled'){
        const state=String(f.MatchMode).toLowerCase()==='equals'?flagValue(f.Value):'unknown';
        cancellation.add(({active:'aktif',cancelled:'batal',unknown:'tidak-diketahui'})[state]);
      }else if(property!=='periodcode' || String(f.MatchMode).toLowerCase()!=='equals' || !month ||
          periodLabel([{PeriodCode:f.Value}],true)!==month)additional=true;
    }
    other.push(additional);
    scopes.push(cancellation.size>1?'bertentangan':cancellation.size?[...cancellation][0]:'tanpa-filter-pembatalan');
  }
  const visibleFilter=item.proof?.pratinjauSumber?.filterAktif;
  return {filterPembatalanSumber:new Set(scopes).size>1?'bertentangan':scopes[0]||'tidak-diketahui',
    filterLainPadaSumber:visibleFilter===true || other.some(Boolean)?true:other.length?false:null};
}
const disposition=(filter,include)=>['aktif','batal','tanpa-filter-pembatalan'].includes(filter)?
  (filter===(include?'tanpa-filter-pembatalan':'aktif')?'sesuai':'berbeda'):'belum-terbukti';

// The original queue remains available while the user changes the selection.
// A total or a balance is a source amount, never a sum reconstructed from detail rows.
export function selectLedgerRows(item,include){
  if(!item || !['bb','bbtotal'].includes(item.source) || typeof include!=='boolean' || item.ledgerSelection)return item;
  const rows=rowsOf(item.page),rowPeriod=periodLabel(rows,true),ledgerPeriod=rowPeriod || monthFromQuery(item.page,rows),total=item.source==='bbtotal';
  const filters=sourceFilters(item,item.proof?.pratinjauSumber?.masa || ledgerPeriod);
  const selection={jenis:total?'total':'rincian',ikutkanBatal:include,...filters,cakupanOpsi:disposition(filters.filterPembatalanSumber,include),
    ...(!rowPeriod && ledgerPeriod?{masaDariFilter:ledgerPeriod}:{}),
    barisSumber:rows.length,barisTersimpan:rows.length,totalDilaporkanSumber:item.total??null,aktif:total?null:0,batal:total?null:0,
    tidakDiketahui:total?null:0,berdasarkanFilter:0,konflikStatus:0,batalDilewati:0};
  if(total)return {...item,ledgerPeriod,ledgerSelection:selection};
  const states=rows.map(rowStatus);
  const declared=declaredStatus(filters.filterPembatalanSumber);
  selection.konflikStatus=states.filter(s=>s.conflict || declared && s.state!=='unknown' && s.state!==declared).length;
  if(selection.konflikStatus && declared){
    selection.filterPembatalanDilaporkan=selection.filterPembatalanSumber;
    selection.filterPembatalanSumber='bertentangan';selection.cakupanOpsi='belum-terbukti';
  }
  const keep=rows.filter((_,i)=>{
    const row=states[i],status=effectiveStatus(row,selection);
    if(row.missing && status!=='unknown')selection.berdasarkanFilter++;
    if(status==='active')selection.aktif++;
    else if(status==='cancelled')selection.batal++;
    else selection.tidakDiketahui++;
    return include || status!=='cancelled';
  });
  selection.barisTersimpan=keep.length;selection.batalDilewati=rows.length-keep.length;
  if(!selection.batalDilewati)return {...item,ledgerPeriod,ledgerSelection:selection};
  const page={Payload:{Data:keep}};
  for(const k of ['IsSuccessful','Errors'])if(Object.hasOwn(item.page,k))page[k]=item.page[k];
  return {...item,ledgerPeriod,ledgerSelection:selection,rows:keep.length,total:null,page};
}

export function ledgerSelectionText(s){
  if(!s)return '';
  if(s.jenis==='total')return 'Total pembanding mengikuti angka pada sumber. '+
    ({sesuai:'Filter pembatalannya sesuai dengan pilihan.',berbeda:'Filter pembatalannya berbeda dari pilihan.','belum-terbukti':'Filter pembatalannya belum diketahui.'})[s.cakupanOpsi];
  return s.barisTersimpan+' dari '+s.barisSumber+' baris rincian dipilih. '+s.aktif+' aktif, '+s.batal+' batal, '+s.tidakDiketahui+' belum diketahui. '+
    s.batalDilewati+' baris batal dilewati.'+(s.berdasarkanFilter?' Status '+s.berdasarkanFilter+' baris mengikuti filter sumber.':'')+
    (s.konflikStatus || s.filterPembatalanSumber==='bertentangan'?' Ada keterangan status atau filter yang bertentangan.':'')+
    (s.ikutkanBatal && s.filterPembatalanSumber==='aktif'?' Sumber hanya menyertakan transaksi aktif.':'')+
    (s.filterPembatalanSumber==='batal'?' Sumber hanya menyertakan transaksi batal.':'');
}
