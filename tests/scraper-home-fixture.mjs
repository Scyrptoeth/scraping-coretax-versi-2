import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension = process.env.EXTENSION_DIR || fileURLToPath(new URL('../extension/',import.meta.url));
const origin = 'https://coretax.intranet.pajak.go.id';
const home = origin + '/home/id-ID/';
const search = origin + '/returnsheets/id-ID/taxpayer-search';
const id = '00000000-0000-4000-8000-000000000001', otherId = id.slice(0,-1)+'2';
const list = origin + '/returnsheets/id-ID/submitted-returnsheets/'+id;
const draft = origin + '/returnsheets/id-ID/not-submitted-returnsheets/'+id;
const wp = '0000000000000017', other = '0000000000000029';
const menu = '<a role="button" href="#">SPT</a><button aria-haspopup="true" onclick="setTimeout(()=>document.querySelector(\'nav\').hidden=false,400)">SPT</button><nav hidden>'+
  '<a href="/invalid">Pengungkapan Ketidakbenaran SPT</a><a href="'+search+'">SPT per Wajib Pajak</a>'+
  '<a href="'+search+'">SPT per Wajib Pajak</a></nav>';
const form = '<input id="siteSearch" type="search" aria-label="Cari Menu atau Laporan"><input id="ObjectPermitNumber" type="text" aria-label="Cari Wajib Pajak berdasarkan NIK/NPWP">'+
  '<table hidden><thead><tr><th></th><th>NPWP/NIK</th><th>Nama</th></tr></thead><tbody>'+
  '<tr><td><button onclick="location.href=\'/invalid\'">Pilih</button></td><td>'+other+'</td><td>'+wp+'</td></tr>'+
  '<tr id="match"><td><button title="Pilih" onclick="location.href=\''+draft+'\'"><i aria-hidden="true"></i></button></td><td>'+wp+'</td><td>Badan simulasi</td></tr>'+
  '</tbody></table><script>document.getElementById("ObjectPermitNumber").oninput=e=>{document.querySelector("table").hidden=e.target.value!=="'+wp+'"};</script>';
const link = '<a href="'+list+'">SPT Dilaporkan</a>';
const detailBase=origin+'/simulasi-spt/';
function detail(title,month){
  const fields=[['NPWP Wajib Pajak',wp],['Jenis SPT','SPT Masa PPN'],['Masa Pajak',month+' 2025'],['Model SPT','Normal'],
    ['ID SPT',title],['Nomor Bukti Penerimaan','BPE-'+title]];
  return '<main><dl>'+fields.map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('')+'</dl>'+
    '<section aria-label="Induk SPT"><dl><dt>Keterangan</dt><dd>Induk '+title+'</dd></dl></section></main>';
}
const tables = '<aside><div><b>'+wp+'</b><div>Badan simulasi</div></div><ul>'+
  '<li>'+link+'</li><li><a href="/accounting/id-ID/balancesheet/'+id+'">Buku Besar Wajib Pajak</a></li>'+
  '<li><a href="'+search+'">Pilih Wajib Pajak Lain</a></li></ul></aside><div class="p-datatable"><table id="spt"><thead><tr>'+
  ['','Jenis Pajak','Jenis Surat Pemberitahuan Pajak','Masa Pajak','Model SPT','Status SPT','ID SPT','Nomor Bukti Penerimaan'].map(s=>'<th>'+s+'</th>').join('')+
  '</tr></thead><tbody>'+[['Januari 2025','INDEX-JAN'],['Februari 2025','INDEX-FEB']].map(([month,record])=>
    '<tr><td><a href="'+detailBase+record+'">Lihat SPT</a></td>'+['PPN','SPT Masa PPN',month,'Normal','Dilaporkan',record,'BPE-'+record].map(s=>'<td>'+s+'</td>').join('')+'</tr>').join('')+
  '</tbody></table><div class="p-paginator"><span class="p-paginator-current">Menampilkan 1 sampai 2 dari 2 baris</span>'+
  '<button aria-label="Halaman pertama" aria-controls="spt" disabled>Halaman pertama</button>'+
  '<button aria-label="Halaman berikutnya" aria-controls="spt" disabled>Berikutnya</button></div></div>';

export {origin,home,search,list,draft,wp,other,otherId};

export async function launchHomeFixture() {
  const profile = await mkdtemp(path.join(tmpdir(),'coretax-home-test-'));
  let ctx,server;
  async function close() {
    await ctx?.close();
    if (server?.listening) await new Promise(resolve=>server.close(resolve));
    await rm(profile,{recursive:true,force:true});
  }
  try {
    // Browser-created background tabs can send their first request before a
    // Playwright page exists. Serve every document from one loopback fixture.
    const keyFile=path.join(profile,'fixture-key.pem'),certFile=path.join(profile,'fixture-cert.pem');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=coretax.intranet.pajak.go.id','-keyout',keyFile,'-out',certFile],{stdio:'ignore'});
    const cert=await readFile(certFile);
    const routes = new Map([[home,menu],[search,form],[draft,link],[list,tables],[detailBase+'INDEX-JAN',detail('INDEX-JAN','Januari')]]);
    const blocked = [],visited=[];
    server=createServer({key:await readFile(keyFile),cert},(request,response)=>{
      const url=new URL(request.url,origin).href;
      visited.push(url);
      if(!routes.has(url) && !url.endsWith('/favicon.ico')) blocked.push(url);
      response.writeHead(routes.has(url)?200:404,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      response.end(routes.get(url));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const pin=createHash('sha256').update(new X509Certificate(cert).publicKey.export({format:'der',type:'spki'})).digest('base64');
    ctx = await chromium.launchPersistentContext(path.join(profile,'chrome'),{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,
      args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--no-proxy-server',
        '--host-resolver-rules=MAP coretax.intranet.pajak.go.id 127.0.0.1:'+server.address().port+', MAP * ~NOTFOUND','--ignore-certificate-errors-spki-list='+pin]});
    return {ctx,close,routes,blocked,visited};
  } catch (error) {
    await close();
    throw error;
  }
}
