const http=require('http');
const zlib=require('zlib');
const TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const PORT=process.env.PORT||10000;
const BASE='https://zub-vpn-bot.onrender.com';
const APP='https://ride-hub-qr-test.onrender.com';
const TG=TOKEN?`https://api.telegram.org/bot${TOKEN}`:'';

async function api(method,body){if(!TOKEN)return null;try{return await fetch(`${TG}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())}catch(e){console.error(method,e.message)}}

async function setup(){
 if(!TOKEN)return console.log('TELEGRAM_BOT_TOKEN missing');
 await api('deleteWebhook',{drop_pending_updates:false});
 await api('setMyCommands',{commands:[{command:'start',description:'Открыть ZUB VPN'},{command:'app',description:'Запустить приложение'},{command:'help',description:'Помощь'}]});
 await api('setMyDescription',{description:'🦷 ZUB VPN — быстрый и понятный доступ к нужным регионам для приложений, игр и стриминга. Открой Mini App и выбери, что тебе нужно.'});
 await api('setMyShortDescription',{short_description:'🦷 ZUB VPN — выбери приложение, ZUB подскажет регион.'});
 await api('setChatMenuButton',{menu_button:{type:'web_app',text:'🦷 Открыть ZUB',web_app:{url:APP}}});
 poll();
}
let offset=0;
async function poll(){while(true){try{const r=await fetch(`${TG}/getUpdates?timeout=25&offset=${offset}`).then(x=>x.json());for(const u of(r.result||[])){offset=u.update_id+1;if(u.message)await handle(u.message)}}catch(e){console.error(e.message);await new Promise(r=>setTimeout(r,2000))}}}
async function handle(m){
 const text=(m.text||'').split('@')[0];
 if(text==='/start'){
  const name=(m.from&&m.from.first_name)||'друг';
  const caption=`🦷 <b>Добро пожаловать в ZUB VPN, ${esc(name)}!</b>\n\nВыбери приложение или нужную страну — ZUB поможет подобрать подходящий регион.\n\n⚡ Быстрый выбор  •  🌍 Все страны\n🎮 Игры и стриминг  •  🛡 Понятные настройки\n\n<b>Жми кнопку ниже 👇</b>`;
  const r=await api('sendPhoto',{chat_id:m.chat.id,photo:`${BASE}/poster.png`,caption,parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});
  if(!r||!r.ok) await api('sendMessage',{chat_id:m.chat.id,parse_mode:'HTML',text:caption,reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});
 } else if(text==='/app') await api('sendMessage',{chat_id:m.chat.id,text:'🦷 Открыть ZUB:',reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});
 else if(text==='/help') await api('sendMessage',{chat_id:m.chat.id,text:'Нажми «🦷 Открыть ZUB» внизу или используй /app.'});
}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}

const FONT={
'Z':['11111','00010','00100','01000','11111'],'U':['10001','10001','10001','10001','01110'],'B':['11110','10001','11110','10001','11110'],'V':['10001','10001','10001','01010','00100'],'P':['11110','10001','11110','10000','10000'],'N':['10001','11001','10101','10011','10001']};
function makePoster(){
 const w=1280,h=720,p=Buffer.alloc(w*h*4);
 const px=(x,y,r,g,b,a=255)=>{if(x<0||y<0||x>=w||y>=h)return;const i=(y*w+x)*4;p[i]=r;p[i+1]=g;p[i+2]=b;p[i+3]=a};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const glow=Math.max(0,1-Math.hypot(x-870,y-270)/560);px(x,y,2+Math.floor(glow*5),7+Math.floor(glow*18),8+Math.floor(glow*14),255)}
 const circle=(cx,cy,r,rr,gg,bb)=>{for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++)if((x-cx)*(x-cx)+(y-cy)*(y-cy)<=r*r)px(x,y,rr,gg,bb)};
 const rect=(x0,y0,x1,y1,rr,gg,bb)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)px(x,y,rr,gg,bb)};
 for(let r=250;r>60;r-=5){const a=(250-r)/190,gg=Math.floor(30+90*(1-a));circle(930,310,r,0,gg,70)}
 circle(930,310,210,4,13,15);circle(930,310,205,7,22,20);
 // tooth silhouette
 circle(920,270,120,238,255,249);circle(1010,270,120,238,255,249);rect(820,270,1110,440,238,255,249);
 for(let y=400;y<520;y++){const t=(y-400)/120;const half=Math.floor(145*(1-t)+42*t);rect(965-half,y,965+half,y+1,238,255,249)}
 // visor
 rect(835,255,1095,335,2,8,10);for(let x=850;x<1080;x+=12)rect(x,268,x+6,322,0,255,190);
 // left panel
 rect(70,80,650,640,4,12,14);rect(70,80,650,86,45,255,190);rect(70,634,650,640,45,255,190);
 function text(str,x,y,scale){let ox=x;for(const ch of str){if(ch===' '){ox+=scale*4;continue}const g=FONT[ch];if(!g){ox+=scale*4;continue}for(let yy=0;yy<5;yy++)for(let xx=0;xx<5;xx++)if(g[yy][xx]==='1')rect(ox+xx*scale,y+yy*scale,ox+(xx+1)*scale-2,y+(yy+1)*scale-2,210,255,245);ox+=scale*6}}
 text('ZUB',115,130,28);text('VPN',115,330,20);
 rect(115,490,520,496,60,255,200);circle(150,555,18,70,255,205);circle(230,555,18,70,255,205);circle(310,555,18,70,255,205);circle(390,555,18,70,255,205);
 return encodePNG(w,h,p);
}
function encodePNG(w,h,rgba){
 const sig=Buffer.from([137,80,78,71,13,10,26,10]);
 const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4)}
 const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4);len.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data]))>>>0);return Buffer.concat([len,t,data,crc])};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([sig,chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
function crc32(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
const POSTER=makePoster();
const server=http.createServer((req,res)=>{if(req.url==='/poster.png'){res.writeHead(200,{'content-type':'image/png','cache-control':'public,max-age=3600'});return res.end(POSTER)}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,service:'zub-vpn-bot'}))});
server.listen(PORT,setup);
