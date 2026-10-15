'use strict';
const $ = id => document.getElementById(id);
const tools = {
  dns: ['01 / PUBLIC DOMAIN', 'DNS inspector', 'See where a domain points and how its mail and DNS records are configured.', '⌘'],
  headers: ['02 / PUBLIC DOMAIN', 'HTTPS & headers', 'Inspect the HTTPS root response, security headers, and cookie attributes.', '↗'],
  tls: ['03 / PUBLIC DOMAIN', 'TLS certificate', 'Inspect certificate trust, hostname coverage, expiry, and the negotiated TLS connection.', '◇'],
  subnet: ['04 / BROWSER LOCAL', 'Subnet calculator', 'Plan an IPv4 network and find its mask, address range, and usable hosts.', '⊞'],
  local: ['05 / LOCAL COMPANION', 'Devices & services', 'Discover responding devices and open TCP services on a private network.', '◎'],
};
let active = 'dns', lastReport = null, agent = null, busy = false;
const services = { 21:'FTP', 22:'SSH', 23:'Telnet', 25:'SMTP', 53:'DNS/TCP', 80:'HTTP', 110:'POP3', 135:'RPC', 139:'NetBIOS', 143:'IMAP', 443:'HTTPS', 445:'SMB', 465:'SMTPS', 587:'Submission', 993:'IMAPS', 995:'POP3S', 1883:'MQTT', 3389:'RDP', 5900:'VNC', 8080:'HTTP alternate', 8081:'HTTP alternate', 8443:'HTTPS alternate', 9100:'Printer' };
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function showStatus(message, error = false) { $('status').replaceChildren(el('div', message, error ? 'error' : 'loading')); }
function kv(name, value) { const n = el('div', undefined, 'kv'); n.append(el('span',name),el('strong',typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—'))); return n; }
function meta(text) { return el('p', text, 'meta'); }
function card(title, value, badge, warning) {
  const n = el('div', undefined, 'record'), head = el('div', undefined, 'record-head');
  head.append(el('strong',title),el('span',badge,`badge${warning?' warn':''}`));
  n.append(head,el('pre',value)); return n;
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('nav button').forEach(b => b.disabled = value);
  $('run').disabled = value; $('scan-run').disabled = value;
}
function switchTool(tool) {
  active = tool; lastReport = null; $('export').disabled = true; $('status').replaceChildren();
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active',b.dataset.tool === tool));
  const info = tools[tool]; $('tool-number').textContent = `TOOL ${info[0]}`; $('tool-title').textContent = info[1]; $('tool-desc').textContent = info[2]; $('tool-symbol').textContent = info[3];
  $('public-form').hidden = tool === 'subnet' || tool === 'local'; $('subnet-form').hidden = tool !== 'subnet'; $('local-panel').hidden = tool !== 'local';
  $('run').replaceChildren(document.createTextNode(tool === 'dns' ? 'Inspect domain ' : tool === 'headers' ? 'Check HTTPS ' : 'Inspect certificate '),el('span','↗'));
  $('results').replaceChildren();
  const empty = el('div',undefined,'empty'); empty.append(el('div','◎','empty-icon'),el('h3',tool === 'local' ? (agent ? 'Ready to explore your network.' : 'Your network. Your computer.') : 'Ready for a closer look.'),el('p',tool === 'local' ? 'Discovery runs only after you select a range and start a scan.' : tool === 'subnet' ? 'Enter an IPv4 address and prefix above.' : 'Enter a public domain above to begin.'));
  $('results').append(empty);
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click',()=>switchTool(b.dataset.tool)));
function saveReport(report) { lastReport = report; $('export').disabled = false; }
function summary(items) { const n=el('div',undefined,'summary'); items.forEach(([value,label])=>{const c=el('div');c.append(el('b',String(value)),el('span',label));n.append(c);});return n; }
function renderPublic(data) {
  const r=data.result, root=$('results'); root.replaceChildren();
  root.append(meta(`${r.host} · ${new Date(data.checkedAt).toLocaleString()}`));
  if (data.tool === 'dns') {
    for(const record of r.records) {
      const values=record.values.map(value=>Array.isArray(value) ? value.join('') : typeof value==='object' ? JSON.stringify(value) : value).join('\n');
      root.append(card(record.type,values || (record.code ? `${record.status} (${record.code})` : record.status),record.status,record.status!=='answered'));
    }
  } else if (data.tool === 'headers') {
    root.append(summary([[r.status,'HTTP STATUS'],[`${r.elapsedMs} ms`,'RESPONSE TIME'],[`${r.checks.filter(c=>c.value).length} / 6`,'HEADERS PRESENT']]));
    root.append(kv('Connected address',r.address));
    if (r.redirect) root.append(kv('Redirect destination',r.redirect));
    r.checks.forEach(c=>root.append(card(c.name,c.value || 'Not present in this response',c.value?'Present':'Review',!c.value)));
    if(r.cookies.length) r.cookies.forEach(c=>root.append(card(`Cookie: ${c.name}`,`Secure: ${c.secure}\nHttpOnly: ${c.httpOnly}\nSameSite: ${c.sameSite || 'not set'}`,'Attributes only',!c.secure)));
    else root.append(meta('No Set-Cookie headers in this response. Cookies created by JavaScript or other pages are not inspected.'));
  } else {
    root.append(summary([[r.trusted?'Trusted':'Review','CERTIFICATE CHAIN'],[r.daysRemaining,'DAYS TO EXPIRY'],[r.protocol || '—','NEGOTIATED PROTOCOL']]));
    root.append(kv('Hostname matches',r.hostnameMatches?'Yes':'No'),kv('Subject',r.subject),kv('Issuer',r.issuer),kv('Valid from',r.validFrom),kv('Valid until',r.validTo),kv('Connected address',r.address),kv('Cipher',r.cipher),kv('Alternative names',r.subjectAltName),kv('SHA-256 fingerprint',r.fingerprint));
    if(r.authorizationError) root.append(card('Trust issue',r.authorizationError,'Review',true));
  }
  root.append(meta(r.note));
}
$('public-form').addEventListener('submit',async event=>{
  event.preventDefault(); if(busy)return; setBusy(true); saveReport(null); $('export').disabled=true; showStatus('Inspecting domain…');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),22000);
  try {
    const response=await fetch(agent?'/api/public':'/api/network',{method:'POST',headers:{'Content-Type':'application/json',...(agent?{'X-WardLab-Token':agent.token}:{})},body:JSON.stringify({tool:active,target:$('target').value}),signal:controller.signal});
    const data=await response.json(); if(!response.ok)throw new Error(data.error||'Inspection failed.');
    renderPublic(data); saveReport(data); $('status').replaceChildren(el('div','Inspection complete.','done'));
  } catch(error) { showStatus(error.name==='AbortError'?'The inspection timed out. Try again.':error.message,true); }
  finally {clearTimeout(timer);setBusy(false);}
});
function ipv4(value) {
  const parts=value.split('.'); if(parts.length!==4||parts.some(p=>!/^\d{1,3}$/.test(p)||Number(p)>255))throw new Error('Enter a valid IPv4 address.');
  return parts.reduce((n,p)=>n*256+Number(p),0);
}
function ipString(n){return [Math.floor(n/16777216)%256,Math.floor(n/65536)%256,Math.floor(n/256)%256,n%256].join('.');}
function subnet(value) {
  const parts=value.trim().split('/'); if(parts.length!==2||!/^\d{1,2}$/.test(parts[1])||Number(parts[1])>32)throw new Error('Use IPv4/prefix format, for example 192.168.1.10/24.');
  const ip=ipv4(parts[0]), prefix=Number(parts[1]), size=2**(32-prefix), network=Math.floor(ip/size)*size, broadcast=network+size-1;
  const usable=prefix>=31?size:size-2;
  return {input:value,network:`${ipString(network)}/${prefix}`,mask:ipString(4294967296-size),wildcard:ipString(size-1),first:ipString(prefix>=31?network:network+1),last:ipString(prefix>=31?broadcast:broadcast-1),broadcast:prefix>=31?'Not applicable for /31 or /32':ipString(broadcast),total:size,usable,note:prefix===31?'A /31 uses both addresses on a point-to-point link.':prefix===32?'A /32 identifies one host.':'Usable count excludes network and broadcast addresses.'};
}
$('subnet-form').addEventListener('submit',event=>{event.preventDefault();try{
  const result=subnet($('cidr').value); $('status').replaceChildren(); $('results').replaceChildren(summary([[result.total.toLocaleString(),'TOTAL ADDRESSES'],[result.usable.toLocaleString(),'USABLE ADDRESSES']]));
  for(const [label,key]of [['Network','network'],['Subnet mask','mask'],['Wildcard mask','wildcard'],['First usable','first'],['Last usable','last'],['Broadcast','broadcast']])$('results').append(kv(label,result[key]));
  $('results').append(meta(result.note));saveReport({tool:'subnet',checkedAt:new Date().toISOString(),result});
}catch(error){showStatus(error.message,true);}});
$('export').addEventListener('click',()=>{if(!lastReport)return;const blob=new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`wardlab-${lastReport.tool}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function renderScan(data) {
  const root=$('results'); root.replaceChildren(summary([[data.devices.length,'RESPONDING ADDRESSES'],[data.scanned,'ADDRESSES CHECKED'],[`${data.elapsedSeconds}s`,'ELAPSED']]));
  const wrap=el('div',undefined,'table-wrap'),table=el('table'),head=el('thead'),row=el('tr'); ['ADDRESS','OPEN TCP SERVICES'].forEach(t=>row.append(el('th',t)));head.append(row);table.append(head);const body=el('tbody');
  data.devices.forEach(device=>{const tr=el('tr');tr.append(el('td',device.ip),el('td',device.ports.map(port=>`${port} ${services[port]||'TCP'}`).join('\n')));body.append(tr);});table.append(body);wrap.append(table);root.append(wrap,meta('Service names are common port labels, not verified software identities. No response does not prove an address is unused.'));
  if(!data.devices.length)root.append(meta('No open ports observed. Check the subnet, selected ports, firewall, and network connection.'));
}
$('scan-form').addEventListener('submit',async event=>{event.preventDefault();if(!agent||busy)return;setBusy(true);$('export').disabled=true;showStatus('Checking selected addresses and ports… This can take around a minute.');try{
  const response=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json','X-WardLab-Token':agent.token},body:JSON.stringify({cidr:$('scan-cidr').value,ports:$('ports').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Scan failed.');renderScan(data);saveReport({tool:'local',checkedAt:new Date().toISOString(),result:data});$('status').replaceChildren(el('div','Local inspection complete.','done'));
}catch(error){showStatus(error.message,true);}finally{setBusy(false);}});
(async()=>{if(!['127.0.0.1','localhost'].includes(location.hostname))return;try{const res=await fetch('/api/session');if(!res.ok)return;agent=await res.json();$('session').replaceChildren(document.createTextNode('LOCAL COMPANION '),el('span',undefined,'dot'));$('agent-setup').hidden=true;$('scan-form').hidden=false;if(agent.suggestedCidr)$('scan-cidr').value=agent.suggestedCidr;switchTool('local');}catch{}})();
