// Poker Chip local server. Run: node server.js  (no installs needed)
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
const PORT=process.env.PORT||3000,R=new Map();
const lanIps=()=>Object.values(os.networkInterfaces()).flat().filter(i=>i&&(i.family==='IPv4'||i.family===4)&&!i.internal).map(i=>i.address);
const uid=()=>Math.random().toString(36).slice(2,10);
const clean=n=>String(n||'').trim().slice(0,14)||'Player';
const lg=(r,t)=>{r.log.push(t);if(r.log.length>40)r.log.shift()};
const alive=(r,i)=>!r.players[i].out;
const canAct=(r,i)=>{const p=r.players[i];return !p.out&&!p.folded&&!p.allin};
const next=(r,from,f)=>{const n=r.players.length;for(let k=1;k<=n;k++){const i=(from+k+n)%n;if(f(i))return i}return -1};
const pot=r=>r.players.reduce((s,p)=>s+p.total,0);
const pay=(p,a)=>{a=Math.max(0,Math.min(a,p.chips));p.chips-=a;p.bet+=a;p.total+=a;if(!p.chips)p.allin=true};
const DATA=path.join(process.env.DATA_DIR||__dirname,'rooms.json');
const saveAll=()=>{try{fs.writeFileSync(DATA,JSON.stringify([...R.values()].map(({clients,...r})=>r)))}catch(e){}};
try{JSON.parse(fs.readFileSync(DATA,'utf8')).filter(r=>Date.now()-(r.updated||0)<2*864e5).forEach(r=>R.set(r.code,{...r,clients:[]}))}catch(e){}
const mk=(id,n,chips,avatar=1)=>({id,name:clean(n),avatar:Math.max(1,Math.min(20,parseInt(avatar)||1)),chips,buy:chips,bet:0,total:0,folded:false,allin:false,acted:false,out:false});

function newHand(r){
 const ps=r.players;ps.forEach(p=>{if(p.chips<=0)p.out=true});
 if(ps.filter(p=>!p.out).length<2){r.street=5;r.cur=-1;r.pots=null;r.result=['Need at least 2 players with chips to deal. Host: tap + chips on a player, or wait for someone to join.'];return}
 r.hand++;r.result=null;r.pots=null;r.runout=false;r.board=[];
 ps.forEach(p=>{p.bet=p.total=0;p.folded=p.out;p.allin=false;p.acted=false;p.hole=null});
 r.dealer=next(r,r.dealer,i=>alive(r,i));
 const two=ps.filter(p=>!p.out).length===2;
 r.sbI=two?r.dealer:next(r,r.dealer,i=>alive(r,i));
 r.bbI=next(r,r.sbI,i=>alive(r,i));
 pay(ps[r.sbI],r.cfg.sb);pay(ps[r.bbI],r.cfg.bb);
 r.street=0;r.currentBet=Math.max(ps[r.sbI].bet,ps[r.bbI].bet);r.minRaise=r.cfg.bb;
 lg(r,`Hand ${r.hand}: ${ps[r.sbI].name} SB ${r.cfg.sb}, ${ps[r.bbI].name} BB ${r.cfg.bb}`);
 r.cur=next(r,r.bbI,i=>canAct(r,i));
 if(r.cur<0||(ps.filter((p,i)=>canAct(r,i)).length<2&&ps.every(p=>p.folded||p.allin||p.bet>=r.currentBet))){r.cur=-1;endStreet(r)}
}
function advance(r){
 const ps=r.players,live=ps.filter(p=>!p.folded);
 if(live.length===1){const w=live[0],a=pot(r);w.chips+=a;lg(r,`${w.name} wins ${a}`);r.result=[`${w.name} wins ${a} — everyone else folded.`];r.street=5;r.cur=-1;return}
 const pend=ps.map((p,i)=>i).filter(i=>canAct(r,i)&&(!ps[i].acted||ps[i].bet<r.currentBet));
 if(!pend.length)return endStreet(r);
 r.cur=next(r,r.cur,i=>pend.includes(i));
}
function endStreet(r){
 const ps=r.players;ps.forEach(p=>{p.bet=0;p.acted=false});r.currentBet=0;r.minRaise=r.cfg.bb;r.street++;
 const ca=ps.filter((p,i)=>canAct(r,i)).length;
 if(r.street>3||ca<2){r.runout=r.street<=3;r.street=4;r.cur=-1;r.pots=sidePots(r);return}
 r.cur=next(r,r.dealer,i=>canAct(r,i));
}
function sidePots(r){
 const ps=r.players,lv=[...new Set(ps.filter(p=>!p.folded&&p.total>0).map(p=>p.total))].sort((a,b)=>a-b);
 let prev=0;const out=[];
 lv.forEach((L,k)=>{const top=k===lv.length-1;
  const amt=ps.reduce((s,p)=>s+Math.max((top?p.total:Math.min(p.total,L))-prev,0),0);
  const elig=ps.map((p,i)=>i).filter(i=>!ps[i].folded&&ps[i].total>=L);
  out.push({amt,elig,win:elig.length===1?[...elig]:[]});prev=L});
 return out;
}
function award(r){
 const ps=r.players,res=[];
 r.pots.forEach((pt,k)=>{const w=pt.win,sh=Math.floor(pt.amt/w.length),rem=pt.amt-sh*w.length;
  w.forEach((i,j)=>{ps[i].chips+=sh+(j<rem?1:0)});
  res.push(`${w.map(i=>ps[i].name).join(' & ')} ${w.length>1?'split':'win'} ${pt.amt}${r.pots.length>1?(k?' (side pot '+k+')':' (main pot)'):''}`)});
 res.forEach(t=>lg(r,t));r.result=res;r.street=5;
}
function act(r,type,amt){
 const ps=r.players,p=ps[r.cur],toCall=r.currentBet-p.bet,max=p.bet+p.chips;
 if(type==='check'){if(toCall>0)return 'You must call or fold.';lg(r,p.name+' checks')}
 else if(type==='fold'){p.folded=true;lg(r,p.name+' folds')}
 else if(type==='call'||(type==='allin'&&max<=r.currentBet)){const a=Math.min(toCall,p.chips);pay(p,a);lg(r,`${p.name} calls ${a}`)}
 else if(type==='raise'||type==='allin'){
  const to=type==='allin'?max:Math.min(Math.floor(+amt)||0,max),min=Math.min(r.currentBet+r.minRaise,max);
  if(to<min)return 'Minimum is '+min+'.';
  const before=r.currentBet;pay(p,to-p.bet);
  if(p.bet>before){const inc=p.bet-before;if(inc>=r.minRaise)r.minRaise=inc;r.currentBet=p.bet;ps.forEach(q=>{if(q!==p)q.acted=false})}
  lg(r,`${p.name} ${before?'raises to':'bets'} ${p.bet}`);
 }else return 'Unknown action.';
 p.acted=true;advance(r);return null;
}

function api(url,b){
 if(url==='/create'){
  let c;do c=String(1000+Math.floor(Math.random()*9000));while(R.has(c));
  const sb=+b.sb>0?+b.sb:10,cfg={chips:+b.chips>0?+b.chips:1000,sb,bb:Math.max(+b.bb||sb*2,sb),minutes:+b.minutes>0?+b.minutes:15},pid=uid();
  R.set(c,{code:c,host:pid,cfg,players:[mk(pid,b.name,cfg.chips,b.avatar)],clients:[],started:false,over:false,log:[],dealer:-1,hand:0,street:0,cur:-1,sbI:-1,bbI:-1,currentBet:0,minRaise:0,pots:null,result:null,runout:false,timeUp:false,endAt:0,board:[]});
  return {code:c,pid};
 }
 const r=R.get(String(b.code));
 if(!r)return {error:'No room with that code.'};
 if(url==='/join'){
  const nm=clean(b.name).toLowerCase(),ex=r.players.find(p=>p.name.toLowerCase()===nm);
  if(ex)return {code:r.code,pid:ex.id};
  if(r.players.length>=10)return {error:'Room is full (10 players).'};
  const pid=uid(),np=mk(pid,b.name,r.cfg.chips,b.avatar);if(r.started)np.folded=true;r.players.push(np);return {code:r.code,pid};
 }
 const i=r.players.findIndex(p=>p.id===b.pid);
 if(i<0)return {error:'You are not in this room.'};
 const host=r.host===b.pid,t=b.type;
 if(['start','win','award','next','end','resume','close','topup','move','kick'].includes(t)&&!host)return {error:'Only the host can do that.'};
 if(t==='start'){if(r.started||r.players.length<2)return {error:'Need 2+ players.'};r.started=true;r.startAt=Date.now();newHand(r)}
 else if(t==='end')r.over=true;
 else if(t==='resume')r.over=false;
 else if(t==='close'){r.clients.forEach(c=>{try{c.res.end()}catch(e){}});R.delete(r.code);saveAll();return {ok:1}}
 else if((t==='move'||t==='kick')&&(!r.started||r.street===5)){
  const ps=r.players,k=+b.i;if(!ps[k])return {error:'No such player.'};
  const keep=[r.dealer,r.sbI,r.bbI].map(x=>ps[x]&&ps[x].id);
  if(t==='move'){const j=k+(b.d<0?-1:1);if(!ps[j])return {ok:1};[ps[k],ps[j]]=[ps[j],ps[k]]}
  else{
   if(ps[k].id===r.host)return {error:'You can’t remove yourself.'};
   if(r.dealer===k)keep[0]=ps[(k-1+ps.length)%ps.length].id;
   const kid=ps[k].id;r.clients.filter(c=>c.pid===kid).forEach(c=>{try{c.res.end()}catch(e){}});
   r.clients=r.clients.filter(c=>c.pid!==kid);ps.splice(k,1);lg(r,'A player was removed');
  }
  ;[r.dealer,r.sbI,r.bbI]=keep.map(id=>ps.findIndex(p=>p.id===id));
 }
 else if(t==='topup'&&r.street===5){const q=r.players[b.i];if(q){q.chips+=r.cfg.chips;q.buy+=r.cfg.chips;q.out=false;lg(r,q.name+' adds '+r.cfg.chips)}}
 else if(t==='win'&&r.street===4){const w=r.pots[b.k]&&r.pots[b.k].win;if(w){const j=w.indexOf(b.i);j<0?w.push(b.i):w.splice(j,1)}}
 else if(t==='award'&&r.street===4){if(!r.pots.every(p=>p.win.length))return {error:'Pick a winner for every pot.'};award(r)}
 else if(t==='next'&&r.street===5)newHand(r);
 else if(t==='hole'||t==='board'){
  const cs=b.cards,q=r.players[i];
  if(!r.started||r.over||r.street>4||q.out)return {error:'Not available right now.'};
  if(!Array.isArray(cs)||cs.length>(t==='hole'?2:5)||new Set(cs).size!==cs.length||!cs.every(c=>/^(10|[2-9JQKA])[SHDC]$/.test(c)))return {error:'Invalid cards.'};
  if(t==='hole'){if(cs.some(c=>(r.board||[]).includes(c)))return {error:'A card is already on the board.'};q.hole=cs.length?cs:null}
  else{if(cs.some(c=>(q.hole||[]).includes(c)))return {error:'One of those is in your hand.'};r.board=cs}
 }
 else if(['fold','check','call','raise','allin'].includes(t)){
  if(r.street>3||r.cur<0||(r.cur!==i&&!host))return {error:'Not your turn.'};
  const e=act(r,t,b.amount);if(e)return {error:e};
 }
 return {ok:1};
}

const view=(r,pid)=>{const {clients,host,players,...x}=r;
 return JSON.stringify({...x,players:players.map(p=>({...p,host:p.id===host,id:0,hole:(p.id===pid||(r.pots&&!p.folded))?p.hole:undefined})),isHost:host===pid,me:players.findIndex(p=>p.id===pid),pot:pot(r),now:Date.now()})};
let saveT=null;const saveSoon=()=>{if(!saveT)saveT=setTimeout(()=>{saveT=null;saveAll()},400)};
const push=r=>{r.updated=Date.now();saveSoon();r.clients.forEach(c=>c.res.write('data: '+view(r,c.pid)+'\n\n'))};

const srv=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://x');
 if(u.pathname==='/info'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ips:lanIps(),port:PORT}))}
 if(u.pathname==='/icon.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(fs.readFileSync(path.join(__dirname,'icon.png')))}
 if(/^\/avatars\/avatar_(?:[1-9]|1[0-9]|20)\.png$/.test(u.pathname)){const f=path.join(__dirname,u.pathname.slice(1));if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});return res.end(fs.readFileSync(f))}res.writeHead(404);return res.end()} 
 if(u.pathname==='/manifest.json'){res.writeHead(200,{'Content-Type':'application/manifest+json'});return res.end(JSON.stringify({name:'Poker Chip',short_name:'Poker',start_url:'/',display:'standalone',background_color:'#0f2818',theme_color:'#0f2818',icons:[{src:'/icon.png',sizes:'512x512',type:'image/png'}]}))}
 if(req.method==='GET'&&u.pathname==='/'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'index.html')));
 }
 if(u.pathname==='/state'){
  const r=R.get(u.searchParams.get('code')),pid=u.searchParams.get('pid');
  if(!r||!r.players.some(p=>p.id===pid)){res.writeHead(404);return res.end()}
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(view(r,pid));
 }
 if(u.pathname==='/events'){
  const r=R.get(u.searchParams.get('code')),pid=u.searchParams.get('pid');
  if(!r||!r.players.some(p=>p.id===pid)){res.writeHead(404);return res.end()}
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
  const c={pid,res};r.clients.push(c);res.write('data: '+view(r,pid)+'\n\n');
  return req.on('close',()=>{r.clients=r.clients.filter(x=>x!==c)});
 }
 if(req.method==='POST'){
  let d='';req.on('data',x=>d+=x);req.on('end',()=>{
   let b={};try{b=JSON.parse(d)}catch{}
   const o=api(u.pathname,b),r=R.get(String(b.code||o.code));
   if(r&&!o.error)push(r);
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));
  });return;
 }
 res.writeHead(404);res.end();
});
const start=cb=>{const f=e=>cb(e);srv.once('error',f);srv.listen(PORT,'0.0.0.0',()=>{srv.off('error',f);cb(null)})};
const stop=cb=>{saveAll();R.forEach(r=>r.clients.forEach(c=>{try{c.res.end()}catch(e){}}));R.forEach(r=>{r.clients=[]});srv.close(()=>cb&&cb());if(srv.closeAllConnections)srv.closeAllConnections()};
module.exports={start,stop,lanIps,PORT};
if(require.main===module)start(e=>{
 if(e)return console.log('Could not start: '+e.message);
 console.log('\n♠ Poker Chip server is running.\nOpen one of these on every phone (same Wi-Fi / hotspot):\n');
 lanIps().forEach(ip=>console.log('   http://'+ip+':'+PORT));
 console.log('\nPress Ctrl+C to stop.\n');
});

setInterval(()=>R.forEach(r=>r.clients.forEach(c=>c.res.write(': ping\n\n'))),20000);
