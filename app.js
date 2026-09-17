const C={expense:["식비","교통","쇼핑","고정비","여가","의료","교육","생활","기타"],income:["급여","부수입","용돈","이자/배당","환급","기타"]};
const $=id=>document.getElementById(id);
const won=n=>new Intl.NumberFormat("ko-KR",{style:"currency",currency:"KRW",maximumFractionDigits:0}).format(n);
const ym=d=>d.slice(0,7);
const now=new Date(), today=now.toISOString().slice(0,10), thisMonth=today.slice(0,7);
let transactions=JSON.parse(localStorage.getItem("hb_transactions")||"[]");
let debts=JSON.parse(localStorage.getItem("hb_debts")||"[]");
$("date").value=today;$("monthFilter").value=thisMonth;$("dashMonthInput").value=thisMonth;

function save(){localStorage.setItem("hb_transactions",JSON.stringify(transactions));localStorage.setItem("hb_debts",JSON.stringify(debts))}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function type(){return document.querySelector('input[name="type"]:checked').value}
function refreshCats(){let a=C[type()];$("category").innerHTML=a.map(x=>`<option>${x}</option>`).join("")}
document.querySelectorAll('input[name="type"]').forEach(x=>x.onchange=refreshCats);refreshCats();

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active")});

function monthData(m){return transactions.filter(t=>ym(t.date)===m)}
function renderSummary(m){
 let a=monthData(m),inc=a.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0),exp=a.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
 $("incomeTotal").textContent=won(inc);$("expenseTotal").textContent=won(exp);$("balanceTotal").textContent=won(inc-exp);
 $("debtTotal").textContent=won(debts.reduce((s,d)=>s+d.remaining,0));$("dashMonth").textContent=m.slice(0,4)+"년 "+Number(m.slice(5))+"월";
}
function renderDashboard(){
 let m=$("dashMonthInput").value,a=monthData(m),ex=a.filter(t=>t.type==="expense");
 renderSummary(m);
 let map={};ex.forEach(t=>map[t.category]=(map[t.category]||0)+t.amount);
 let entries=Object.entries(map).sort((a,b)=>b[1]-a[1]),max=entries[0]?.[1]||1;
 $("categoryEmpty").style.display=entries.length?"none":"block";
 $("categoryBars").innerHTML=entries.map(([k,v])=>`<div class="bar-row"><span>${esc(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%"></div></div><span class="bar-money">${won(v)}</span></div>`).join("");
 let recent=[...a].sort((x,y)=>y.date.localeCompare(x.date)||y.createdAt-x.createdAt).slice(0,6);
 $("recentEmpty").style.display=recent.length?"none":"block";
 $("recentList").innerHTML=recent.map(t=>`<div class="recent-item"><div><b>${esc(t.description)}</b><div class="meta">${t.date} · ${esc(t.category)}</div></div><span class="money ${t.type}">${t.type==="income"?"+":"-"}${won(t.amount)}</span></div>`).join("");
}
function renderTransactions(){
 let m=$("monthFilter").value,tf=$("typeFilter").value,cf=$("categoryFilter").value,a=monthData(m);
 let cats=[...new Set(a.map(t=>t.category))],old=cf;
 $("categoryFilter").innerHTML='<option value="all">카테고리</option>'+cats.map(c=>`<option>${esc(c)}</option>`).join("");
 if(cats.includes(old))$("categoryFilter").value=old;
 let list=a.filter(t=>tf==="all"||t.type===tf).filter(t=>$("categoryFilter").value==="all"||t.category===$("categoryFilter").value).sort((x,y)=>y.date.localeCompare(x.date)||y.createdAt-x.createdAt);
 $("monthLabel").textContent=m.slice(0,4)+"년 "+Number(m.slice(5))+"월";
 $("empty").style.display=list.length?"none":"block";
 $("transactionList").innerHTML=list.map(t=>`<div class="transaction"><div class="date-text">${t.date.slice(5).replace("-",".")}</div><div><div class="desc">${esc(t.description)}</div><div class="meta">${esc(t.category)} · ${esc(t.payment)}</div></div><div class="money ${t.type}">${t.type==="income"?"+":"-"}${won(t.amount)}</div><button class="delete" onclick="removeTransaction('${t.id}')">×</button></div>`).join("");
}
window.removeTransaction=id=>{if(confirm("이 거래를 삭제할까요?")){transactions=transactions.filter(t=>t.id!==id);save();renderAll()}};

$("transactionForm").onsubmit=e=>{e.preventDefault();transactions.push({id:crypto.randomUUID?.()||String(Date.now()),createdAt:Date.now(),type:type(),date:$("date").value,category:$("category").value,description:$("description").value.trim(),amount:Number($("amount").value),payment:$("payment").value});save();e.target.reset();$("date").value=today;refreshCats();renderAll()};

$("debtForm").onsubmit=e=>{e.preventDefault();let p=Number($("principal").value);debts.push({id:crypto.randomUUID?.()||String(Date.now()),type:$("debtType").value,creditor:$("creditor").value.trim(),name:$("debtName").value.trim(),principal:p,remaining:p,repaid:0,memo:$("debtMemo").value.trim()});save();e.target.reset();renderAll();alert("채무가 등록되었습니다.")};

function debtTypeLabel(t){return t==="loan"?"금융기관 대출":t==="personal"?"개인 채무":"기타 채무"}
window.repayDebt=id=>{let d=debts.find(x=>x.id===id);let input=document.querySelector(`[data-repay="${id}"]`),v=Number(input.value);if(!v||v<=0)return alert("상환 금액을 입력해주세요.");if(v>d.remaining)return alert("남은 채무보다 많이 상환할 수 없습니다.");d.remaining-=v;d.repaid+=v;transactions.push({id:crypto.randomUUID?.()||String(Date.now()),createdAt:Date.now(),type:"expense",date:today,category:"대출상환",description:`${d.creditor} - ${d.name} 상환`,amount:v,payment:"계좌이체",debtId:id});save();renderAll();input.value=""};
window.deleteDebt=id=>{if(confirm("이 채무를 삭제할까요? 기존 상환 거래는 유지됩니다.")){debts=debts.filter(d=>d.id!==id);save();renderAll()}};

function renderDebts(){
 $("allDebtTotal").textContent=won(debts.reduce((s,d)=>s+d.remaining,0));$("debtTotal").textContent=won(debts.reduce((s,d)=>s+d.remaining,0));
 $("debtEmpty").style.display=debts.length?"none":"block";
 $("debtList").innerHTML=debts.map(d=>{let pct=d.principal?Math.min(100,d.repaid/d.principal*100):100;return `<div class="debt-card"><div class="debt-top"><div><span class="badge">${debtTypeLabel(d.type)}</span><div class="debt-name">${esc(d.name)}</div><div class="creditor">${esc(d.creditor)}${d.memo?" · "+esc(d.memo):""}</div></div><button class="delete" onclick="deleteDebt('${d.id}')">×</button></div><div class="debt-progress"><div style="width:${pct}%"></div></div><div class="debt-numbers"><span>남은 원금 <b>${won(d.remaining)}</b></span><span>상환 ${pct.toFixed(0)}%</span></div>${d.remaining>0?`<div class="repay"><input data-repay="${d.id}" type="number" min="1" max="${d.remaining}" placeholder="상환 금액"><button onclick="repayDebt('${d.id}')">상환 등록</button></div>`:`<div class="paid">✓ 전액 상환 완료</div>`}</div>`}).join("");
}
function renderAll(){renderSummary($("dashMonthInput").value);renderDashboard();renderTransactions();renderDebts()}
$("monthFilter").onchange=renderTransactions;$("typeFilter").onchange=renderTransactions;$("categoryFilter").onchange=renderTransactions;$("dashMonthInput").onchange=renderDashboard;

$("resetBtn").onclick=()=>{if(confirm("모든 가계부와 채무 데이터를 삭제할까요?")){transactions=[];debts=[];save();renderAll()}};

let deferredPrompt;$("installBtn").hidden=true;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false});
$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").hidden=true}};
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
renderAll();
