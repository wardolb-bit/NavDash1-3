const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PUBLIC_PORT = Number(process.env.AIS_WS_PORT || 8081);
const HTTP_INTERNAL_PORT = Number(process.env.AIS_HTTP_INTERNAL_PORT || 18081);
const HTTPS_INTERNAL_PORT = Number(process.env.AIS_HTTPS_INTERNAL_PORT || 18443);
const WS_PORT = PUBLIC_PORT;
const WSS_PORT = PUBLIC_PORT;
const TLS_CERT_PATH = process.env.AIS_TLS_CERT || path.join(__dirname, 'certs', 'navdash-server.crt');
const TLS_KEY_PATH = process.env.AIS_TLS_KEY || path.join(__dirname, 'certs', 'navdash-server.key');
const BAUD_RATE = Number(process.env.AIS_BAUD || 38400);
const REQUESTED_PORT = process.env.AIS_PORT || 'COM4';
const ROUTE_STATE_PATH = process.env.NAV_ROUTE_STATE_PATH || path.join(__dirname, '..', 'data', 'loaded-route.json');
const DATA_DIR = process.env.NAVDASH_DATA_DIR || path.join(__dirname, '..', 'data');
const POSITION_HISTORY_PATH = process.env.NAV_POSITION_HISTORY_PATH || path.join(DATA_DIR, 'position-history.json');
const POSITION_HISTORY_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const POSITION_HISTORY_MIN_INTERVAL_MS = 60 * 1000;
const POSITION_HISTORY_MIN_DISTANCE_NM = 0.01;
const EGC_DIR = process.env.FELCOM_EGC_DIR || 'C:\\Users\\havennav\\Documents\\felcom19\\egc';
const EGC_SCAN_INTERVAL_MS = Number(process.env.EGC_SCAN_INTERVAL_MS || 5000);

const http = require('http');
const https = require('https');
const net = require('net');

const httpServer = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && requestUrl.pathname === '/navdash-root-ca.crt') {
    const rootCaPath = path.join(__dirname, 'certs', 'navdash-root-ca.crt');
    try {
      const rootCa = fs.readFileSync(rootCaPath);
      res.writeHead(200, {'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename=navdash-root-ca.crt'});
      res.end(rootCa);
    } catch (error) {
      res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:'NavDash root CA not found'}));
    }
    return;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ok:true,websocket:`ws://10.129.4.102:${WS_PORT}`,secureWebsocket:secureServer?`wss://10.129.4.102:${WSS_PORT}`:null}));
    return;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/position-history') {
    const now=Date.now();
    positionHistory=positionHistory.filter(entry=>now-entry.timestamp<=POSITION_HISTORY_MAX_AGE_MS).sort((a,b)=>a.timestamp-b.timestamp);
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({entries:positionHistory,sampleCount:positionHistory.length,oldestTimestamp:positionHistory[0]?.timestamp??null,newestTimestamp:positionHistory[positionHistory.length-1]?.timestamp??null}));
    return;
  }
  res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'Not found'}));
});

const wss = new WebSocket.Server({ server: httpServer });
let secureServer=null, secureWss=null;
try {
  secureServer=https.createServer({cert:fs.readFileSync(TLS_CERT_PATH),key:fs.readFileSync(TLS_KEY_PATH)});
  secureWss=new WebSocket.Server({server:secureServer});
} catch(error) { console.log(`[AIS] Secure WebSocket disabled: ${error.message}`); }

let serialPort=null,lastLineAt=null,lastError=null,lastRouteState=loadRouteState();
let routeFileExists=fs.existsSync(ROUTE_STATE_PATH);
let positionHistory=loadPositionHistory();
let egcMessages=[],egcLastScanAt=null,egcLastError=null,egcLastSignature='';

function normalizeRouteState(payload){
 const rawWaypoints=Array.isArray(payload?.waypoints)?payload.waypoints:[];
 const waypoints=rawWaypoints.map((wp,index)=>{const lat=Number(wp?.lat??wp?.latitude),lon=Number(wp?.lon??wp?.lng??wp?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;return{id:typeof wp?.id==='string'&&wp.id.trim()?wp.id:`WP${String(index+1).padStart(2,'0')}`,name:typeof wp?.name==='string'&&wp.name.trim()?wp.name:`Waypoint ${index+1}`,lat,lon};}).filter(Boolean);
 const raw=Number(payload?.activeWaypointIndex); const activeWaypointIndex=Number.isFinite(raw)&&waypoints.length>=2?Math.max(1,Math.min(Math.round(raw),waypoints.length-1)):1;
 return{type:'route-state',routeName:typeof payload?.routeName==='string'&&payload.routeName.trim()?payload.routeName.trim():'Loaded RTZ Route',waypoints,activeWaypointIndex,savedAt:typeof payload?.savedAt==='string'?payload.savedAt:new Date().toISOString()};
}
function loadRouteState(){try{if(!fs.existsSync(ROUTE_STATE_PATH))return null;const s=normalizeRouteState(JSON.parse(fs.readFileSync(ROUTE_STATE_PATH,'utf8')));if(s.waypoints.length<2)return null;console.log(`[AIS] Loaded shared route "${s.routeName}" from ${ROUTE_STATE_PATH}`);return s;}catch(error){console.log(`[AIS] Could not load shared route: ${error.message}`);return null;}}
function saveRouteState(s){try{fs.mkdirSync(path.dirname(ROUTE_STATE_PATH),{recursive:true});fs.writeFileSync(ROUTE_STATE_PATH,JSON.stringify(s,null,2),'utf8');routeFileExists=true;console.log(`[AIS] Saved shared route "${s.routeName}" to ${ROUTE_STATE_PATH}`);}catch(error){console.log(`[AIS] Could not save shared route: ${error.message}`);}}
function clearRouteState(){try{if(fs.existsSync(ROUTE_STATE_PATH))fs.unlinkSync(ROUTE_STATE_PATH);routeFileExists=false;console.log(`[AIS] Cleared shared route at ${ROUTE_STATE_PATH}`);}catch(error){console.log(`[AIS] Could not clear shared route: ${error.message}`);}}
function sixBitCharToValue(char){const code=char.charCodeAt(0);return code<88?code-48:code-56;}
function payloadToBits(payload){return payload.split('').map(char=>sixBitCharToValue(char).toString(2).padStart(6,'0')).join('');}
function getUnsigned(bits,start,length){return parseInt(bits.slice(start,start+length),2);}
function getSigned(bits,start,length){const value=getUnsigned(bits,start,length),signBit=1<<(length-1);return value&signBit?value-(1<<length):value;}
function decodeOwnShipPosition(sentence){try{const clean=String(sentence||'').trim();if(!clean.startsWith('!AIVDO')&&!clean.startsWith('$AIVDO'))return null;const parts=clean.split(',');if(parts.length<7)return null;const total=Number(parts[1]),fragment=Number(parts[2]),payload=parts[5],fillBits=Number((parts[6]||'0').split('*')[0]||0);if(total!==1||fragment!==1||!payload)return null;const rawBits=payloadToBits(payload),bits=fillBits>0?rawBits.slice(0,-fillBits):rawBits,messageType=getUnsigned(bits,0,6);if(![1,2,3].includes(messageType))return null;const sogRaw=getUnsigned(bits,50,10),lonRaw=getSigned(bits,61,28),latRaw=getSigned(bits,89,27),cogRaw=getUnsigned(bits,116,12),headingRaw=getUnsigned(bits,128,9),lat=latRaw/600000,lon=lonRaw/600000;if(Math.abs(lat)>90||Math.abs(lon)>180)return null;return{lat,lon,sog:sogRaw===1023?null:sogRaw/10,cog:cogRaw===3600?null:cogRaw/10,heading:headingRaw===511?null:headingRaw,timestamp:Date.now(),receivedAt:new Date().toISOString()};}catch{return null;}}
function distanceNm(aLat,aLon,bLat,bLon){const r=3440.065,toRad=v=>(v*Math.PI)/180,dLat=toRad(bLat-aLat),dLon=toRad(bLon-aLon),lat1=toRad(aLat),lat2=toRad(bLat),a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return r*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function normalizePositionEntry(entry){const lat=Number(entry?.lat),lon=Number(entry?.lon),timestamp=Number(entry?.timestamp);if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(timestamp))return null;return{lat,lon,timestamp,sog:Number.isFinite(Number(entry?.sog))?Number(entry.sog):null,cog:Number.isFinite(Number(entry?.cog))?Number(entry.cog):null,heading:Number.isFinite(Number(entry?.heading))?Number(entry.heading):null,receivedAt:typeof entry?.receivedAt==='string'?entry.receivedAt:new Date(timestamp).toISOString()};}
function loadPositionHistory(){try{if(!fs.existsSync(POSITION_HISTORY_PATH))return[];const parsed=JSON.parse(fs.readFileSync(POSITION_HISTORY_PATH,'utf8')),now=Date.now(),entries=Array.isArray(parsed?.entries)?parsed.entries:Array.isArray(parsed)?parsed:[];return entries.map(normalizePositionEntry).filter(Boolean).filter(e=>now-e.timestamp<=POSITION_HISTORY_MAX_AGE_MS);}catch(error){console.log(`[AIS] Could not load position history: ${error.message}`);return[];}}
function savePositionHistory(){try{fs.mkdirSync(path.dirname(POSITION_HISTORY_PATH),{recursive:true});fs.writeFileSync(POSITION_HISTORY_PATH,JSON.stringify({entries:positionHistory},null,2),'utf8');}catch(error){console.log(`[AIS] Could not save position history: ${error.message}`);}}
function recordOwnShipPosition(position){if(!position)return;const now=Date.now();positionHistory=positionHistory.filter(e=>now-e.timestamp<=POSITION_HISTORY_MAX_AGE_MS);const last=positionHistory[positionHistory.length-1];if(last){const dt=position.timestamp-last.timestamp,d=distanceNm(last.lat,last.lon,position.lat,position.lon);if(dt<POSITION_HISTORY_MIN_INTERVAL_MS&&d<POSITION_HISTORY_MIN_DISTANCE_NM)return;}positionHistory.push(position);savePositionHistory();}

function parseEgcReceivedAt(raw){const m=String(raw||'').match(/(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);if(!m)return null;const[,yy,mm,dd,hh,minute]=m,date=new Date(Date.UTC(2000+Number(yy),Number(mm)-1,Number(dd),Number(hh),Number(minute)));return Number.isNaN(date.getTime())?null:date.toISOString();}
function egcHeaderField(text,label){const pattern=new RegExp(`^${label}\\s*:\\s*(.+)$`,'mi');return text.match(pattern)?.[1]?.trim()||'';}
function parseEgcFile(filePath){const stat=fs.statSync(filePath),raw=fs.readFileSync(filePath,'utf8').replace(/\r\n/g,'\n'),lines=raw.split('\n'),firstLine=lines[0]?.trim()||'',type=firstLine.match(/^EGC Message\s+---\s+(.+?)\s+---\s*$/i)?.[1]?.trim()||'EGC Message',separatorIndex=lines.findIndex((line,index)=>index>0&&line.trim()===''),body=(separatorIndex>=0?lines.slice(separatorIndex+1):lines).join('\n').trim(),sequence=egcHeaderField(raw,'Message Sequence No\\.'),les=egcHeaderField(raw,'LES'),priority=egcHeaderField(raw,'Priority'),size=egcHeaderField(raw,'Size'),receiveText=egcHeaderField(raw,'Receive Date & Time'),receivedAt=parseEgcReceivedAt(receiveText),navMatch=body.match(/\bNAVAREA\s+([IVXLC]+)\s+(\d+\/\d+)\b/i),cancellationMatch=body.match(/\bCANCEL(?:S|LED)?\s+NAVAREA\s+([IVXLC]+)\s+(\d+\/\d+)\b/i);return{id:`${filePath}:${sequence||stat.mtimeMs}`,filename:path.basename(filePath),type,sequence,les,priority,size,receiveText,receivedAt,navarea:navMatch?.[1]?.toUpperCase()||'',warningNumber:navMatch?.[2]||'',cancelledNavarea:cancellationMatch?.[1]?.toUpperCase()||'',cancelledWarningNumber:cancellationMatch?.[2]||'',isCancellation:Boolean(cancellationMatch),body,modifiedAt:stat.mtime.toISOString()};}
function listEgcFilesRecursive(directory){const files=[];for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const fullPath=path.join(directory,entry.name);if(entry.isDirectory())files.push(...listEgcFilesRecursive(fullPath));else if(entry.isFile())files.push(fullPath);}return files;}
function getEgcSnapshot(){return{type:'egc-snapshot',connected:true,directory:EGC_DIR,scannedAt:egcLastScanAt,lastError:egcLastError,messages:egcMessages};}
function scanEgcDirectory(forceBroadcast=false){try{if(!fs.existsSync(EGC_DIR))throw new Error(`FELCOM EGC folder not found: ${EGC_DIR}`);const parsed=listEgcFilesRecursive(EGC_DIR).map(filePath=>{try{return parseEgcFile(filePath);}catch(error){console.log(`[EGC] Skipping ${filePath}: ${error.message}`);return null;}}).filter(item=>item&&(item.body||item.sequence));parsed.sort((a,b)=>(Date.parse(b.receivedAt||b.modifiedAt||'')||0)-(Date.parse(a.receivedAt||a.modifiedAt||'')||0));egcMessages=parsed;egcLastScanAt=new Date().toISOString();egcLastError=null;const signature=JSON.stringify(egcMessages.map(item=>[item.id,item.modifiedAt,item.sequence]));if(forceBroadcast||signature!==egcLastSignature){egcLastSignature=signature;broadcast(getEgcSnapshot());}}catch(error){const nextError=error.message,changed=nextError!==egcLastError;egcLastScanAt=new Date().toISOString();egcLastError=nextError;if(forceBroadcast||changed)broadcast(getEgcSnapshot());}}
function broadcast(payload){const message=JSON.stringify(payload),sendTo=server=>server?.clients?.forEach(client=>{if(client.readyState===WebSocket.OPEN)client.send(message);});sendTo(wss);sendTo(secureWss);}

fs.watchFile(ROUTE_STATE_PATH,{interval:2000},current=>{const existsNow=current.nlink>0;if(existsNow){const disk=loadRouteState();if(disk&&JSON.stringify(disk)!==JSON.stringify(lastRouteState)){lastRouteState=disk;broadcast(lastRouteState);console.log(`[AIS] Broadcast refreshed shared route "${lastRouteState.routeName}" from disk.`);}}else if(routeFileExists&&lastRouteState?.waypoints?.length){lastRouteState={type:'route-state',routeName:'',waypoints:[],activeWaypointIndex:0,savedAt:new Date().toISOString()};broadcast(lastRouteState);console.log('[AIS] Broadcast shared route clear from disk.');}routeFileExists=existsNow;});
function handleWsConnection(ws){ws.send(JSON.stringify({type:'status',connected:Boolean(serialPort?.isOpen),baudRate:BAUD_RATE,port:serialPort?.path||REQUESTED_PORT||'auto',lastLineAt,lastError}));const disk=loadRouteState();if(disk)lastRouteState=disk;if(lastRouteState)ws.send(JSON.stringify(lastRouteState));ws.send(JSON.stringify({type:'position-history',entries:positionHistory,sampleCount:positionHistory.length,oldestTimestamp:positionHistory[0]?.timestamp??null,newestTimestamp:positionHistory[positionHistory.length-1]?.timestamp??null}));ws.send(JSON.stringify(getEgcSnapshot()));ws.on('message',raw=>{try{const msg=JSON.parse(String(raw));if(msg.type==='position-history-request'){ws.send(JSON.stringify({type:'position-history',entries:positionHistory,sampleCount:positionHistory.length,oldestTimestamp:positionHistory[0]?.timestamp??null,newestTimestamp:positionHistory[positionHistory.length-1]?.timestamp??null}));}else if(msg.type==='route-state'){lastRouteState=normalizeRouteState(msg);if(lastRouteState.waypoints.length>=2)saveRouteState(lastRouteState);broadcast(lastRouteState);}else if(msg.type==='route-clear'){lastRouteState={type:'route-state',routeName:'',waypoints:[],activeWaypointIndex:0,savedAt:new Date().toISOString()};clearRouteState();broadcast(lastRouteState);}else if(msg.type==='egc-refresh')scanEgcDirectory(true);}catch{}});}
wss.on('connection',handleWsConnection);if(secureWss)secureWss.on('connection',handleWsConnection);
async function choosePort(){if(REQUESTED_PORT)return REQUESTED_PORT;const ports=await SerialPort.list(),preferred=ports.find(p=>/usb|serial|ch340|ftdi|prolific|cp210/i.test(`${p.path} ${p.manufacturer||''} ${p.friendlyName||''}`));return preferred?.path||ports[0]?.path||null;}
async function openSerial(){try{const serialPath=await choosePort();if(!serialPath){lastError='No serial ports found. Set AIS_PORT=COM3 or your actual port.';console.log(`[AIS] ${lastError}`);broadcast({type:'status',connected:false,baudRate:BAUD_RATE,port:'none',lastError});setTimeout(openSerial,5000);return;}serialPort=new SerialPort({path:serialPath,baudRate:BAUD_RATE,dataBits:8,stopBits:1,parity:'none',autoOpen:false});serialPort.open(err=>{if(err){lastError=err.message;console.log(`[AIS] Could not open ${serialPath}: ${err.message}`);broadcast({type:'status',connected:false,baudRate:BAUD_RATE,port:serialPath,lastError});setTimeout(openSerial,5000);return;}console.log(`[AIS] Reading ${serialPath} at ${BAUD_RATE} baud. WebSocket ws://0.0.0.0:${WS_PORT}`);lastError=null;broadcast({type:'status',connected:true,baudRate:BAUD_RATE,port:serialPath,lastError:null});const parser=serialPort.pipe(new ReadlineParser({delimiter:'\r\n'}));parser.on('data',line=>{const clean=String(line||'').trim();if(!clean)return;lastLineAt=new Date().toISOString();recordOwnShipPosition(decodeOwnShipPosition(clean));broadcast({type:'nmea',line:clean,receivedAt:lastLineAt});});serialPort.on('error',error=>{lastError=error.message;console.log(`[AIS] Serial error: ${error.message}`);broadcast({type:'status',connected:false,baudRate:BAUD_RATE,port:serialPath,lastError});});serialPort.on('close',()=>{console.log('[AIS] Serial port closed. Reconnecting...');broadcast({type:'status',connected:false,baudRate:BAUD_RATE,port:serialPath,lastError:'Serial port closed'});setTimeout(openSerial,5000);});});}catch(error){lastError=error.message;console.log(`[AIS] Startup error: ${error.message}`);broadcast({type:'status',connected:false,baudRate:BAUD_RATE,port:REQUESTED_PORT||'auto',lastError});setTimeout(openSerial,5000);}}

let internalReady=0;const expectedInternalServers=secureServer?2:1;
function maybeStartPublicMux(){internalReady+=1;if(internalReady!==expectedInternalServers)return;const mux=net.createServer(clientSocket=>{clientSocket.once('data',firstChunk=>{const looksLikeTls=firstChunk.length>0&&firstChunk[0]===0x16,targetPort=looksLikeTls?HTTPS_INTERNAL_PORT:HTTP_INTERNAL_PORT,upstream=net.connect(targetPort,'127.0.0.1',()=>{upstream.write(firstChunk);clientSocket.pipe(upstream);upstream.pipe(clientSocket);}),closeBoth=()=>{if(!clientSocket.destroyed)clientSocket.destroy();if(!upstream.destroyed)upstream.destroy();};upstream.on('error',closeBoth);clientSocket.on('error',closeBoth);});});mux.listen(PUBLIC_PORT,'0.0.0.0',()=>{console.log(`[AIS] AIS server started on ${PUBLIC_PORT}`);console.log(`[AIS] Windows endpoint: ws://10.129.4.102:${PUBLIC_PORT}`);if(secureServer)console.log(`[AIS] iOS endpoint: wss://10.129.4.102:${PUBLIC_PORT}`);console.log('[AIS] Plain WS and secure WSS share network port 8081.');console.log(`[EGC] Watching ${EGC_DIR} recursively through AIS WebSocket ${PUBLIC_PORT}`);scanEgcDirectory(true);setInterval(()=>scanEgcDirectory(false),EGC_SCAN_INTERVAL_MS);openSerial();});}
httpServer.listen(HTTP_INTERNAL_PORT,'127.0.0.1',maybeStartPublicMux);
if(secureServer)secureServer.listen(HTTPS_INTERNAL_PORT,'127.0.0.1',maybeStartPublicMux);
