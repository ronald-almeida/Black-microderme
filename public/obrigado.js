const $=id=>document.getElementById(id);
async function confirm(){
  try{
    const response=await fetch('/api/status',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error();const result=await response.json();
    if(result.status!=='paid'){$('thanks-title').textContent='Pagamento ainda não confirmado';$('thanks-message').textContent='Volte ao checkout para acompanhar o Pix. Sua inscrição será confirmada após a aprovação do pagamento.';return;}
    $('success-icon').textContent='✓';$('thanks-title').textContent='Obrigado pela sua compra!';$('thanks-message').textContent='Entre em contato com o suporte para liberar seu acesso.';
    $('receipt').hidden=false;$('order-reference').textContent=result.reference;$('next-steps').hidden=false;
    $('thanks-link').href='https://wa.me/5575988393742?text='+encodeURIComponent('Olá! Comprei o Método Microderme e gostaria de liberar meu acesso.');
    $('thanks-link').textContent='Liberar meu acesso';$('thanks-link').target='_blank';$('thanks-link').rel='noopener noreferrer';
  }catch{$('success-icon').textContent='↻';$('thanks-title').textContent='Não foi possível verificar agora';$('thanks-message').textContent='Volte ao checkout para consultar o status. Esta página só confirma a compra após a validação do pagamento.';}
}
confirm();
