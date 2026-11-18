import {benchmarkAnalysis,benchmarkMetrics,validateBenchmark} from './benchmark-work.js';
import {box,button,card,dataTable,download,el,field,notice,select} from './ui.js';

export function benchmarkPanel(pkg,year,references,onSave){
  const root=el('div'),initial=benchmarkAnalysis(pkg,year,references);
  if(!initial)return root;
  let current=validateBenchmark(references);
  const wp=pkg.manifest.wp,status=el('p');status.setAttribute('role','status');
  const name=el('input'),source=el('input'),klu=el('input'),period=el('input'),target=el('input'),rate=el('input'),rateSource=el('input');
  period.type='number';period.value=String(year);klu.value=initial.klu.code;
  for(const i of [target,rate]){i.type='number';i.step='any';}
  let metric='CTTOR';
  const taxFields=box('formgrid',field('Tarif simulasi (%)',rate),field('Rujukan tarif',rateSource));taxFields.hidden=true;
  const selectMetric=select(benchmarkMetrics,metric,v=>{metric=v;taxFields.hidden=v!=='NPM';},'Rasio acuan');
  const list=el('div'),picker=el('input');picker.type='file';picker.accept='.json,application/json';picker.className='hidden-file';
  function commit(next,message){
    const rows=validateBenchmark(next);
    if(!root.isConnected)throw Error('Pilihan paket atau tahun berubah. Buka kembali kertas kerja tahun yang dituju.');
    onSave(rows);current=rows;render();status.textContent=message;
  }
  function render(){
    const {scenarios}=benchmarkAnalysis(pkg,year,current);
    list.replaceChildren();
    if(scenarios.length)list.append(dataTable(scenarios,{name:'Skenario benchmark',wp}));
    else list.append(el('p','Belum ada acuan sektoral untuk WP dan tahun ini.'));
    if(current.length){
      let index=0;
      list.append(box('toolbar',select(current.map((r,i)=>[String(i),r.name+' · '+r.metric+' · '+r.year+' · '+r.klu]),'0',
        v=>{index=Number(v);},'Acuan yang disimpan'),button('Keluarkan acuan',()=>{
          try{commit(current.filter((_,i)=>i!==index),'Acuan dikeluarkan dari kertas kerja tahun ini.');}catch(e){notice(e.message,true);}
        })));
    }
  }
  const add=button('Tambahkan acuan',()=>{
    const next={name:name.value,source:source.value,year:period.valueAsNumber,klu:klu.value,metric,target:target.valueAsNumber};
    if(metric==='NPM')Object.assign(next,{taxRate:rate.valueAsNumber,taxRateSource:rateSource.value});
    try{commit([...current,next],'Acuan ditambahkan.');}catch(e){notice(e.message,true);}
  });
  picker.onchange=async()=>{
    const file=picker.files?.[0];if(!file)return;
    try{
      const input=JSON.parse(await file.text());
      const rows=validateBenchmark(input);
      if(!rows.length)throw Error('Berkas acuan kosong.');
      commit([...current,...rows],rows.length+' acuan diimpor dari '+file.name+'.');
    }catch(e){notice('Impor acuan gagal. '+e.message,true);}finally{picker.value='';}
  };
  const example=()=>download(new Blob([JSON.stringify([{name:'Contoh fiktif',source:'Tabel contoh A, baris 3',year:Number(year),
    klu:'251',metric:'CTTOR',target:1.25},{name:'Contoh fiktif',source:'Tabel contoh B, baris 3',year:Number(year),
    klu:'251',metric:'NPM',target:4,taxRate:20,taxRateSource:'Asumsi ilustrasi fiktif'}],null,2)],{type:'application/json'}),'Contoh-acuan-benchmark.json');
  const details=el('details');details.append(el('summary','Tambahkan atau impor acuan'),
    box('formgrid',field('Nama skenario',name),field('Rujukan acuan',source),field('Tahun data acuan',period),field('Kode KLU cakupan',klu),
      selectMetric,field('Nilai acuan (%)',target)),taxFields,box('toolbar',add,button('Impor acuan JSON',()=>picker.click()),button('Unduh contoh acuan',example),picker));
  root.append(card('Benchmark dan simulasi tax gap',el('p','KLU WP '+(initial.klu.code||'belum diketahui')+' · '+initial.klu.basis),
    dataTable(initial.ratios,{name:'Rasio benchmark WP',wp}),details,list,status));
  render();return root;
}
