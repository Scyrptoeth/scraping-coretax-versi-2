import {differenceCell,groupedAmountCell,numericReference,ratioCell,signedSumCell} from '../archive/table.js';

// The screen and Word keep their source values. Excel also carries their dependencies.
export function wireKkaWorkbook(recap,financial,numberOfKinds,numberOfFindings){
  recap.rows=recap.rows.map(row=>row.slice());
  financial.rows=financial.rows.map(row=>row.slice());
  const section=(sheet,name)=>sheet.targets.find(t=>t.name===name).row;
  const recapStart=section(recap,'KKA_L7_5')+2,first=section(recap,'KKA_L7_5_1')+2;
  const last=first+numberOfFindings-1,total=recapStart+numberOfKinds;
  if(numberOfFindings){
    for(let row=recapStart;row<=total;row++){
      const cells=recap.rows[row-1];
      const group={first,last,kindColumn:1,basisColumn:4,amountColumn:8,groupRow:row===total?null:row};
      for(const [column,operation] of [[2,'count'],[3,'sum'],[4,'unpriced'],[5,'sum'],[6,'sum'],[7,'sum']]){
        const basis=column>=5?recap.rows[recapStart-2][column-1].replace(' (Rp)',''):null;
        cells[column-1]=groupedAmountCell({...group,basis},operation,cells[column-1]);
      }
    }
  }

  const comparison=section(financial,'KKA_L13_4_1')+2;
  for(let i=comparison-1;financial.rows[i]?.length>1;i++){
    const cells=financial.rows[i],row=i+1;
    cells[3]=differenceCell(row,2,3,cells[3]);
    cells[4]=ratioCell({row,column:4},{row,column:2},cells[4],{percentageChange:true});
  }

  const cashHeader=financial.rows.findIndex(r=>r[0]==='Komponen'&&r[1]==='Nilai (Rp)');
  const sumIndex=financial.rows.findIndex((r,i)=>i>cashHeader&&r[0]==='Perkiraan arus kas operasi');
  const terms=financial.rows.slice(cashHeader+1,sumIndex).map((_,i)=>({row:cashHeader+i+2,sign:1}));
  const cash=financial.rows[sumIndex];cash[1]=signedSumCell(terms,2,cash[1]);
  const start=section(financial,'KKA_L13_5_3')+2;
  const positions=new Map();
  for(let i=start-1;financial.rows[i]?.length>1;i++)positions.set(financial.rows[i][0],i+1);
  const set=(name,make)=>{
    const row=positions.get(name),cells=financial.rows[row-1];cells[1]=make(cells[1]);
  };
  if(numberOfFindings)set('Potensi pokok pajak',v=>numericReference(recap,total,3,v));
  set('Perkiraan arus kas operasi',v=>numericReference(financial,sumIndex+1,2,v));
  set('Modal kerja',v=>signedSumCell([{row:positions.get('Aset lancar'),sign:1},{row:positions.get('Utang lancar'),sign:-1}],2,v));
  for(const [label,source] of [['Kas','Kas dan setara kas'],['Modal kerja','Modal kerja'],['Perkiraan arus kas operasi','Perkiraan arus kas operasi']]){
    set(label+' terhadap potensi pokok',v=>ratioCell({row:positions.get(source),column:2},{row:positions.get('Potensi pokok pajak'),column:2},v));
  }
}
