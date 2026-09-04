const http=require('http');
const TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const PORT=process.env.PORT||10000;
const BASE='https://zub-vpn-bot.onrender.com';
const APP='https://ride-hub-qr-test.onrender.com';
const POSTER_B64='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';

async function api(method,body){
  if(!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const r=await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});
  const j=await r.json();
  if(!j.ok) console.error(method,j);
  return j;
}

async function sendStart(chatId,firstName='друг'){
  const caption=`<b>🦷 Добро пожаловать в ZUB VPN, ${firstName}!</b>\n\nZUB помогает быстро выбрать подходящий регион для приложений, стриминга и игр.\n\n⚡ Быстрый выбор маршрута\n🌍 Все страны\n🎮 Gaming / Streaming профили\n🛡 Приватность и понятные настройки\n\n<b>Нажми кнопку ниже и открой ZUB 👇</b>`;
  await api('sendPhoto',{
    chat_id:chatId,
    photo:`${BASE}/poster.jpg?v=1`,
    caption,
    parse_mode:'HTML',
    reply_markup:{inline_keyboard:[
      [{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}],
      [{text:'🌍 Выбрать страну',web_app:{url:APP+'#countries'}},{text:'📱 Найти приложение',web_app:{url:APP+'#apps'}}]
    ]}
  });
}

async function bootstrap(){
  if(!TOKEN) return console.log('Waiting for TELEGRAM_BOT_TOKEN');
  try{
    await api('setWebhook',{url:`${BASE}/telegram-webhook`,drop_pending_updates:true});
    await api('setMyCommands',{commands:[{command:'start',description:'🦷 Открыть ZUB VPN'},{command:'app',description:'🚀 Запустить Mini App'},{command:'help',description:'❓ Помощь'}]});
    await api('setMyDescription',{description:'🦷 ZUB VPN — умный выбор VPN-региона для приложений, игр и стриминга. Нажми «Открыть ZUB» и выбери, что тебе нужно.'});
    await api('setMyShortDescription',{short_description:'🦷 Умный VPN: приложения, игры, стриминг и все страны.'});
    await api('setChatMenuButton',{menu_button:{type:'web_app',text:'🦷 Открыть ZUB',web_app:{url:APP}}});
    console.log('Telegram bot configured');
  }catch(e){console.error('bootstrap',e)}
}

const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/poster.jpg')){
    const b=Buffer.from(POSTER_B64,'base64');
    res.writeHead(200,{'content-type':'image/jpeg','content-length':b.length,'cache-control':'public,max-age=86400'});return res.end(b);
  }
  if(req.url==='/health'){
    res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,service:'zub-vpn-bot',token:Boolean(TOKEN)}));
  }
  if(req.url==='/telegram-webhook'&&req.method==='POST'){
    let raw='';req.on('data',d=>raw+=d);req.on('end',async()=>{
      res.writeHead(200);res.end('ok');
      try{
        const u=JSON.parse(raw||'{}'); const m=u.message;
        if(!m||!m.chat) return;
        const text=(m.text||'').trim();
        if(text.startsWith('/start')||text==='/app') return sendStart(m.chat.id,m.from?.first_name||'друг');
        if(text==='/help') return api('sendMessage',{chat_id:m.chat.id,text:'🦷 ZUB VPN\n\nНажми кнопку ниже, чтобы открыть Mini App.',reply_markup:{inline_keyboard:[[{text:'🦷 Открыть ZUB',web_app:{url:APP}}]]}});
      }catch(e){console.error('webhook',e)}
    });return;
  }
  res.writeHead(200,{'content-type':'text/plain'});res.end('ZUB VPN bot backend');
});
server.listen(PORT,()=>{console.log('ZUB bot listening on',PORT);bootstrap()});
