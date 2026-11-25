// usage: node tee.js LOGFILE LABEL FD(1|2)  -- copies stdin to fd untouched, logs each chunk with ms timestamp
const fs=require('fs');const [,,log,label,fd]=process.argv;
const out=+fd;const lf=fs.openSync(log,'a');
process.stdin.on('data',b=>{fs.writeSync(lf,`[${Date.now()} ${label}] ${JSON.stringify(b.toString('utf8'))}\n`);let o=0;while(o<b.length){try{o+=fs.writeSync(out,b,o);}catch(e){if(e.code==='EAGAIN')continue;if(e.code==='EPIPE')break;throw e;}}});
process.stdin.on('end',()=>{fs.writeSync(lf,`[${Date.now()} ${label}] <EOF>\n`);});
