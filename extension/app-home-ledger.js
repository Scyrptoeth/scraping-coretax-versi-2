const monthNames='Januari Februari Maret April Mei Juni Juli Agustus September Oktober November Desember'.split(' ');
export function ledgerMonthLabel(month){
  const [year,value,last]=month.split('-');
  if(last)return monthNames[Number(value)-1]+' - '+monthNames[Number(last)-1]+' '+year;
  return monthNames[Number(value)-1]+' '+year;
}
export function ledgerCode(period){
  const [year,first,last]=period.split('-');
  return first+(last||first)+year;
}
function visibleRange(label,year){
  const raw=String(label).trim().match(/^(\p{L}+)\s*[-–]\s*(\p{L}+)\s+(\d{4})$/u);
  if(!raw||raw[3]!==String(year))return null;
  const first=monthNames.indexOf(raw[1])+1,last=monthNames.indexOf(raw[2])+1;
  return first>0&&last>first?[year,String(first).padStart(2,'0'),String(last).padStart(2,'0')].join('-'):null;
}

// Operate on the period picker that belongs to the transaction grid, in the
// taxpayer's balance sheet. Prove that its results refreshed before reading.
export async function ledgerControls({url,wp,action,label}){
  if(location.origin!=='https://coretax.intranet.pajak.go.id'||location.href!==url||
    !/^\/accounting\/id-ID\/balancesheet\/[a-f\d-]+\/?$/i.test(location.pathname))return null;
  const visible=el=>el?.getClientRects().length>0 && el.checkVisibility({visibilityProperty:true,opacityProperty:true});
  const all=(root,sel)=>[...root.querySelectorAll(sel)].filter(visible);
  const compact=v=>String(v||'').replace(/\s+/g,' ').trim();
  const ownerNodes=all(document,'shared-left-menu p.ct-title-white').map(n=>compact(n.innerText).replace(/[.\s-]/g,'')).filter(v=>/^\d{15,16}$/.test(v));
  if(!ownerNodes.length)return null;
  if(ownerNodes.some(value=>value.padStart(16,'0')!==wp))return {identityError:true};
  function summaryRow(key){
    const candidates=all(document,'table').filter(t=>all(t,'thead tr').some(tr=>
      ['Debit','Kredit','Debit Tersisa','Kredit Tersisa','Saldo'].every(h=>[...tr.cells].some(cell=>compact(cell.innerText)===h))));
    const matches=candidates.flatMap(t=>all(t,'thead tr,tfoot tr').filter(tr=>compact(tr.cells[0]?.innerText)===key));
    return matches.length===1?matches[0]:null;
  }
  async function refresh(button,grid,key){
    const before=summaryRow(key),old=compact(before?.innerText);
    let touched=false,lastChange=Date.now(),summaryChanged=false;
    const watcher=new MutationObserver(changes=>{
      for(const c of changes){
        const el=c.target.nodeType===1?c.target:c.target.parentElement;
        if(before?.contains(el)){summaryChanged=true;lastChange=Date.now();}
        if(!grid||!grid.contains(el))continue;
        if(el?.closest('tbody,.p-paginator-current')||[...c.addedNodes,...c.removedNodes].some(n=>n.nodeType===1 &&
          (n.matches('tbody,.p-datatable-loading-overlay,.p-paginator-current')||n.querySelector('tbody,.p-datatable-loading-overlay')))){
          touched=true;lastChange=Date.now();
        }
      }
    });
    watcher.observe(document.body,{subtree:true,characterData:true,childList:true});
    try{
      button.click();
      const deadline=Date.now()+6000;
      while(Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,120));
        if(location.href!==url)return {ok:false};
        const summary=summaryRow(key);
        const totalsRefreshed=Boolean(summary&&(summaryChanged||summary!==before||old!==compact(summary.innerText)));
        const settled=!all(grid||document,'[aria-busy=true],.p-datatable-loading-overlay,[data-pc-section=loadingoverlay]').length;
        if(settled&&Date.now()-lastChange>=300&&(grid?touched:true)&&totalsRefreshed)return {ok:true,refreshed:true,totalsRefreshed:true};
        if(grid&&touched&&settled&&Date.now()-lastChange>1200)return {ok:true,refreshed:true,totalsRefreshed:false};
      }
      return {ok:true,refreshed:false,totalsRefreshed:false};
    }finally{watcher.disconnect();}
  }
  if(action==='initial'){
    const buttons=all(document,'button#submit').filter(b=>compact(b.innerText).toLowerCase()==='cari'&&!b.disabled);
    return buttons.length===1?refresh(buttons[0],null,'Total'):{ok:false};
  }
  const cancellation=document.getElementById('ShowCancelledTransaction');
  const cancelled=()=>compact(cancellation?.querySelector('.p-dropdown-label')?.innerText);
  if(action==='cancel'){
    const observed=cancelled();
    if(observed===label)return {ok:true,cancelled:observed};
    const caption=all(document,'label[for=ShowCancelledTransaction]');
    const trigger=cancellation?.querySelector('.p-dropdown-trigger');
    if(caption.length!==1||!/^tampilkan transaksi yang dibatalkan\s*:?$/i.test(compact(caption[0].innerText))||!visible(trigger)||
        !['Yes','No'].includes(observed)||!['Yes','No'].includes(label)||all(document,'.p-dropdown-panel').length)return {ok:false,cancelled:observed};
    trigger.click();
    let chosen=false;
    for(let n=0;n<15;n++){
      await new Promise(resolve=>setTimeout(resolve,80));
      if(location.href!==url||!document.contains(cancellation))return {ok:false};
      if(chosen && cancelled()===label)return {ok:true,cancelled:label};
      const panel=all(document,'.p-dropdown-panel');
      if(!chosen&&panel.length===1){
        const valid=all(panel[0],'[role=option]').filter(o=>compact(o.getAttribute('aria-label')||o.innerText)===label&&o.getAttribute('aria-disabled')!=='true');
        if(valid.length===1){valid[0].click();chosen=true;}
      }
    }
    if(!chosen&&all(document,'.p-dropdown-panel').length===1)trigger.click();
    return {ok:false,cancelled:cancelled()};
  }
  const controls=all(document,'input[role=combobox][placeholder="Pilih Masa Pajak"]');
  if(controls.length!==1)return null;
  const picker=controls[0].closest('.p-dropdown'),table=controls[0].closest('table');
  if(!picker||!table||!all(table,'th').some(h=>compact(h.innerText)==='Masa Pajak'))return null;
  const displayed=[controls[0].value,...all(picker,'.p-dropdown-label').map(n=>n.value||n.innerText)].map(compact);
  const selected=displayed.includes(label);
  const totals=[];
  for(const candidate of all(document,'table')){
    const cols=all(candidate,'thead tr').map(tr=>[...tr.cells].map(c=>compact(c.innerText)))
      .find(head=>['Debit','Kredit','Debit Tersisa','Kredit Tersisa','Saldo'].every(c=>head.includes(c)));
    if(!cols)continue;
    for(const tr of all(candidate,'thead tr,tfoot tr')){
      const cells=[...tr.cells].map(td=>compact(td.innerText));
      if(cells.length!==cols.length||!['Total','Filtered'].includes(cells[0])||!cells.slice(1).every(Boolean))continue;
      totals.push(Object.fromEntries(cols.map((name,i)=>[i===0?'Key':name,cells[i]])));
    }
  }
  if(action==='state'){
    const applied=all(table,'thead .p-column-filter-menu-button-active,thead .p-datatable-column-filter-button-active,thead .p-column-filter-active');
    const monthColumn=controls[0].closest('th')?.cellIndex;
    const otherFilters=applied.some(el=>monthColumn===undefined||el.closest('th')?.cellIndex!==monthColumn) ||
      all(table,'thead input,thead select').some(input=>!picker.contains(input) &&
        (input.type==='checkbox'||input.type==='radio'?input.checked:Boolean(input.value.trim())));
    return {selected,totals,cancelled:cancelled(),otherFilters};
  }
  let panels=all(document,'.p-dropdown-panel');
  if(action==='open'){
    const trigger=picker.querySelector('.p-dropdown-trigger');
    if(!visible(trigger)||panels.length)return {ok:false};
    trigger.click();return {ok:true};
  }
  if(panels.length!==1)return {ok:false};
  const panel=panels[0],associated=controls[0].getAttribute('aria-controls');
  if(associated && !panel.contains(document.getElementById(associated)))return {ok:false};
  if(action==='search'){
    const fields=all(panel,'input.p-dropdown-filter');
    if(fields.length!==1)return {ok:false};
    fields[0].value=label;fields[0].dispatchEvent(new Event('input',{bubbles:true}));return {ok:true};
  }
  if(action==='ranges'){
    const box=panel.querySelector('.p-dropdown-items-wrapper,.p-scroller,[role=listbox]');
    const values=new Set();
    for(let n=0;n<80;n++){
      await new Promise(resolve=>setTimeout(resolve,90));
      if(location.href!==url||!panel.isConnected)return {values:[],end:false};
      for(const option of all(panel,'[role=option]'))values.add(compact(option.getAttribute('aria-label')||option.innerText));
      if(!box||box.scrollTop+box.clientHeight>=box.scrollHeight-1)return {values:[...values],end:true};
      box.scrollTop+=Math.max(1,Math.floor(box.clientHeight*0.8));
    }
    return {values:[...values],end:false};
  }
  if(action==='choose'){
    const options=all(panel,'[role=option]').filter(o=>compact(o.getAttribute('aria-label')||o.innerText)===label&&o.getAttribute('aria-disabled')!=='true');
    if(options.length!==1)return {ok:false};
    const host=table.closest('p-table,.p-datatable,[data-pc-name=datatable]')||table.parentElement;
    return refresh(options[0],host,'Filtered');
  }
  if(action==='dismiss'){
    const trigger=picker.querySelector('.p-dropdown-trigger');
    if(visible(trigger))trigger.click();
  }
  return {ok:false};
}

export async function ledgerYearRanges({run,id,url,wp,years,checkpoint}){
  const choices=new Set(),unconfirmed=[];
  for(const year of years){
    const act=async action=>{
      await checkpoint();
      const data=await run(id,ledgerControls,{url,wp,action,label:String(year)});
      if(data?.identityError)throw Object.assign(Error('NPWP pada buku besar berubah.'),{code:'IDENTITY'});
      return data;
    };
    choices.add(year+'-01-12');
    if(!(await act('open'))?.ok){unconfirmed.push(year);continue;}
    try{
      if(!(await act('search'))?.ok){unconfirmed.push(year);continue;}
      const options=await act('ranges');
      if(!options?.end||!options.values.some(v=>v.endsWith(' '+year)))unconfirmed.push(year);
      for(const label of options?.values||[]){const value=visibleRange(label,year);if(value)choices.add(value);}
    }finally{await act('dismiss');}
  }
  return {choices:[...choices],unconfirmed};
}

export async function selectLedgerMonth({run,id,url,wp,month,checkpoint}){
  const label=ledgerMonthLabel(month);
  const act=async action=>{
    await checkpoint();
    const value=await run(id,ledgerControls,{url,wp,action,label});
    if(value?.identityError)throw Object.assign(Error('NPWP pada buku besar berubah.'),{code:'IDENTITY'});
    return value;
  };
  const initial=await act('state');
  if(!initial)return null;
  if(initial.selected)return {label,initial:true};
  if(!(await act('open'))?.ok)throw Error('Pilihan masa buku besar belum dapat dibuka.');
  try{
    if(!(await act('search'))?.ok)throw Error('Kolom pencarian masa buku besar belum tersedia.');
    for(let n=0;n<10;n++){
      const selected=await act('choose');
      if(selected?.ok){
        if(!(await act('state'))?.selected)throw Error('Masa yang tampil berbeda dari masa yang dipilih.');
        return {label,refreshed:selected.refreshed,totalsRefreshed:selected.totalsRefreshed};
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('Pilihan masa ini belum ditemukan pada Coretax.');
  }finally{await act('dismiss');}
}
