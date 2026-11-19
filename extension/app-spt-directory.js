import {rowsInColumnOrder,visibleTables} from './app-data.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const scopeError=()=>Object.assign(Error('Daftar SPT awal atau WP pada daftar sudah berubah. Periksa kembali tab sumber.'),{code:'SCOPE'});
const loadLimit = 120000;
const loadTimeout=()=>Error('Coretax belum selesai memuat daftar SPT dalam 2 menit. Coba lagi saat sesi Coretax masih aktif.');

// Keep only an index that was verified through the same table adapter used by manual capture.
export async function sptDirectory(ext,tabId,wp,{
  previewIndex=true,expectedUrl,workTab=false,checkpoint=()=>{},onLoading=()=>{},reopenWorkTab
}={}) {
  const url=(await ext.tabs.get(tabId)).url;
  if(expectedUrl && url!==expectedUrl)throw scopeError();
  const run=async options=>(await ext.scripting.executeScript({target:{tabId},func:visibleTables,args:[options]}))[0];
  const execute=async options=>(await run(options))?.result;
  async function readOnce(){
    if((await ext.tabs.get(tabId)).url!==url)throw scopeError();
    const tables=await execute(null);
    if(!Array.isArray(tables))throw scopeError();
    const indexes=tables.filter(t=>t.indexSource==='sptdaftar');
    if(indexes.length!==1)throw scopeError();
    const options={...indexes[0],url,previewIndex,scope:{wp,source:'sptdaftar',manual:true}};
    const frame=await run(options),data=frame?.result;
    if(data?.loading)return {loading:data.skip};
    if(!data?.indexScope){if(previewIndex && data?.skip)throw Error(data.skip);throw scopeError();}
    return {options,data,documentId:frame.documentId};
  }
  async function read(){
    let index=await readOnce();
    if(!index.loading)return index;
    if(!workTab)throw Error(index.loading);
    const deadline=Date.now()+loadLimit;
    do {
      onLoading(deadline-Date.now());
      await wait(250);await checkpoint();
      index=await readOnce();
      if(!index.loading)return index;
    } while(Date.now()<deadline);
    throw loadTimeout();
  }
  await read();
  let advanced=false;
  async function waitForIndex(checkpoint,previousDocument){
    const deadline=Date.now()+(workTab?loadLimit:3000);
    let loading=false;
    do {
      await wait(150);await checkpoint();
      try{
        const index=await readOnce();
        if(index.loading)loading=true;
        else if(!previousDocument || index.documentId!==previousDocument) return index;
      }catch{}
      if(workTab&&loading&&Date.now()<deadline)onLoading(deadline-Date.now());
    } while(Date.now()<deadline);
    if(workTab&&loading)throw loadTimeout();
    throw scopeError();
  }
  async function find(candidates,{checkpoint,limit}){
    let index=await read(),seen=new Set();
    const findMatch=()=>candidates.find(c=>index.data.rows.some(c.navigation.matches));
    const seekTurn=async direction=>{
      for(let attempt=0;attempt<3;attempt++){
        await checkpoint();
        index=await turn(index,direction,workTab);
        if(!index.recheck)return null;
        const matched=findMatch();
        if(matched)return matched;
        await wait(160);
      }
      throw Error('Isi halaman daftar belum stabil sebelum berpindah.');
    };
    let selected=findMatch();
    if(selected)return selected;
    if(index.data.canFirst){
      selected=await seekTurn('first');
      if(selected)return selected;
      advanced=false;
    }else if(advanced || workTab && !index.data.position?.atStart){
      await checkpoint();
      if(!(await execute({...index.options,restartIndex:true}))?.returning)throw scopeError();
      advanced=false;index=await waitForIndex(checkpoint,index.documentId);
    }
    for(let page=1;;page++){
      await checkpoint();
      selected=findMatch();if(selected)return selected;
      const position=index.data.position;
      const fingerprint=position?.range || position?.pageNumber
        ? JSON.stringify([position.range,position.pageNumber])
        : JSON.stringify(index.data.rows.map(r=>JSON.stringify(r)).sort());
      if(seen.has(fingerprint))throw Error('Halaman daftar berulang sebelum versi ditemukan.');
      seen.add(fingerprint);
      if(!index.data.canAdvance)throw Error('Versi belum ditemukan pada halaman daftar yang dapat dijangkau.');
      if(page>=limit)throw Error('Batas pencarian halaman daftar tercapai.');
      selected=await seekTurn(true);
      if(selected)return selected;
      advanced=true;
    }
  }
  async function restore(candidate,view,checkpoint,failure){
    await checkpoint();
    if(view){
      await candidate.navigation.returnToIndex(view,url,tabId,checkpoint,failure?.code==='SPT_LOAD_TIMEOUT');
      if(view.tabId===tabId)advanced=false;
      return waitForIndex(checkpoint);
    }
    const recovered=await candidate.navigation.recoverIndex?.(tabId,url,{allowFreshIndex:Boolean(reopenWorkTab)});
    if(recovered===true){
      advanced=false;return waitForIndex(checkpoint);
    }
    if(recovered&&reopenWorkTab){
      const fresh=await reopenWorkTab(recovered);
      if(fresh.url!==url)throw scopeError();
      tabId=fresh.id;advanced=false;
    }
    // User-owned or unrecognised pages need fresh index evidence.
    return read();
  }
  function sameIndex(before,after){
    return after.documentId===before.documentId && JSON.stringify(after.options.labels)===JSON.stringify(before.options.labels) &&
      after.options.tableId===before.options.tableId && after.options.title===before.options.title;
  }
  async function turn(index,advance,allowRefresh=false){
    const expected=JSON.stringify(rowsInColumnOrder(index.data.rows,index.options.labels));
    const deadline=Date.now()+loadLimit;
    const loadingTimer=workTab?setInterval(()=>onLoading(Math.max(0,deadline-Date.now())),2000):null;
    let next;
    try{
      next=await execute({...index.options,advance,expected,priorPosition:index.data.position,workTab});
    }finally{if(loadingTimer!==null)clearInterval(loadingTimer);}
    if(next?.loading && workTab)throw loadTimeout();
    if(next?.staleBeforeAdvance){
      if(!allowRefresh)throw Error('Isi tabel berubah sejak pengambilan. Pilih ulang tabel.');
      const fresh=await read();
      if(!sameIndex(index,fresh)||JSON.stringify(index.data.position)!==JSON.stringify(fresh.data.position))throw scopeError();
      return {...fresh,recheck:true};
    }
    if(!next?.indexScope)throw Error('Halaman daftar belum berubah atau sumber tidak lagi cocok.');
    const fresh=await read();
    if(!sameIndex(index,fresh) ||
        JSON.stringify(next.position)!==JSON.stringify(fresh.data.position) ||
        JSON.stringify(rowsInColumnOrder(next.rows,index.options.labels))!==JSON.stringify(rowsInColumnOrder(fresh.data.rows,fresh.options.labels)))throw scopeError();
    return fresh;
  }
  return {get tabId(){return tabId;},find,restore,read,turn};
}

export async function collectSptQueue({directory,candidates,limit,indexLimit,checkpoint,createSink,onOpen,onSettled=()=>{}}){
  const remaining=new Set(candidates);
  const result={attempted:0,withPages:0,pages:0,problem:null};
  const fatal=error=>['IDENTITY','STOP','SCOPE','HOME_ACCOUNT'].includes(error?.code);
  try{
    for(const missing of [true,false]){
      const group=candidates.filter(c=>c.doc.parts.some(p=>p.status!=='ready')===missing);
      while(group.length){
        await checkpoint();
        let candidate;
        try{candidate=await directory.find(group,{checkpoint,limit:indexLimit});}
        catch(error){
          if(fatal(error))throw error;
          result.problem=error;
          for(const c of group){createSink(c).finish(error);remaining.delete(c);}
          break;
        }
        group.splice(group.indexOf(candidate),1);remaining.delete(candidate);
        const {navigation}=candidate,sink=createSink(candidate);
        let view,failure;
        result.attempted++;
        try{
          await checkpoint();onOpen(candidate);
          view=await navigation.open(directory.tabId,checkpoint);
          await navigation.collect(view,{limit,checkpoint,...sink});
        }catch(error){failure=error;}
        if(!fatal(failure)){
          try{await directory.restore(candidate,view,checkpoint,failure);}
          catch(error){
            if(failure)sink.onIssue({label:'Pembukaan SPT'},failure);
            failure=Object.assign(error,{code:error.code || 'SCOPE'});
          }
        }
        const saved=sink.finish(failure);
        if(saved.pages){result.withPages++;result.pages+=saved.pages;}
        if(saved.reused)result.reused=(result.reused||0)+saved.reused;
        if(saved.issues.length)result.problem=new Error(saved.issues.at(-1));
        onSettled(result.attempted);
        if(fatal(failure))throw failure;
      }
    }
  }catch(error){
    result.problem=error;
    for(const candidate of remaining)createSink(candidate).finish(error);
  }
  return result;
}
