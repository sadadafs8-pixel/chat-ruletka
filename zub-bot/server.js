const http=require('http');
const TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const PORT=process.env.PORT||10000;
const APP='https://ride-hub-qr-test.onrender.com';
const TG=TOKEN?`https://api.telegram.org/bot${TOKEN}`:'';

async function api(method,body){
 if(!TOKEN) return null;
 try{return await fetch(`${TG}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());}catch(e){console.error(method,e.message);}
}
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
async function poll(){
 while(true){
  try{
   const r=await fetch(`${TG}/getUpdates?timeout=25&offset=${offset}`).then(x=>x.json());
   for(const u of (r.result||[])){offset=u.update_id+1; if(u.message) await handle(u.message);}
  }catch(e){console.error(e.message); await new Promise(r=>setTimeout(r,2000));}
 }
}
async function handle(m){
 const text=(m.text||'').split('@')[0];
 if(text==='/start'){
  const name=(m.from&&m.from.first_name)||'друг';
  await api('sendMessage',{chat_id:m.chat.id,parse_mode:'HTML',text:`🦷 <b>ZUB VPN</b>\n\nПривет, ${esc(name)}!\n\nВыбери приложение или нужную страну — ZUB поможет подобрать подходящий регион.\n\n⚡ Быстрый выбор\n🌍 Все страны\n🎮 Игры и стриминг\n🛡 Понятные настройки\n\n<b>Нажми кнопку ниже 👇</b>`,reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});
 } else if(text==='/app'){
  await api('sendMessage',{chat_id:m.chat.id,text:'🦷 Открыть ZUB:',reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});
 } else if(text==='/help') await api('sendMessage',{chat_id:m.chat.id,text:'Нажми «🦷 Открыть ZUB» внизу или используй /app.'});
}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,service:'zub-vpn-bot'}));});
server.listen(PORT,setup);
