// Cursor2API Log Viewer v4 - Client JS

// ===== Theme Toggle =====
function getTheme(){return document.documentElement.getAttribute('data-theme')||'light'}
function applyThemeIcon(){const btn=document.getElementById('themeToggle');if(btn)btn.textContent=getTheme()==='dark'?'☀️':'🌙'}
function toggleTheme(){const t=getTheme()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',t);localStorage.setItem('cursor2api_theme',t);applyThemeIcon()}
applyThemeIcon();

let reqs=[],rmap={},logs=[],selId=null,cFil='all',cLv='all',sq='',curTab='logs',curPayload=null,timeFil='all';
const PC={receive:'var(--blue)',convert:'var(--cyan)',send:'var(--purple)',response:'var(--purple)',thinking:'#a855f7',refusal:'var(--yellow)',retry:'var(--yellow)',truncation:'var(--yellow)',continuation:'var(--yellow)',toolparse:'var(--orange)',sanitize:'var(--orange)',stream:'var(--green)',complete:'var(--green)',error:'var(--red)',intercept:'var(--pink)',auth:'var(--t3)'};

// ===== Token Auth =====
const urlToken = new URLSearchParams(window.location.search).get('token');
if (urlToken) localStorage.setItem('cursor2api_token', urlToken);
const authToken = localStorage.getItem('cursor2api_token') || '';
function authQ(base) { return authToken ? (base.includes('?') ? base + '&token=' : base + '?token=') + encodeURIComponent(authToken) : base; }
function logoutBtn() {
  if (authToken) {
    const b = document.createElement('button');
    b.textContent = '退出';
    b.className = 'hdr-btn';
    b.onclick = () => { localStorage.removeItem('cursor2api_token'); window.location.href = '/logs'; };
    document.querySelector('.hdr-r').prepend(b);
  }
}

// ===== Init =====
async function init(){
  try{
    const[a,b]=await Promise.all([fetch(authQ('/api/requests?limit=100')),fetch(authQ('/api/logs?limit=500'))]);
    if (a.status === 401) { localStorage.removeItem('cursor2api_token'); window.location.href = '/logs'; return; }
    reqs=await a.json();logs=await b.json();rmap={};reqs.forEach(r=>rmap[r.requestId]=r);
    renderRL();updCnt();updStats();
    // 默认显示实时日志流
    renderLogs(logs.slice(-200));
  }catch(e){console.error(e)}
  connectSSE();
  logoutBtn();
}

// ===== SSE =====
let es;
function connectSSE(){
  if(es)try{es.close()}catch{}
  es=new EventSource(authQ('/api/logs/stream'));
  es.addEventListener('log',e=>{
    const en=JSON.parse(e.data);logs.push(en);
    if(logs.length>5000)logs=logs.slice(-3000);
    if(!selId||selId===en.requestId){if(curTab==='logs')appendLog(en)}
  });
  es.addEventListener('summary',e=>{
    const s=JSON.parse(e.data);rmap[s.requestId]=s;
    const i=reqs.findIndex(r=>r.requestId===s.requestId);
    if(i>=0)reqs[i]=s;else reqs.unshift(s);
    renderRL();updCnt();
    if(selId===s.requestId)renderSCard(s);
  });
  es.addEventListener('stats',e=>{applyStats(JSON.parse(e.data))});
  es.onopen=()=>{const c=document.getElementById('conn');c.className='conn on';c.querySelector('span').textContent='已连接'};
  es.onerror=()=>{const c=document.getElementById('conn');c.className='conn off';c.querySelector('span').textContent='重连中...';setTimeout(connectSSE,3000)};
}

// ===== Stats =====
function updStats(){fetch(authQ('/api/stats')).then(r=>r.json()).then(applyStats).catch(()=>{})}
function applyStats(s){document.getElementById('sT').textContent=s.totalRequests;document.getElementById('sS').textContent=s.successCount;document.getElementById('sD').textContent=s.degradedCount||0;document.getElementById('sE').textContent=s.errorCount;document.getElementById('sA').textContent=s.avgResponseTime||'-';document.getElementById('sF').textContent=s.avgTTFT||'-'}

// ===== Time Filter =====
function getTimeCutoff(){
  if(timeFil==='all')return 0;
  const now=Date.now();
  const map={today:now-now%(86400000)+new Date().getTimezoneOffset()*-60000,'2d':now-2*86400000,'7d':now-7*86400000,'30d':now-30*86400000};
  if(timeFil==='today'){const d=new Date();d.setHours(0,0,0,0);return d.getTime()}
  return map[timeFil]||0;
}
function setTF(f,btn){timeFil=f;document.querySelectorAll('#tbar .tb').forEach(b=>b.classList.remove('a'));btn.classList.add('a');renderRL();updCnt()}

// ===== Search & Filter =====
function mS(r,q){
  const s=q.toLowerCase();
  return r.requestId.includes(s)||r.model.toLowerCase().includes(s)||r.path.toLowerCase().includes(s)||(r.title||'').toLowerCase().includes(s);
}
function updCnt(){
  const q=sq.toLowerCase();const cut=getTimeCutoff();
  let a=0,s=0,d=0,e=0,p=0,i=0;
  reqs.forEach(r=>{
    if(cut&&r.startTime<cut)return;
    if(q&&!mS(r,q))return;
    a++;if(r.status==='success')s++;else if(r.status==='degraded')d++;else if(r.status==='error')e++;else if(r.status==='processing')p++;else if(r.status==='intercepted')i++;
  });
  document.getElementById('cA').textContent=a;document.getElementById('cS').textContent=s;document.getElementById('cD').textContent=d;document.getElementById('cE').textContent=e;document.getElementById('cP').textContent=p;document.getElementById('cI').textContent=i;
}
function fR(f,btn){cFil=f;document.querySelectorAll('#fbar .fb').forEach(b=>b.classList.remove('a'));btn.classList.add('a');renderRL()}

// ===== Format helpers =====
function fmtDate(ts){const d=new Date(ts);return (d.getMonth()+1)+'/'+d.getDate()+' '+d.toLocaleTimeString('zh-CN',{hour12:false})}
function timeAgo(ts){const s=Math.floor((Date.now()-ts)/1000);if(s<5)return'刚刚';if(s<60)return s+'s前';if(s<3600)return Math.floor(s/60)+'m前';return Math.floor(s/3600)+'h前'}
function fmtN(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return String(n)}
function escH(s){if(!s)return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function syntaxHL(data){
  try{const s=typeof data==='string'?data:JSON.stringify(data,null,2);
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"([^"]+)"\s*:/g,'<span class="jk">"$1"</span>:')
    .replace(/:\s*"([^"]*?)"/g,': <span class="js">"$1"</span>')
    .replace(/:\s*(\d+\.?\d*)/g,': <span class="jn">$1</span>')
    .replace(/:\s*(true|false)/g,': <span class="jb">$1</span>')
    .replace(/:\s*(null)/g,': <span class="jnl">null</span>')
  }catch{return escH(String(data))}
}
function copyText(text){navigator.clipboard.writeText(text).then(()=>{}).catch(()=>{})}

// ===== Request List =====
function renderRL(){
  const el=document.getElementById('rlist');const q=sq.toLowerCase();const cut=getTimeCutoff();
  let f=reqs;
  if(cut)f=f.filter(r=>r.startTime>=cut);
  if(q)f=f.filter(r=>mS(r,q));
  if(cFil!=='all')f=f.filter(r=>r.status===cFil);
  if(!f.length){el.innerHTML='<div class="empty"><div class="ic">📡</div><p>'+(q?'无匹配':'暂无请求')+'</p></div>';return}
  el.innerHTML=f.map(r=>{
    const ac=r.requestId===selId;
    const dur=r.endTime?((r.endTime-r.startTime)/1000).toFixed(1)+'s':'...';
    const durMs=r.endTime?r.endTime-r.startTime:Date.now()-r.startTime;
    const pct=Math.min(100,durMs/30000*100),dc=!r.endTime?'pr':durMs<3000?'f':durMs<10000?'m':durMs<20000?'s':'vs';
    const ch=r.responseChars>0?fmtN(r.responseChars)+' chars':'';
    const tt=r.ttft?r.ttft+'ms':'';
    const title=r.title||r.model;
    const dateStr=fmtDate(r.startTime);
    let bd='';if(r.stream)bd+='<span class="bg str">Stream</span>';if(r.hasTools)bd+='<span class="bg tls">T:'+r.toolCount+'</span>';
    if(r.retryCount>0)bd+='<span class="bg rtr">R:'+r.retryCount+'</span>';if(r.continuationCount>0)bd+='<span class="bg cnt">C:'+r.continuationCount+'</span>';
    if(r.status==='degraded')bd+='<span class="bg dgd">DEGRADED</span>';if(r.status==='error')bd+='<span class="bg err">ERR</span>';if(r.status==='intercepted')bd+='<span class="bg icp">INTERCEPT</span>';
    const fm=r.apiFormat||'anthropic';
    return '<div class="ri'+(ac?' a':'')+'" data-r="'+r.requestId+'">'
      +'<div class="si-dot '+r.status+'"></div>'
      +'<div class="ri-title">'+escH(title)+'</div>'
      +'<div class="ri-time">'+dateStr+' · '+dur+(tt?' · ⚡'+tt:'')+'</div>'
      +'<div class="r1"><span class="rid">'+r.requestId+' <span class="rfmt '+fm+'">'+fm+'</span></span>'
      +(ch?'<span class="rch">→ '+ch+'</span>':'')+'</div>'
      +'<div class="rbd">'+bd+'</div>'
      +'<div class="rdbar"><div class="rdfill '+dc+'" style="width:'+pct+'%"></div></div></div>';
  }).join('');
}

// ===== Select Request =====
async function selReq(id){
  if(selId===id){desel();return}
  selId=id;renderRL();
  const s=rmap[id];
  if(s){document.getElementById('dTitle').textContent=s.title||'请求 '+id;renderSCard(s)}
  document.getElementById('tabs').style.display='flex';
  // ★ 保持当前 tab（不重置为 logs）
  const tabEl=document.querySelector('.tab[data-tab="'+curTab+'"]');
  if(tabEl){setTab(curTab,tabEl)}else{setTab('logs',document.querySelector('.tab'))}
  // Load payload
  try{const r=await fetch(authQ('/api/payload/'+id));if(r.ok)curPayload=await r.json();else curPayload=null}catch{curPayload=null}
  // Re-render current tab with new data
  const tabEl2=document.querySelector('.tab[data-tab="'+curTab+'"]');
  if(tabEl2)setTab(curTab,tabEl2);
}

function desel(){
  selId=null;curPayload=null;renderRL();
  document.getElementById('dTitle').textContent='实时日志流';
  document.getElementById('scard').style.display='none';
  document.getElementById('ptl').style.display='none';
  document.getElementById('tabs').style.display='none';
  curTab='logs';
  renderLogs(logs.slice(-200));
}

function renderSCard(s){
  const c=document.getElementById('scard');c.style.display='block';
  const dur=s.endTime?((s.endTime-s.startTime)/1000).toFixed(2)+'s':'进行中...';
  const sc={processing:'var(--yellow)',success:'var(--green)',degraded:'var(--orange)',error:'var(--red)',intercepted:'var(--pink)'}[s.status]||'var(--t3)';
  const items=[['状态','<span style="color:'+sc+'">'+s.status.toUpperCase()+'</span>'],['耗时',dur],['模型',escH(s.model)],['格式',(s.apiFormat||'anthropic').toUpperCase()],['消息数',s.messageCount],['响应字数',fmtN(s.responseChars)],['TTFT',s.ttft?s.ttft+'ms':'-'],['API耗时',s.cursorApiTime?s.cursorApiTime+'ms':'-'],['停止原因',s.stopReason||'-'],['重试',s.retryCount],['续写',s.continuationCount],['工具调用',s.toolCallsDetected]];
  if(s.thinkingChars>0)items.push(['Thinking',fmtN(s.thinkingChars)+' chars']);
  if(s.inputTokens)items.push(['↑ Cursor tokens',fmtN(s.inputTokens)]);
  if(s.outputTokens)items.push(['↓ Cursor tokens',fmtN(s.outputTokens)]);
  if(s.statusReason)items.push(['降级原因',escH(s.statusReason)]);
  if(s.issueTags&&s.issueTags.length)items.push(['问题标签',escH(s.issueTags.join(', '))]);
  if(s.error)items.push(['错误','<span style="color:var(--red)">'+escH(s.error)+'</span>']);
  document.getElementById('sgrid').innerHTML=items.map(([l,v])=>'<div class="si2"><span class="l">'+l+'</span><span class="v">'+v+'</span></div>').join('');
  renderPTL(s);
}

function renderPTL(s){
  const el=document.getElementById('ptl'),bar=document.getElementById('pbar');
  if(!s.phaseTimings||!s.phaseTimings.length){el.style.display='none';return}
  el.style.display='block';const tot=(s.endTime||Date.now())-s.startTime;if(tot<=0){el.style.display='none';return}
  bar.innerHTML=s.phaseTimings.map(pt=>{const d=pt.duration||((pt.endTime||Date.now())-pt.startTime);const pct=Math.max(1,d/tot*100);const bg=PC[pt.phase]||'var(--t3)';return '<div class="pseg" style="width:'+pct+'%;background:'+bg+'" title="'+pt.label+': '+d+'ms"><span class="tip">'+escH(pt.label)+' '+d+'ms</span>'+(pct>10?'<span style="font-size:7px">'+pt.phase+'</span>':'')+'</div>'}).join('');
}

// ===== Tabs =====
function setTab(tab,el){
  curTab=tab;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('a'));
  el.classList.add('a');
  const tc=document.getElementById('tabContent');
  if(tab==='logs'){
    tc.innerHTML='<div class="llist" id="logList"></div>';
    if(selId){renderLogs(logs.filter(l=>l.requestId===selId))}else{renderLogs(logs.slice(-200))}
  } else if(tab==='request'){
    renderRequestTab(tc);
  } else if(tab==='prompts'){
    renderPromptsTab(tc);
  } else if(tab==='response'){
    renderResponseTab(tc);
  }
}

function renderRequestTab(tc){
  if(!curPayload){tc.innerHTML='<div class="empty"><div class="ic">📥</div><p>暂无请求数据</p></div>';return}
  let h='';
  const s=selId?rmap[selId]:null;
  if(s){
    h+='<div class="content-section"><div class="cs-title">📋 请求概要</div>';
    h+='<div class="resp-box">'+syntaxHL({method:s.method,path:s.path,model:s.model,stream:s.stream,apiFormat:s.apiFormat,messageCount:s.messageCount,toolCount:s.toolCount,hasTools:s.hasTools})+'</div></div>';
  }
  if(curPayload.tools&&curPayload.tools.length){
    h+='<div class="content-section"><div class="cs-title">🔧 工具定义 <span class="cnt">'+curPayload.tools.length+' 个</span></div>';
    curPayload.tools.forEach(t=>{h+='<div class="tool-item"><div class="tool-name">'+escH(t.name)+'</div>'+(t.description?'<div class="tool-desc">'+escH(t.description)+'</div>':'')+'</div>'});
    h+='</div>';
  }
  if(curPayload.cursorRequest){
    h+='<div class="content-section"><div class="cs-title">🔄 Cursor 请求（转换后）</div>';
    h+='<div class="resp-box">'+syntaxHL(curPayload.cursorRequest)+'<button class="copy-btn" onclick="copyText(JSON.stringify(curPayload.cursorRequest,null,2))">复制</button></div></div>';
  }
  if(curPayload.cursorMessages&&curPayload.cursorMessages.length){
    h+='<div class="content-section"><div class="cs-title">📨 Cursor 消息列表 <span class="cnt">'+curPayload.cursorMessages.length+' 条</span></div>';
    curPayload.cursorMessages.forEach((m,i)=>{
      const collapsed=m.contentPreview.length>500;
      h+='<div class="msg-item"><div class="msg-header" onclick="togMsg(this)"><span class="msg-role '+m.role+'">'+m.role+' #'+(i+1)+'</span><span class="msg-meta">'+fmtN(m.contentLength)+' chars '+(collapsed?'▶ 展开':'▼ 收起')+'</span></div><div class="msg-body" style="display:'+(collapsed?'none':'block')+';max-height:800px;overflow-y:auto">'+escH(m.contentPreview)+'</div></div>';
    });
    h+='</div>';
  }
  tc.innerHTML=h||'<div class="empty"><div class="ic">📥</div><p>暂无请求数据</p></div>';
}

function renderPromptsTab(tc){
  if(!curPayload){tc.innerHTML='<div class="empty"><div class="ic">💬</div><p>暂无提示词数据</p></div>';return}
  let h='';
  const s=selId?rmap[selId]:null;
  // ===== 转换摘要 =====
  if(s){
    const origMsgCount=curPayload.messages?curPayload.messages.length:0;
    const cursorMsgCount=curPayload.cursorMessages?curPayload.cursorMessages.length:0;
    const origToolCount=s.toolCount||0;
    const sysPLen=curPayload.systemPrompt?curPayload.systemPrompt.length:0;
    const cursorTotalChars=curPayload.cursorRequest?.totalChars||0;
    // 计算工具指令占用的字符数（第一条 cursor 消息 减去 原始第一条用户消息）
    const firstCursorMsg=curPayload.cursorMessages?.[0];
    const firstOrigUser=curPayload.messages?.find(m=>m.role==='user');
    const toolInstructionChars=firstCursorMsg&&firstOrigUser?Math.max(0,firstCursorMsg.contentLength-(firstOrigUser?.contentLength||0)):0;
    h+='<div class="content-section"><div class="cs-title">🔄 转换摘要</div>';
    h+='<div class="sgrid" style="grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0">';
    h+='<div class="si2"><span class="l">原始工具数</span><span class="v">'+origToolCount+'</span></div>';
    h+='<div class="si2"><span class="l">Cursor 工具数</span><span class="v" style="color:var(--green)">0 <span style="font-size:10px;color:var(--t2)">(嵌入消息)</span></span></div>';
    h+='<div class="si2"><span class="l">总上下文</span><span class="v">'+(cursorTotalChars>0?fmtN(cursorTotalChars)+' chars':'—')+'</span></div>';
    h+='<div class="si2"><span class="l">↑ Cursor 输入 tokens</span><span class="v" style="color:var(--blue)">'+(s.inputTokens?fmtN(s.inputTokens):'—')+'</span></div>';
    h+='<div class="si2"><span class="l">原始消息数</span><span class="v">'+origMsgCount+'</span></div>';
    h+='<div class="si2"><span class="l">Cursor 消息数</span><span class="v" style="color:var(--green)">'+cursorMsgCount+'</span></div>';
    h+='<div class="si2"><span class="l">工具指令占用</span><span class="v">'+(toolInstructionChars>0?fmtN(toolInstructionChars)+' chars':origToolCount>0?'嵌入第1条消息':'N/A')+'</span></div>';
    h+='<div class="si2"><span class="l">↓ Cursor 输出 tokens</span><span class="v" style="color:var(--green)">'+(s.outputTokens?fmtN(s.outputTokens):'—')+'</span></div>';
    h+='</div>';
    if(origToolCount>0){
      h+='<div style="color:var(--yellow);font-size:12px;padding:6px 10px;background:rgba(234,179,8,0.1);border-radius:6px;margin-top:4px">⚠️ Cursor API 不支持原生 tools 参数。'+origToolCount+' 个工具定义已转换为文本指令，嵌入在 user #1 消息中'+(toolInstructionChars>0?'（约 '+fmtN(toolInstructionChars)+' chars）':'')+'</div>';
    }
    h+='</div>';
  }
  // ===== 原始请求 =====
  h+='<div class="content-section"><div class="cs-title">📥 客户端原始请求</div></div>';
  if(curPayload.question){
    h+='<div class="content-section"><div class="cs-title">❓ 用户问题摘要 <span class="cnt">'+fmtN(curPayload.question.length)+' chars</span></div>';
    h+='<div class="resp-box" style="max-height:300px;overflow-y:auto;border-color:var(--orange)">'+escH(curPayload.question)+'<button class="copy-btn" onclick="copyText(curPayload.question)">复制</button></div></div>';
  }
  if(curPayload.systemPrompt){
    h+='<div class="content-section"><div class="cs-title">🔒 原始 System Prompt <span class="cnt">'+fmtN(curPayload.systemPrompt.length)+' chars</span></div>';
    h+='<div class="resp-box" style="max-height:400px;overflow-y:auto;border-color:var(--orange)">'+escH(curPayload.systemPrompt)+'<button class="copy-btn" onclick="copyText(curPayload.systemPrompt)">复制</button></div></div>';
  }
  if(curPayload.messages&&curPayload.messages.length){
    h+='<div class="content-section"><div class="cs-title">💬 原始消息列表 <span class="cnt">'+curPayload.messages.length+' 条</span></div>';
    curPayload.messages.forEach((m,i)=>{
      const imgs=m.hasImages?' 🖼️':'';
      const collapsed=m.contentPreview.length>500;
      h+='<div class="msg-item"><div class="msg-header" onclick="togMsg(this)"><span class="msg-role '+m.role+'">'+m.role+imgs+' #'+(i+1)+'</span><span class="msg-meta">'+fmtN(m.contentLength)+' chars '+(collapsed?'▶ 展开':'▼ 收起')+'</span></div><div class="msg-body" style="display:'+(collapsed?'none':'block')+';max-height:800px;overflow-y:auto">'+escH(m.contentPreview)+'</div></div>';
    });
    h+='</div>';
  }
  // ===== 转换后 Cursor 请求 =====
  if(curPayload.cursorMessages&&curPayload.cursorMessages.length){
    h+='<div class="content-section" style="margin-top:24px;border-top:2px solid var(--green);padding-top:16px"><div class="cs-title">📤 Cursor 最终消息（转换后） <span class="cnt" style="background:var(--green);color:#fff">'+curPayload.cursorMessages.length+' 条</span></div>';
    h+='<div style="color:var(--t2);font-size:12px;margin-bottom:8px">⬇️ 以下是清洗后实际发给 Cursor 模型的消息（已清除身份声明、注入工具指令、添加认知重构）</div>';
    curPayload.cursorMessages.forEach((m,i)=>{
      const collapsed=m.contentPreview.length>500;
      h+='<div class="msg-item" style="border-left:3px solid var(--green)"><div class="msg-header" onclick="togMsg(this)"><span class="msg-role '+m.role+'">'+m.role+' #'+(i+1)+'</span><span class="msg-meta">'+fmtN(m.contentLength)+' chars '+(collapsed?'▶ 展开':'▼ 收起')+'</span></div><div class="msg-body" style="display:'+(collapsed?'none':'block')+';max-height:800px;overflow-y:auto">'+escH(m.contentPreview)+'</div></div>';
    });
    h+='</div>';
  } else if(curPayload.cursorRequest) {
    h+='<div class="content-section" style="margin-top:24px;border-top:2px solid var(--green);padding-top:16px"><div class="cs-title">📤 Cursor 最终请求（转换后）</div>';
    h+='<div class="resp-box" style="border-color:var(--green)">'+syntaxHL(curPayload.cursorRequest)+'</div></div>';
  }
  tc.innerHTML=h||'<div class="empty"><div class="ic">💬</div><p>暂无提示词数据</p></div>';
}

function renderResponseTab(tc){
  if(!curPayload){tc.innerHTML='<div class="empty"><div class="ic">📤</div><p>暂无响应数据</p></div>';return}
  let h='';
  if(curPayload.answer){
    const title=curPayload.answerType==='tool_calls'?'✅ 最终结果（工具调用摘要）':'✅ 最终回答摘要';
    h+='<div class="content-section"><div class="cs-title">'+title+' <span class="cnt">'+fmtN(curPayload.answer.length)+' chars</span></div>';
    h+='<div class="resp-box diff" style="max-height:320px">'+escH(curPayload.answer)+'<button class="copy-btn" onclick="copyText(curPayload.answer)">复制</button></div></div>';
  }
  if(curPayload.toolCallNames&&curPayload.toolCallNames.length&&!curPayload.toolCalls){
    h+='<div class="content-section"><div class="cs-title">🔧 工具调用名称 <span class="cnt">'+curPayload.toolCallNames.length+' 个</span></div>';
    h+='<div class="resp-box">'+escH(curPayload.toolCallNames.join(', '))+'<button class="copy-btn" onclick="copyText(curPayload.toolCallNames.join(\', \'))">复制</button></div></div>';
  }
  if(curPayload.thinkingContent){
    h+='<div class="content-section"><div class="cs-title">🧠 Thinking 内容 <span class="cnt">'+fmtN(curPayload.thinkingContent.length)+' chars</span></div>';
    h+='<div class="resp-box" style="border-color:var(--purple);max-height:300px">'+escH(curPayload.thinkingContent)+'<button class="copy-btn" onclick="copyText(curPayload.thinkingContent)">复制</button></div></div>';
  }
  if(curPayload.rawResponse){
    h+='<div class="content-section"><div class="cs-title">📝 模型原始返回 <span class="cnt">'+fmtN(curPayload.rawResponse.length)+' chars</span></div>';
    h+='<div class="resp-box" style="max-height:400px">'+escH(curPayload.rawResponse)+'<button class="copy-btn" onclick="copyText(curPayload.rawResponse)">复制</button></div></div>';
  }
  if(curPayload.finalResponse&&curPayload.finalResponse!==curPayload.rawResponse){
    h+='<div class="content-section"><div class="cs-title">✅ 最终响应（处理后）<span class="cnt">'+fmtN(curPayload.finalResponse.length)+' chars</span></div>';
    h+='<div class="resp-box diff" style="max-height:400px">'+escH(curPayload.finalResponse)+'<button class="copy-btn" onclick="copyText(curPayload.finalResponse)">复制</button></div></div>';
  }
  if(curPayload.toolCalls&&curPayload.toolCalls.length){
    h+='<div class="content-section"><div class="cs-title">🔧 工具调用结果 <span class="cnt">'+curPayload.toolCalls.length+' 个</span></div>';
    h+='<div class="resp-box">'+syntaxHL(curPayload.toolCalls)+'<button class="copy-btn" onclick="copyText(JSON.stringify(curPayload.toolCalls,null,2))">复制</button></div></div>';
  }
  if(curPayload.retryResponses&&curPayload.retryResponses.length){
    h+='<div class="content-section"><div class="cs-title">🔄 重试历史 <span class="cnt">'+curPayload.retryResponses.length+' 次</span></div>';
    curPayload.retryResponses.forEach(r=>{h+='<div class="retry-item"><div class="retry-header">第 '+r.attempt+' 次重试 — '+escH(r.reason)+'</div><div class="retry-body">'+escH(r.response.substring(0,1000))+(r.response.length>1000?'\n... ('+fmtN(r.response.length)+' chars)':'')+'</div></div>'});
    h+='</div>';
  }
  if(curPayload.continuationResponses&&curPayload.continuationResponses.length){
    h+='<div class="content-section"><div class="cs-title">📎 续写历史 <span class="cnt">'+curPayload.continuationResponses.length+' 次</span></div>';
    curPayload.continuationResponses.forEach(r=>{h+='<div class="retry-item"><div class="retry-header" style="color:var(--orange)">续写 #'+r.index+' (去重后 '+fmtN(r.dedupedLength)+' chars)</div><div class="retry-body">'+escH(r.response.substring(0,1000))+(r.response.length>1000?'\n...':'')+'</div></div>'});
    h+='</div>';
  }
  tc.innerHTML=h||'<div class="empty"><div class="ic">📤</div><p>暂无响应数据</p></div>';
}

// ===== Log rendering =====
function renderLogs(ll){
  const el=document.getElementById('logList');if(!el)return;
  const fil=cLv==='all'?ll:ll.filter(l=>l.level===cLv);
  if(!fil.length){el.innerHTML='<div class="empty"><div class="ic">📋</div><p>暂无日志</p></div>';return}
  const autoExp=document.getElementById('autoExpand').checked;
  // 如果是全局视图（未选中请求），在不同 requestId 之间加分隔线
  let lastRid='';
  el.innerHTML=fil.map(l=>{
    let sep='';
    if(!selId&&l.requestId!==lastRid&&lastRid){
      const title=rmap[l.requestId]?.title||l.requestId;
      sep='<div class="le-sep"></div><div class="le-sep-label">'+escH(title)+' ('+l.requestId+')</div>';
    }
    lastRid=l.requestId;
    return sep+logH(l,autoExp);
  }).join('');
  el.scrollTop=el.scrollHeight;
}

function logH(l,autoExp){
  const t=new Date(l.timestamp).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const d=l.duration!=null?'+'+l.duration+'ms':'';
  let det='';
  if(l.details){
    const raw=typeof l.details==='string'?l.details:JSON.stringify(l.details,null,2);
    const show=autoExp;
    det='<div class="ldt" onclick="togDet(this)">'+(show?'▼ 收起':'▶ 详情')+'</div><div class="ldd" style="display:'+(show?'block':'none')+'">'+syntaxHL(l.details)+'<button class="copy-btn" onclick="event.stopPropagation();copyText(\''+escAttr(raw)+'\')">复制</button></div>';
  }
  return '<div class="le"><div class="tli" style="background:'+(PC[l.phase]||'var(--t3)')+'"></div><span class="lt">'+t+'</span><span class="ld">'+d+'</span><span class="ll '+l.level+'">'+l.level+'</span><span class="ls">'+l.source+'</span><span class="lp">'+l.phase+'</span><div class="lm">'+escH(l.message)+det+'</div></div>';
}

function escAttr(s){return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'')}

function appendLog(en){
  const el=document.getElementById('logList');if(!el)return;
  if(el.querySelector('.empty'))el.innerHTML='';
  if(cLv!=='all'&&en.level!==cLv)return;
  const autoExp=document.getElementById('autoExpand').checked;
  // 分隔线（实时模式）
  if(!selId){
    const children=el.children;
    if(children.length>0){
      const lastEl=children[children.length-1];
      const lastRid=lastEl.getAttribute('data-rid')||'';
      if(lastRid&&lastRid!==en.requestId){
        const title=rmap[en.requestId]?.title||en.requestId;
        const sep=document.createElement('div');
        sep.innerHTML='<div class="le-sep"></div><div class="le-sep-label">'+escH(title)+' ('+en.requestId+')</div>';
        while(sep.firstChild)el.appendChild(sep.firstChild);
      }
    }
  }
  const d=document.createElement('div');d.innerHTML=logH(en,autoExp);
  const n=d.firstElementChild;n.classList.add('ani');n.setAttribute('data-rid',en.requestId);
  el.appendChild(n);
  while(el.children.length>500)el.removeChild(el.firstChild);
  el.scrollTop=el.scrollHeight;
}

// ===== Utils =====
function togDet(el){const d=el.nextElementSibling;if(d.style.display==='none'){d.style.display='block';el.textContent='▼ 收起'}else{d.style.display='none';el.textContent='▶ 详情'}}
function togMsg(el){const b=el.nextElementSibling;const isHidden=b.style.display==='none';b.style.display=isHidden?'block':'none';const m=el.querySelector('.msg-meta');if(m){const t=m.textContent;m.textContent=isHidden?t.replace('▶ 展开','▼ 收起'):t.replace('▼ 收起','▶ 展开')}}
function sL(lv,btn){cLv=lv;document.querySelectorAll('#lvF .lvb').forEach(b=>b.classList.remove('a'));btn.classList.add('a');if(curTab==='logs'){if(selId)renderLogs(logs.filter(l=>l.requestId===selId));else renderLogs(logs.slice(-200))}}

// ===== Clear logs =====
async function clearLogs(){
  if(!confirm('确定清空所有日志？此操作不可恢复。'))return;
  try{
    await fetch(authQ('/api/logs/clear'),{method:'POST'});
    reqs=[];rmap={};logs=[];selId=null;curPayload=null;
    renderRL();updCnt();updStats();desel();
  }catch(e){console.error(e)}
}

// ===== Keyboard =====
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();document.getElementById('searchIn').focus();return}
  if(e.key==='Escape'){if(document.activeElement===document.getElementById('searchIn')){document.getElementById('searchIn').blur();document.getElementById('searchIn').value='';sq='';renderRL();updCnt()}else{desel()}return}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const q=sq.toLowerCase();const cut=getTimeCutoff();let f=reqs;if(cut)f=f.filter(r=>r.startTime>=cut);if(q)f=f.filter(r=>mS(r,q));if(cFil!=='all')f=f.filter(r=>r.status===cFil);if(!f.length)return;const ci=selId?f.findIndex(r=>r.requestId===selId):-1;let ni;if(e.key==='ArrowDown')ni=ci<f.length-1?ci+1:0;else ni=ci>0?ci-1:f.length-1;selReq(f[ni].requestId);const it=document.querySelector('[data-r="'+f[ni].requestId+'"]');if(it)it.scrollIntoView({block:'nearest'})}
});

document.getElementById('searchIn').addEventListener('input',e=>{sq=e.target.value;renderRL();updCnt()});
document.getElementById('rlist').addEventListener('click',e=>{const el=e.target.closest('[data-r]');if(el)selReq(el.getAttribute('data-r'))});
setInterval(renderRL,30000);
init();
