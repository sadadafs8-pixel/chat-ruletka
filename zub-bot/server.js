const http=require('http');
const fs=require('fs');
const path=require('path');
const TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const PORT=process.env.PORT||10000;
const BASE='https://zub-vpn-bot.onrender.com';
const APP='https://ride-hub-qr-test.onrender.com';
const TG=TOKEN?`https://api.telegram.org/bot${TOKEN}`:'';
const BANNER=Buffer.from(fs.readFileSync(path.join(__dirname,'banner.b64'),'utf8').trim(),'base64');

async function api(method,body){if(!TOKEN)return null;try{return await fetch(`${TG}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())}catch(e){console.error(method,e.message)}}

async function setup(){
 if(!TOKEN)return console.log('TELEGRAM_BOT_TOKEN missing');
 await api('deleteWebhook',{drop_pending_updates:false});
 await api('setMyCommands',{commands:[{command:'start',description:'Открыть ZUB VPN'},{command:'app',description:'Запустить приложение'},{command:'help',description:'Помощь'}]});
 await api('setMyDescription',{description:'🦷 ZUB VPN — умный выбор региона для приложений, игр и стриминга. Открой Mini App и выбери, что тебе нужно.'});
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
  const caption=`🦷 <b>Добро пожаловать в ZUB VPN, ${esc(name)}!</b>\n\nВыбери приложение или страну — ZUB поможет подобрать подходящий регион.\n\n⚡ Быстрый выбор  •  🌍 Все страны\n🎮 Игры и стриминг  •  🛡 Понятные настройки\n\n<b>Нажми ниже 👇</b>`;
  const r=await api('sendPhoto',{chat_id:m.chat.id,photo:`${BASE}/banner.jpg?v=2`,caption,parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});
  if(!r||!r.ok) await api('sendMessage',{chat_id:m.chat.id,parse_mode:'HTML',text:caption,reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});
 } else if(text==='/app') await api('sendMessage',{chat_id:m.chat.id,text:'🦷 Открыть ZUB:',reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});
 else if(text==='/help') await api('sendMessage',{chat_id:m.chat.id,text:'Нажми «🦷 Открыть ZUB» внизу или используй /app.'});
}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}

const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/banner.jpg')){res.writeHead(200,{'content-type':'image/jpeg','cache-control':'public,max-age=300'});return res.end(BANNER)}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,service:'zub-vpn-bot'}));
});
server.listen(PORT,setup);
