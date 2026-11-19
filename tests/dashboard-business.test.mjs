import assert from 'node:assert/strict';
import test from 'node:test';
import {dashboardBusiness} from '../extension/analisis/dashboard-follow-up.js';

const wp='0000000000000017',other='0000000000000018';
const activity=(code='01262',more={})=>({TradeClassificationCode:code,ActivityDescription:'Kegiatan fiktif',
  IsMainEconomicCode:true,ValidFrom:'2024-01-01',ValidTo:'2025-12-31',...more});
const entry=(source,data,id=wp)=>({cap:{sumber:source,konteks:{npwp:id},lengkap:true},pages:[{IsSuccessful:true,Payload:{Data:data}}]});
const pkg=(...entries)=>({manifest:{wp:{npwp:wp},dibuat:'2026-11-18'},report:{valid:true},entries});
const profile=owner=>entry('info',[{GeneralInformation:{UniqueIdentificationNumber:owner},MainEconomicCode:activity()}]);

test('dashboard identifies the registered main activity for the selected year, including the registration in the WP profile',()=>{
  const input=pkg(profile(wp),entry('klu',[activity()]));
  assert.equal(dashboardBusiness(input,'2025').code,'01262');
  assert.equal(dashboardBusiness(input,'2026'),null);
  assert.equal(dashboardBusiness(pkg(profile(wp)),'2025').title,'Kegiatan fiktif');
  assert.equal(dashboardBusiness(input,'2026',{code:'01111',title:'Acuan petugas'}).title,'Acuan petugas');
});
test('ambiguous registrations, different owner, and failed or incomplete sources do not establish a dashboard sector',()=>{
  assert.equal(dashboardBusiness(pkg(entry('klu',[activity(),activity('01111')])),'2025'),null);
  assert.equal(dashboardBusiness(pkg(profile(other)),'2025'),null);
  assert.equal(dashboardBusiness(pkg(entry('klu',[activity()],other)),'2025'),null);
  assert.equal(dashboardBusiness(pkg(entry('klu',[activity('01262',{NPWP:other})])),'2025'),null);
  const partial=profile(wp);partial.cap.lengkap=false;assert.equal(dashboardBusiness(pkg(partial),'2025'),null);
  partial.cap.lengkap=true;partial.pages[0].IsSuccessful=false;assert.equal(dashboardBusiness(pkg(partial),'2025'),null);
  const invalid=pkg(profile(wp));invalid.report.valid=false;assert.equal(dashboardBusiness(invalid,'2025'),null);
});
