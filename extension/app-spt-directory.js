import {rowsInColumnOrder,visibleTables} from './app-data.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const scopeError=()=>Object.assign(Error('Daftar SPT awal atau WP pada daftar sudah berubah. Periksa kembali tab sumber.'),{code:'SCOPE'});

// Keep only an index that was verified through the same table adapter used by manual capture.
export async function sptDirectory(ext,tabId,wp) {
  const url=(await ext.tabs.get(tabId)).url;
  const execute=async options=>(await ext.scripting.executeScript({target:{tabId},func:visibleTables,args:[options]}))[0]?.result;
  async function read(){
    if((await ext.tabs.get(tabId)).url!==url)throw scopeError();
    const tables=await execute(null);
    if(!Array.isArray(tables))throw scopeError();
    const indexes=tables.filter(t=>t.indexSource==='sptdaftar');
    if(indexes.length!==1)throw scopeError();
    const options={...indexes[0],url,scope:{wp,source:'sptdaftar',manual:true}};
    const data=await execute(options);
    if(!data?.indexScope)throw scopeError();
    return {options,data};
  }
  await read();
  let advanced=false;
  async function waitForIndex(checkpoint){
    for(let attempt=0;attempt<20;attempt++){
      await wait(150);await checkpoint();
      try{return await read();}catch{}
    }
    throw scopeError();
  }
  async function find(candidates,{checkpoint,limit}){
    let index=await read(),seen=new Set();
    const findMatch=()=>candidates.find(c=>index.data.rows.some(c.navigation.matches));
    let selected=findMatch();
    if(selected)return selected;
    if(index.data.canFirst){
      await checkpoint();
      const ordered=rowsInColumnOrder(index.data.rows,index.options.labels);
      const first=await execute({...index.options,advance:'first',expected:JSON.stringify(ordered)});
      if(!first?.indexScope){
        await read();throw Error('Tombol halaman pertama atau isi daftar sudah berubah.');
      }
      advanced=false;index=await read();
    }else if(advanced){
      await checkpoint();
      if(!(await execute({...index.options,restartIndex:true}))?.returning)throw scopeError();
      advanced=false;index=await waitForIndex(checkpoint);
    }
    for(let page=1;;page++){
      await checkpoint();
      selected=findMatch();if(selected)return selected;
      // Ignore row order when detecting a cycle. Re-read the live row again before opening a form.
      const fingerprint=JSON.stringify(index.data.rows.map(r=>JSON.stringify(r)).sort());
      if(seen.has(fingerprint))throw Error('Halaman daftar berulang sebelum versi ditemukan.');
      seen.add(fingerprint);
      if(!index.data.canAdvance)throw Error('Versi belum ditemukan pada halaman daftar yang dapat dijangkau.');
      if(page>=limit)throw Error('Batas pencarian halaman daftar tercapai.');
      const ordered=rowsInColumnOrder(index.data.rows,index.options.labels);
      const next=await execute({...index.options,advance:true,expected:JSON.stringify(ordered)});
      if(next?.end)throw Error('Halaman daftar berikutnya sudah tidak tersedia.');
      if(!next){
        await read();
        throw Error('Halaman daftar berikutnya belum berubah atau baris sempat diurutkan ulang.');
      }
      if(!next?.indexScope)throw scopeError();
      advanced=true;index=await read();
    }
  }
  async function restore(candidate,view,checkpoint){
    await checkpoint();
    if(view){
      await candidate.navigation.returnToIndex(view,url,tabId);
      if(view.tabId===tabId)advanced=false;
      return waitForIndex(checkpoint);
    }
    // An unreadable form in the original tab must not be redirected automatically.
    return read();
  }
  return {find,restore};
}

export async function collectSptQueue({directory,candidates,tabId,limit,indexLimit,checkpoint,createSink,onOpen}){
  const remaining=new Set(candidates);
  const result={attempted:0,withPages:0,pages:0,problem:null};
  const fatal=error=>['IDENTITY','STOP','SCOPE'].includes(error?.code);
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
          view=await navigation.open(tabId);
          await navigation.collect(view,{limit,checkpoint,...sink});
        }catch(error){failure=error;}
        if(!fatal(failure)){
          try{await directory.restore(candidate,view,checkpoint);}
          catch(error){
            if(failure)sink.onIssue({label:'Pembukaan SPT'},failure);
            failure=Object.assign(error,{code:error.code || 'SCOPE'});
          }
        }
        const saved=sink.finish(failure);
        if(saved.pages){result.withPages++;result.pages+=saved.pages;}
        if(saved.issues.length)result.problem=new Error(saved.issues.at(-1));
        if(fatal(failure))throw failure;
      }
    }
  }catch(error){
    result.problem=error;
    for(const candidate of remaining)createSink(candidate).finish(error);
  }
  return result;
}
