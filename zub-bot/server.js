const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const PORT=process.env.PORT||10000;
const APP='https://ride-hub-qr-test.onrender.com';
const TG=TOKEN?`https://api.telegram.org/bot${TOKEN}`:'';
const BANNER=Buffer.from(fs.readFileSync(path.join(__dirname,'banner.b64'),'utf8').trim(),'base64');
const PRICE=String(process.env.ZUB_PRICE_RUB||'299.00');
const SHOP_ID=process.env.YOOKASSA_SHOP_ID||'';
const SHOP_SECRET=process.env.YOOKASSA_SECRET_KEY||'';
const READY_COUNTRIES=new Set((process.env.ZUB_READY_COUNTRIES||'DE,NL,US,GB,FI').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean));

function cors(res,status=200,type='application/json; charset=utf-8'){
 res.writeHead(status,{'content-type':type,'access-control-allow-origin':APP,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type','cache-control':'no-store'});
}
function out(res,status,obj){cors(res,status);res.end(JSON.stringify(obj));}
async function body(req){return await new Promise((resolve,reject)=>{let s='';req.on('data',d=>{s+=d;if(s.length>100000)reject(new Error('too_large'))});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)});}
function auth(){return 'Basic '+Buffer.from(`${SHOP_ID}:${SHOP_SECRET}`).toString('base64')}
function cleanCountry(v){v=String(v||'DE').toUpperCase();return /^[A-Z]{2}$/.test(v)?v:'DE'}

async function yookassa(method,url,payload){
 if(!SHOP_ID||!SHOP_SECRET)throw new Error('PAYMENTS_NOT_CONFIGURED');
 const headers={authorization:auth(),'content-type':'application/json'};
 if(method==='POST')headers['Idempotence-Key']=crypto.randomUUID();
 const r=await fetch('https://api.yookassa.ru/v3'+url,{method,headers,body:payload?JSON.stringify(payload):undefined});
 const j=await r.json().catch(()=>({}));
 if(!r.ok){console.error('yookassa',r.status,j);throw new Error('PAYMENT_PROVIDER_ERROR')}
 return j;
}
async function createPayment(data){
 const country=cleanCountry(data.country);
 const tgUser=String(data.tgUser||'').slice(0,64);
 return await yookassa('POST','/payments',{
  amount:{value:PRICE,currency:'RUB'},
  capture:true,
  confirmation:{type:'redirect',return_url:`${APP}/?payment=return&country=${country}`},
  description:`ZUB VPN — доступ на 30 дней`,
  metadata:{product:'zub_vpn_30d',country,tg_user:tgUser},
  refundable:true
 });
}
async function getPayment(id){return await yookassa('GET','/payments/'+encodeURIComponent(id));}

async function maybeProvisionCountry(country,payment){
 country=cleanCountry(country);
 if(READY_COUNTRIES.has(country))return {country,state:'ready',action:'reuse_existing_node',providerCost:'0'};
 // Реальная покупка VPS включается только после добавления провайдера и лимитов расходов.
 // До этого платёж считается успешным, а страна получает статус provisioning_required.
 return {country,state:'provisioning_required',action:'create_node_after_provider_connected',paymentId:payment.id};
}

async function api(method,body){if(!TOKEN)return null;try{return await fetch(`${TG}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())}catch(e){console.error(method,e.message);return null}}
async function sendBanner(chatId,caption){try{const form=new FormData();form.append('chat_id',String(chatId));form.append('caption',caption);form.append('parse_mode','HTML');form.append('photo',new Blob([BANNER],{type:'image/jpeg'}),'zub-banner.jpg');form.append('reply_markup',JSON.stringify({inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}));const r=await fetch(`${TG}/sendPhoto`,{method:'POST',body:form});return await r.json()}catch(e){console.error('sendBanner',e.message);return null}}
async function setup(){if(!TOKEN)return console.log('TELEGRAM_BOT_TOKEN missing');await api('deleteWebhook',{drop_pending_updates:false});await api('setMyCommands',{commands:[{command:'start',description:'Открыть ZUB VPN'},{command:'app',description:'Запустить приложение'},{command:'help',description:'Помощь'}]});await api('setMyDescription',{description:'🦷 ZUB VPN — умный выбор региона для приложений, игр и стриминга. Открой Mini App и выбери, что тебе нужно.'});await api('setMyShortDescription',{short_description:'🦷 ZUB VPN — выбери приложение, ZUB подскажет регион.'});await api('setChatMenuButton',{menu_button:{type:'web_app',text:'🦷 Открыть ZUB',web_app:{url:APP}}});poll();}
let offset=0;async function poll(){while(true){try{const r=await fetch(`${TG}/getUpdates?timeout=25&offset=${offset}`).then(x=>x.json());for(const u of(r.result||[])){offset=u.update_id+1;if(u.message)await handle(u.message)}}catch(e){console.error(e.message);await new Promise(r=>setTimeout(r,2000))}}}
async function handle(m){const text=(m.text||'').split('@')[0];if(text==='/start'){const name=(m.from&&m.from.first_name)||'друг';const caption=`🦷 <b>Добро пожаловать в ZUB VPN, ${esc(name)}!</b>\n\nВыбери приложение или страну — ZUB поможет подобрать подходящий регион.\n\n⚡ Быстрый выбор  •  🌍 Все страны\n🎮 Игры и стриминг  •  🛡 Понятные настройки\n\n<b>Нажми ниже 👇</b>`;const r=await sendBanner(m.chat.id,caption);if(!r||!r.ok)await api('sendMessage',{chat_id:m.chat.id,parse_mode:'HTML',text:caption,reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}})}else if(text==='/app')await api('sendMessage',{chat_id:m.chat.id,text:'🦷 Открыть ZUB:',reply_markup:{inline_keyboard:[[{text:'🦷 ОТКРЫТЬ ZUB',web_app:{url:APP}}]]}});else if(text==='/help')await api('sendMessage',{chat_id:m.chat.id,text:'Нажми «🦷 Открыть ZUB» внизу или используй /app.'});}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}

const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){cors(res,204);return res.end()}
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/config')return out(res,200,{paymentsConfigured:Boolean(SHOP_ID&&SHOP_SECRET),price:PRICE,currency:'RUB',readyCountries:[...READY_COUNTRIES]});
 if(u.pathname==='/api/payment/create'&&req.method==='POST'){
  try{const d=await body(req);const p=await createPayment(d);return out(res,200,{id:p.id,status:p.status,confirmationUrl:p.confirmation&&p.confirmation.confirmation_url,country:cleanCountry(d.country),price:PRICE})}catch(e){return out(res,e.message==='PAYMENTS_NOT_CONFIGURED'?503:502,{error:e.message})}
 }
 if(u.pathname==='/api/payment/status'&&req.method==='GET'){
  try{const id=u.searchParams.get('id');if(!id)return out(res,400,{error:'payment_id_required'});const p=await getPayment(id);let provisioning=null;if(p.status==='succeeded')provisioning=await maybeProvisionCountry(p.metadata&&p.metadata.country,p);return out(res,200,{id:p.id,status:p.status,paid:p.paid,amount:p.amount,metadata:p.metadata,provisioning})}catch(e){return out(res,e.message==='PAYMENTS_NOT_CONFIGURED'?503:502,{error:e.message})}
 }
 if(u.pathname==='/health')return out(res,200,{ok:true,service:'zub-vpn-bot',payments:Boolean(SHOP_ID&&SHOP_SECRET)});
 out(res,200,{ok:true,service:'zub-vpn-bot'});
});
server.listen(PORT,setup);
