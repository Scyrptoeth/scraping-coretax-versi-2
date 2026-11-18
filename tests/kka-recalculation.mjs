import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Optional integration test. Requires Playwright, Chrome, openpyxl and LibreOffice.
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const extension=resolve(process.env.EXTENSION_DIR||'extension');
const fixture=join(process.env.VERITAX_FIXTURES||'01-VERITAX_v1.32.0','CONTOH-paket-DEMO-FIKTIF.zip');
const temp=await mkdtemp(join(tmpdir(),'kka-calc-'));
let browser;
try{
  browser=await chromium.launchPersistentContext(join(temp,'chrome'),{headless:true,offline:true,channel:'chromium',
    executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension]});
  const sw=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),p=await browser.newPage();
  await p.goto(new URL('analisis/index.html',sw.url()).href);await p.locator('#role').selectOption('AR');
  await p.locator('#filePkg').setInputFiles(fixture);await p.getByText(/Konsisten · Seluruh sidik jari/).waitFor();
  await p.getByRole('navigation').getByRole('button',{name:'Kertas Kerja',exact:true}).click();
  await p.getByRole('button',{name:'KKA',exact:true}).click();await p.getByLabel('Tahun pajak',{exact:true}).selectOption('2025');
  const [d]=await Promise.all([p.waitForEvent('download'),p.getByRole('button',{name:'Excel kertas kerja',exact:true}).click()]);
  await d.saveAs(join(temp,'original.xlsx'));await browser.close();browser=null;
  execFileSync(process.env.PYTHON||'python3',['-c',`
from math import isclose
from pathlib import Path
import subprocess,sys
from openpyxl import load_workbook

temp=Path(sys.argv[1])
output=temp/'recalculated'
output.mkdir()
original=temp/'original.xlsx'
baseline=load_workbook(original,data_only=True)
def sheet(book,prefix):
    return next(s for s in book if s.title.startswith(prefix))
def find(s,label,column=1,start=1):
    return next(i for i in range(start,s.max_row+1) if s.cell(i,column).value==label)
def at(s,row,column=2):
    return s.cell(row,column).value
recap=sheet(baseline,'L-7 ')
financial=sheet(baseline,'L-13')
tax=find(recap,'PPN')
total=find(recap,'Jumlah')
facility=find(recap,'N.5',5)
loan=find(recap,'B.4',5)
assert at(recap,facility,8)>0 and at(recap,loan,8) is None
header=find(recap,'Pokok dalam lingkup (Rp)',8)
details=[i for i in range(header+1,recap.max_row+1) if at(recap,i,3) in ('berbukti','indikatif')]
assert facility in details and loan in details
sales=find(financial,'Peredaran usaha')
firstCashLine=find(financial,'Komponen')+1
cashTotal=find(financial,'Perkiraan arus kas operasi',start=firstCashLine+1)
ability=find(financial,'Tabel 5.3. Kemampuan membayar')
denominator=find(financial,'Potensi pokok pajak',start=ability)
cash=find(financial,'Kas dan setara kas',start=ability)
cashRatio=find(financial,'Kas terhadap potensi pokok',start=ability)
operating=find(financial,'Perkiraan arus kas operasi',start=ability)
delta=12345
variants=['edited','zero','empty']
for name in variants:
    copy=load_workbook(original)
    funds,source=sheet(copy,'L-13'),sheet(copy,'L-7 ')
    if name=='edited':
        source.cell(facility,8).value+=delta
        source.cell(loan,8).value=0
        funds.cell(sales,3).value+=delta
        funds.cell(firstCashLine,2).value+=delta
    else:
        for i in details:source.cell(i,8).value=None
        if name=='zero':source.cell(facility,8).value=0
    copy.save(temp/(name+'.xlsx'))
subprocess.run([sys.argv[2],'-env:UserInstallation='+(temp/'office-profile').as_uri(),'--headless',
    '--convert-to','xlsx','--outdir',str(output),*[str(temp/(n+'.xlsx')) for n in variants]],check=True,capture_output=True,timeout=75)

errors=[]
def check(label,actual,wanted):
    equal=(actual is None or actual=='') if wanted is None else isinstance(actual,(int,float)) and isclose(actual,wanted,abs_tol=1e-8,rel_tol=1e-12)
    if not equal:errors.append(label+' (actual='+str(actual)+', expected='+str(wanted)+')')
for name in variants:
    book=load_workbook(output/(name+'.xlsx'),data_only=True)
    r,f=sheet(book,'L-7 '),sheet(book,'L-13')
    t5,detail,t53=sheet(book,'Tabel 5.'+' Potensi'),sheet(book,'Tabel 5.1'),sheet(book,'Tabel 5.3')
    factor=at(recap,total,3)+delta if name=='edited' else (0 if name=='zero' else None)
    expectedPPN=at(recap,tax,3)+delta if name=='edited' else factor
    expectedRatio=at(financial,cash)/factor if factor else None
    for sheetName,s in [('L7',r),('T5',t5)]:
        check(name+' '+sheetName+' PPN',at(s,find(s,'PPN'),3),expectedPPN)
        check(name+' '+sheetName+' total',at(s,find(s,'Jumlah'),3),factor)
        if name=='edited':check(name+' '+sheetName+' unpriced',at(s,find(s,'Jumlah'),4),at(recap,total,4)-1)
    for sheetName,s in [('L13',f),('T5.3',t53)]:
        start=ability if sheetName=='L13' else 1
        check(name+' '+sheetName+' denominator',at(s,find(s,'Potensi pokok pajak',start=start)),factor)
        check(name+' '+sheetName+' ratio',at(s,find(s,'Kas terhadap potensi pokok',start=start)),expectedRatio)
    if name=='edited':
        check('T5.1 initially empty principal becomes zero',at(detail,find(detail,'B.4',5),8),0)
        check('T5.1 adjusted N.5',at(detail,find(detail,'N.5',5),8),at(recap,facility,8)+delta)
        change=at(financial,sales,3)+delta-at(financial,sales,2)
        for s in [f,sheet(book,'Tabel 4.1')]:
            i=find(s,'Peredaran usaha')
            check('T4.1 difference '+s.title,at(s,i,4),change)
            check('T4.1 percent '+s.title,at(s,i,5),100*change/abs(at(financial,sales,2)))
        for s,i in [(f,cashTotal),(f,operating),(t53,find(t53,'Perkiraan arus kas operasi'))]:
            check('operating cash '+s.title,at(s,i),at(financial,cashTotal)+delta)
assert not errors,'; '.join(errors)
print('Perubahan N.5, nilai kosong dan nol, rekap, kemampuan membayar, perbandingan dua tahun dan arus kas lolos penghitungan ulang di LibreOffice.')
`,temp,process.env.SOFFICE||'soffice'],{stdio:'inherit'});
}finally{
  await browser?.close();await rm(temp,{force:true,recursive:true});
}
