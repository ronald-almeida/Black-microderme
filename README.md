# Black Microderme

Página de vendas com oferta única de **R$ 297,00 à vista no Pix**, checkout próprio e integração Firebot.

## Executar

Node.js 24 e pnpm 11.25.0.

```sh
corepack pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

No sandbox Windows que impede subprocessos do runner:

```sh
node --test --test-isolation=none tests/checkout.test.mjs tests/firebot.test.mjs
```

## Vercel

- Projeto: `black-microderme`; repositório: `ronald-almeida/Black-microderme`; produção: branch `main`.
- Arquivos públicos: `public/`; função Node.js: `api/index.js`; região: São Paulo (`gru1`).
- Blob **privado** `black-microderme-orders`, conectado por OIDC (`BLOB_STORE_ID`).
- Produção: https://black-microderme.vercel.app

Configure segredos diretamente no painel da Vercel, em Settings → Environment Variables → Production. Não envie chaves no chat nem no GitHub.

| Variável | Uso |
|---|---|
| `FIREBOT_API_KEY` | Chave privada `fire_sk_live_...` da conta recebedora. Não usar a chave pública nem a de saque. |
| `CHECKOUT_SESSION_SECRET` | Opcional: segredo estável com pelo menos 32 caracteres. Sem ele, a assinatura das sessões é derivada da chave privada Firebot. Rotacionar a chave derivadora invalida sessões e referências assinadas; reconciliar pedidos ativos antes dessa mudança. |
| `APP_URL` | Origem HTTPS pública. Padrão: `https://black-microderme.vercel.app`. |
| `FIREBOT_WEBHOOK_SECRET` | Opcional: chave secreta da configuração do webhook no painel Firebot. Não presumir que seja a chave da API. |
| `BLOB_STORE_ID` | Identificador do armazenamento privado conectado à Vercel. |
| `BLOB_READ_WRITE_TOKEN` | Alternativa ao OIDC para desenvolvimento; manter apenas em arquivo local ignorado pelo Git. |

Mudanças nas variáveis exigem novo deploy. `/api/health` informa o provedor e se as variáveis necessárias existem; não valida as credenciais. Uma nova sessão em `/api/session` valida o acesso à Firebot e ao armazenamento sem criar cobrança. O resultado de autenticação fica em cache privado por cinco minutos, separado por chave.

## Integração Firebot

Documentação: https://firebotbr.com/integracoes/docs (requer login).

1. Autenticação: `GET https://firebotbr.com/api/v1/auth`, com `x-api-key` apenas no servidor.
2. Criação: `POST /api/v1/pix/create`, com `amount: 297` em **reais**, `productType: DIGITAL`, descrição com referência interna, `storeUrl`, nome, e-mail, CPF e telefone com DDD obrigatórios. O servidor fixa o valor; o navegador não escolhe o preço.
3. A resposta precisa trazer `transactionId`, `amount`, `status` e `pixCopiaECola`. O QR Code é gerado a partir do mesmo EMV exibido no botão Copia e Cola. Não há código pagável fictício em produção.
4. Consulta: `GET /api/v1/pix/{transactionId}`, autenticada. Antes de aprovar, o servidor exige o mesmo identificador, valor exato de R$ 297 e status `PAID`. O navegador consulta a cada dez segundos; o servidor reaproveita resultados por quinze segundos.
5. `/obrigado` consulta o servidor e só exibe a compra confirmada para pagamento aprovado. Estados de cancelamento, expiração, falha ou estorno não aprovam o pedido.
6. Sessão HTTP-only assinada, pedidos privados, leituras consistentes e escritas condicionais por ETag. Submissões repetidas na mesma sessão reutilizam o pedido. Há limite de cinco tentativas por IP em dez minutos. Cookies duram sete dias; registros técnicos têm retenção de 90 dias. O site não persiste nome, CPF, telefone e e-mail em texto aberto.
7. Timeout ou resposta ambígua ao criar um Pix deixa o pedido em estado **incerto**, sem nova tentativa automática. A documentação consultada não estabelece idempotência para a criação. Conferir a referência no painel Firebot antes de agir manualmente. A deduplicação não se estende a navegadores ou sessões diferentes.

### Webhook opcional

Configure no painel Firebot a URL `https://black-microderme.vercel.app/api/webhooks/firebot` e salve o segredo correspondente em `FIREBOT_WEBHOOK_SECRET` na Vercel. Os eventos tratados são `venda.pendente`, `venda.paga` e `venda.estornada`.

O cabeçalho `x-signature` deve conter o HMAC SHA-256 hexadecimal do corpo bruto. A comparação ocorre em tempo constante. O evento é deduplicado em armazenamento privado e a API de consulta confirma novamente ID, valor e status. Se o evento pago chegar antes da atualização da consulta, a rota retorna 503 para permitir nova entrega, sem marcar o evento como concluído.

O polling funciona sem webhook. O webhook permanece desabilitado enquanto o segredo não estiver configurado. A documentação consultada não exibe exemplo da resposta da consulta nem de um evento de venda; o adaptador exige os campos do contrato de criação e rejeita respostas incompatíveis. Esses retornos ainda precisam ser verificados com uma transação real da conta.

### Migração da QuantumPay

O adaptador e a rota de webhook QuantumPay foram removidos. O código atual não usa `QUANTUMPAY_API_KEY` nem `QUANTUMPAY_API_SECRET`; essas variáveis podem ser excluídas da Vercel após a validação da Firebot.

Pedidos Firebot usam cookie e prefixos próprios. Registros anteriores são preservados até o fim da retenção. Se um visitante ainda tiver o cookie de um pedido antigo não encerrado, o checkout orienta procurar o suporte para conferência, evitando gerar outro Pix automaticamente. A Firebot não consulta nem confirma transações da QuantumPay.

## Verificação

Os 24 testes automatizados cobrem contrato de criação em reais, autenticação, validação dos dados, concorrência, recuperação do pedido, assinatura e repetição de webhook, confirmação de status, adulteração de sessão, divergências de valor/ID, indisponibilidade, resultado incerto e migração de pedidos antigos. O build confere arquivos públicos, referências de assets e importação do servidor.

`node scripts/dev.mjs --demo` habilita um teste local identificado como **sem cobrança real**. O QR de teste não é pagável. Botões de simulação e rotas `/_dev/*` não são publicados.

A autenticação real e a implantação devem ser verificadas após configurar a chave. Os testes automatizados não comprovam geração ou liquidação bancária real. A geração, o pagamento, a resposta da consulta e o webhook de uma cobrança real ainda dependem de validação na conta.

## Entrega do curso

Todos os botões de compra abrem `/checkout`. Após a confirmação do pagamento, a página de obrigado oferece **Liberar meu acesso**, que abre o WhatsApp do suporte **+55 (75) 98839-3742** com uma mensagem pronta. O suporte libera o acesso manualmente. Envio de e-mails, criação automática de usuário, entrega de bônus e logística do kit não estão integrados.
