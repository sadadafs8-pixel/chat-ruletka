const http=require('http');
const PORT=process.env.PORT||10000;
const server=http.createServer((req,res)=>{
 if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,service:'zub-vpn-bot'}));}
 res.writeHead(200,{'content-type':'text/plain'});res.end('ZUB VPN bot backend');
});
server.listen(PORT,()=>console.log('ZUB bot listening on',PORT));
