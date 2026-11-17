const $ = (id) => document.getElementById(id);
const form=$('checkout-form'), generate=$('generate-button');
let busy=false, pollTimer, failures=0, currentOrder=null;
function showMessage(id,text){$(id).textContent=text;$(id).hidden=!text;}
async function api(path,options={}) {
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:AbortSignal.timeout(45000)});
  let data;try{data=await response.json();}catch{throw new Error('O serviço está indisponível. Tente novamente em instantes.');}
  if(!response.ok){const e=new Error(data.message || 'Não foi possível verificar o pagamento. Tente novamente.');e.data=data;e.status=response.status;throw e;}
  return data;
}
function maskCpf(value){return value.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');}
function maskPhone(value){let d=value.replace(/\D/g,'');if(d.startsWith('55')&&d.length>11)d=d.slice(2);return d.slice(0,11).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{4,5})(\d{4})$/,'$1-$2');}
$('document').addEventListener('input',e=>{e.target.value=maskCpf(e.target.value);});
$('phone').addEventListener('input',e=>{e.target.value=maskPhone(e.target.value);});
function clearErrors(){for(const field of ['name','email','document','phone']){$(`${field}-error`).textContent='';$(field).removeAttribute('aria-invalid');}showMessage('form-error','');}
function activateStep(){ $('step-data').classList.remove('active');$('step-data').removeAttribute('aria-current');$('step-pix').classList.add('active');$('step-pix').setAttribute('aria-current','step');}
function displayOrder(order,focus=false){
  currentOrder=order;clearTimeout(pollTimer);
  if(!order||order.state==='failed'){ $('details-section').hidden=false;$('pix-section').hidden=true;$('exception-section').hidden=true;generate.disabled=false;return; }
  $('details-section').hidden=true;activateStep();
  if(order.status==='paid'){window.location.replace('/obrigado');return;}
  if(order.state!=='ready'||['expired','canceled','refunded','failed'].includes(order.status)){
    $('pix-section').hidden=true;$('exception-section').hidden=false;
    const titles={expired:'Este Pix expirou.',canceled:'Este Pix foi cancelado.',refunded:'Pagamento estornado.',failed:'Pagamento não concluído.'};
    $('exception-title').textContent=titles[order.status]||'Estamos verificando seu pedido';
    $('exception-message').textContent=order.message||'Não pague este código. Entre em contato com a equipe para continuar sua inscrição.';
    $('new-pix').hidden=!['expired','canceled'].includes(order.status);
    if(['creating','uncertain'].includes(order.state))schedule(15000);
    return;
  }
  $('exception-section').hidden=true;$('pix-section').hidden=false;
  $('qr-code').src=order.qrCode;$('pix-code').value=order.emv;
  if(order.expiresAt && Number.isFinite(Date.parse(order.expiresAt))){$('expires').hidden=false;$('expires').textContent=`Validade informada: ${new Date(order.expiresAt).toLocaleString('pt-BR')}`;}
  if(focus){$('pix-section').focus();$('pix-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
  schedule(10000);
}
function schedule(delay){clearTimeout(pollTimer);pollTimer=setTimeout(()=>checkPayment(false),delay);}
async function checkPayment(manual=false){
  if(document.hidden&&!manual){schedule(15000);return;}
  $('check-button').disabled=true;$('retry-status').disabled=true;
  try{
    if(currentOrder?.state==='ready'){
      const result=await api('/api/status');
      if(result.status==='paid'){window.location.replace('/obrigado');return;}
      if(result.status!=='pending'){displayOrder({...currentOrder,...result});return;}
      $('payment-status').textContent=manual?'O pagamento ainda não foi confirmado. A verificação continua automaticamente.':'A confirmação é automática. Você será direcionada assim que o pagamento for confirmado.';
      failures=0;schedule(10000);
    }else{const data=await api('/api/pix');failures=0;displayOrder(data.order);}
  }catch(error){failures++;$('payment-status').textContent='Não conseguimos verificar agora. Seu Pix continua disponível; vamos tentar novamente.';if(manual&&$('pix-section').hidden)$('exception-message').textContent=error.message;schedule(error.status===429?60000:Math.min(60000,10000*failures));}
  finally{$('check-button').disabled=false;$('retry-status').disabled=false;}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;clearErrors();
  if(!form.checkValidity()){form.reportValidity();return;}
  busy=true;generate.disabled=true;generate.setAttribute('aria-busy','true');generate.querySelector('.button-label').textContent='Gerando seu Pix…';
  try{const customer=Object.fromEntries(new FormData(form));const data=await api('/api/pix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(customer)});displayOrder(data.order,true);}
  catch(error){showMessage('form-error',error.message);for(const [key,message]of Object.entries(error.data?.errors||{})){if($(`${key}-error`)){$(`${key}-error`).textContent=message;$(key).setAttribute('aria-invalid','true');}}form.querySelector('[aria-invalid=true]')?.focus();}
  finally{busy=false;generate.disabled=false;generate.removeAttribute('aria-busy');generate.querySelector('.button-label').textContent='Gerar QR Code Pix';}
});
$('copy-button').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('pix-code').value);$('copy-status').textContent='Código copiado! Agora cole no aplicativo do seu banco.';}catch{$('pix-code').focus();$('pix-code').select();$('copy-status').textContent='Selecione e copie o código acima para colar no seu banco.';}});
$('check-button').addEventListener('click',()=>checkPayment(true));$('retry-status').addEventListener('click',()=>checkPayment(true));
$('new-pix').addEventListener('click',async()=>{const button=$('new-pix');button.disabled=true;try{await api('/api/reset',{method:'POST'});currentOrder=null;await initialize();$('step-pix').classList.remove('active');$('step-pix').removeAttribute('aria-current');$('step-data').classList.add('active');$('step-data').setAttribute('aria-current','step');}catch(error){$('exception-message').textContent=error.message;}finally{button.disabled=false;}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentOrder)checkPayment(false);});
window.addEventListener('pagehide',()=>clearTimeout(pollTimer));
async function initialize(){try{await api('/api/session');const data=await api('/api/pix');displayOrder(data.order);showMessage('availability','');}catch(error){showMessage('availability',error.message);generate.disabled=true;}}
initialize();
