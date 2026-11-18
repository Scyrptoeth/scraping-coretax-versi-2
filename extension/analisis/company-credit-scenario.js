import {companyAssessment} from './assessment-company.js';
import {directCreditFindings} from './direct-finding-credits.js';
import {simulate} from './sanksi.js';

export function companyCreditScenario(pkg,year,work,index,projection=companyAssessment(pkg,year,work,index)){
  const data=projection?.components;
  if(!Number.isSafeInteger(data?.declaredTax)||!Number.isSafeInteger(data.projectedTax))return null;
  const estimate=directCreditFindings(pkg,year).scenario;
  if(!estimate)return null;
  const {reportedBalance,creditChange,period,source,assumption}=estimate;
  const revised=reportedBalance+data.projectedTax-data.declaredTax-creditChange;
  if(!Number.isSafeInteger(revised))return null;
  const principal=Math.max(0,Math.max(0,revised)-Math.max(0,reportedBalance));
  const simulated=principal&&period?simulate({tax:'PPh Badan',period,article:'interest',principal:String(principal),
    transfers:[],basis:'Skenario B.7 dan kredit dalam paket'},work.simulation?.end||''):null;
  const interest=principal===0?0:simulated?.interest!=null?Number(simulated.interest/10000n):null;
  return {principal,interest,total:Number.isSafeInteger(interest)&&Number.isSafeInteger(principal+interest)?principal+interest:null,
    months:simulated?.months??null,period,source,assumption,notes:[assumption,...projection.notes,...(simulated?.reason?[simulated.reason]:[])]};
}
