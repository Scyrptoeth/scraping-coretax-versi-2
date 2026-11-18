import {createXlsx} from '../archive/table.js';
import {compare, count, selectRows, serialize, worksheet} from './model.js';

export function el(tag, content, classes) {
  const element = document.createElement(tag);
  if (content !== undefined && content !== null) element.textContent = content;
  if (classes) element.className = classes;
  return element;
}
export function box(cls, ...children) {
  const node = el('div',null,cls); node.append(...children.filter(Boolean)); return node;
}
export function button(text, action, cls='secondary') {
  const b = el('button',text,cls); b.type='button'; b.addEventListener('click',action); return b;
}
export function select(values, value, onchange, title) {
  const input = el('select');
  input.setAttribute('aria-label',title);
  for (const item of values) {
    const [key,text] = Array.isArray(item) ? item : [item,item];
    const option = el('option',text); option.value=key; input.append(option);
  }
  input.value=value; input.onchange=()=>onchange(input.value);
  const field=el('label',title,'label'); field.append(input); return field;
}
export function field(title, control) {const l=el('label',title,'field');l.append(control);return l;}
export function card(title, ...children) {
  return box('card',title ? el('h2',title) : null,...children);
}
export function detail(title,node) {
  const d=el('details'); d.append(el('summary',title),node);return d;
}
export function toggleSet(values, selected, action) {
  return box('chips',...values.map(([key,title])=>{
    const b=button(title,()=>action(key));b.setAttribute('aria-pressed',String(key===selected));return b;
  }));
}
export function download(blob,name) {
  const url=URL.createObjectURL(blob); const link=el('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),20000);
}
export function notice(message,error=false) {
  const n=document.getElementById('status');n.textContent=message;n.hidden=!message;n.className=error?'notice error':'notice';
}
export function showDialog(title,content) {
  const d=document.getElementById('dialog');document.getElementById('dialog-title').textContent=title;
  document.getElementById('dialog-body').replaceChildren(content); if(!d.open)d.showModal();return d;
}
export function exportSheets(sheets, filename) {
  return createXlsx({sheets}).then(blob=>download(blob,filename+'.xlsx')).catch(error=>notice('Excel gagal dibuat. '+error.message,true));
}
export function dataTable(rows, {name='Tabel',openRow,filename='Tabel',empty='Tidak ada baris pada sumber ini.',formatNumber=count,incremental=false}={}) {
  const root=box('table-panel');
  if (!rows.length) {root.append(el('p',empty,'hint'));return root;}
  const search=el('input');search.type='search';search.placeholder='Cari di tabel';search.setAttribute('aria-label','Cari di tabel '+name);
  const area=box('scroll');const pager=box('pager'); const pageSize=incremental?200:50;
  let index=0,order={key:'',dir:1},visible=rows;
  const keys=[...new Set(rows.flatMap(Object.keys))];
  const tools=box('toolbar',search,button('Excel bagian ini',()=>exportSheets([{name,rows:worksheet(selectRows(rows,search.value,order))}],filename)));
  root.append(tools,area,pager);
  function appendRows(body,from,to) {
    const fragment=document.createDocumentFragment();
    for(const row of visible.slice(from,to)){
      const tr=el('tr');
      if(openRow){const cell=el('td');cell.append(button('Buka',()=>openRow(row)));tr.append(cell);}
      for(const key of keys){
        const td=el('td');const value=row[key];const txt=typeof value==='number'?formatNumber(value):(serialize(value)||'—');
        if(txt.length>60){
          const b=button(txt.slice(0,50)+'…',()=>showDialog(key,el('pre',txt)));b.title='Lihat nilai lengkap';td.append(b);
        }else td.textContent=txt;
        tr.append(td);
      }
      fragment.append(tr);
    }
    body.append(fragment);
  }
  function render() {
    visible=selectRows(rows,search.value,order);
    const last=Math.max(0,Math.ceil(visible.length/pageSize)-1);index=Math.min(index,last);
    const table=el('table');table.setAttribute('aria-label',name);const headings=el('tr');const head=el('thead');const body=el('tbody');
    if(openRow)headings.append(el('th','Rincian'));
    for(const key of keys){
      const th=el('th');th.scope='col';th.setAttribute('aria-sort',order.key===key?(order.dir===1?'ascending':'descending'):'none');
      th.append(button(key+(order.key===key?(order.dir===1?' ↑':' ↓'):''),()=>{order={key,dir:order.key===key?-order.dir:1};index=0;render();},''));headings.append(th);
    }
    head.append(headings);
    appendRows(body,index*pageSize,(index+1)*pageSize);
    table.append(head,body);area.replaceChildren(table);
    if(incremental){
      let shown=Math.min(pageSize,visible.length);
      const progress=el('small');progress.setAttribute('role','status');
      const more=button('Tampilkan 1.000 baris lagi',()=>{
        const end=Math.min(shown+1000,visible.length);
        appendRows(body,shown,end);shown=end;update();
      });
      function update(){progress.textContent=count(shown)+' dari '+count(visible.length)+' baris ditampilkan';more.hidden=shown>=visible.length;}
      update();pager.replaceChildren(progress,more);return;
    }
    const prev=button('Sebelumnya',()=>{index--;render();});prev.disabled=index===0;
    const next=button('Berikutnya',()=>{index++;render();});next.disabled=index===last;
    pager.replaceChildren(prev,el('small',count(visible.length)+' baris · Halaman '+(index+1)+' dari '+(last+1)),next);
  }
  let timer;
  search.oninput=()=>{index=0;if(incremental){clearTimeout(timer);timer=setTimeout(render,150);}else render();};render();return root;
}
export function namedGroups(rows, key) {
  return [...new Set(rows.map(r=>r[key]).filter(Boolean))].sort(compare);
}
