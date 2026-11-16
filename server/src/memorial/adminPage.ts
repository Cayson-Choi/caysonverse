/**
 * The operator's photo review page (`GET /admin/memorial`, only when CV_ADMIN_KEY_SHA256 is set). Static HTML with no secret:
 * the operator types the review key, which stays in this tab's sessionStorage and goes out as `X-Admin-Key`. Pending photos load
 * through 10-minute signed URLs. Korean UI, approve / reject per photo.
 */
export const ADMIN_PAGE_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>추모관 사진 검토</title>
<style>
body{font-family:system-ui,"Noto Sans KR",sans-serif;margin:0;background:#f6f3ee;color:#2a2622}
header{padding:16px;background:#fff;border-bottom:1px solid #e4ddd2;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
h1{font-size:18px;margin:0 12px 0 0}input{font-size:16px;padding:8px;border:1px solid #cbbfae;border-radius:8px;min-width:220px}
button{font-size:15px;padding:10px 14px;border-radius:8px;border:0;cursor:pointer;min-height:44px}
.go{background:#4b4fd8;color:#fff}.ok{background:#2f8f5b;color:#fff}.no{background:#b5483c;color:#fff}
main{padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{background:#fff;border-radius:12px;padding:12px;box-shadow:0 1px 3px #0002}.card img{width:100%;border-radius:8px;background:#eee}
.meta{font-size:13px;color:#6b6259;margin:6px 0 10px}.row{display:flex;gap:8px}#msg{padding:0 16px;color:#6b6259}
</style></head><body>
<header><h1>추모관 사진 검토</h1><input id="key" type="password" autocomplete="off" placeholder="검토 키"><button class="go" id="load">불러오기</button></header>
<p id="msg">검토 키를 넣고 불러오기를 눌러 주세요.</p><main id="list"></main>
<script>
const $=(id)=>document.getElementById(id);let key=sessionStorage.getItem("cvAdminKey")||"";
async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{...(opt.headers||{}),"X-Admin-Key":key,"Content-Type":"application/json"}});
 if(!r.ok){throw new Error((await r.json().catch(()=>({}))).message||("오류 "+r.status));}return r.json();}
function esc(s){return String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function load(){if($("key").value)key=$("key").value;sessionStorage.setItem("cvAdminKey",key);$("msg").textContent="불러오는 중이에요";
 try{const {items}=await api("/api/memorial/admin/review");$("list").innerHTML="";$("msg").textContent=items.length?("검토할 사진 "+items.length+"장"):"검토할 사진이 없어요.";
  for(const it of items){const d=document.createElement("div");d.className="card";
   d.innerHTML='<img alt="" src="'+esc(it.urls.s512)+'"><div class="meta">'+esc(it.petName)+' · '+esc(it.slotId)+' · '+new Date(it.createdAt).toLocaleString("ko-KR")+'</div><div class="row"><button class="ok">공개하기</button><button class="no">거절하기</button></div>';
   d.querySelector(".ok").onclick=()=>decide(it.photoId,"approve",d);d.querySelector(".no").onclick=()=>decide(it.photoId,"reject",d);$("list").appendChild(d);}
 }catch(e){$("msg").textContent=e.message;}}
async function decide(id,decision,el){try{await api("/api/memorial/admin/photos/"+encodeURIComponent(id),{method:"POST",body:JSON.stringify({decision})});el.remove();}catch(e){alert(e.message);}}
$("load").onclick=load;if(key)load();
</script></body></html>`;
