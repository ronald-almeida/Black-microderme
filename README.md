# Black Microderme

Página de vendas baseada na referência fornecida, com oferta única de **R$ 297,00 à vista no Pix**, checkout próprio e confirmação de pagamento pela QuantumPay.

## Executar

Node.js 24 e pnpm 11.25.0.

```sh
corepack pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

No sandbox Windows que impede subprocessos do runner, use `node --test --test-isolation=none tests/checkout.test.mjs`.

## Vercel

- Projeto: `black-microderme`
- Repositório: `ronald-almeida/Black-microderme`
- Produção: branch `main`
- Arquivos públicos: `public/`; função Node.js: `api/index.js`; região: São Paulo (`gru1`).
- Blob **privado** `black-microderme-orders`, conectado a produção e preview por OIDC (`BLOB_STORE_ID`). Não usa dados de outros projetos.

Configure **diretamente no painel da Vercel**, em Settings → Environment Variables, sem enviar segredos no chat ou no GitHub:

| Variável | Uso |
|---|---|
| `QUANTUMPAY_API_KEY` | API Key da empresa que recebe o pagamento |
| `QUANTUMPAY_API_SECRET` | API Secret da mesma empresa |
| `CHECKOUT_SESSION_SECRET` | Opcional: segredo aleatório com pelo menos 32 caracteres. Na ausência, deriva uma chave da API Secret com HMAC. Alterá-la invalida as sessões existentes. |
| `APP_URL` | Origem HTTPS pública do checkout; opcional quando página e API estão no mesmo domínio |
| `QUANTUMPAY_WEBHOOK_SECRET` | `signatureSecret` retornado pelo cadastro do webhook; necessário apenas para receber eventos |
| `QUANTUMPAY_POSTBACK_URL` | Opcional: URL HTTPS de postback já configurada e validada pela QuantumPay |

Depois de configurar as variáveis, faça **Redeploy**. O endpoint `/api/health` informa `paymentsConfigured`; ele não testa credenciais nem autoriza uma cobrança. Sem configuração, a página continua acessível, mas a geração de Pix fica indisponível, sem códigos ou aprovações fictícias.

Uma nova sessão de checkout valida a autenticação na QuantumPay e o cache privado antes de liberar o formulário. Essa verificação não gera cobrança e não expõe tokens ao navegador.

## Integração QuantumPay

1. `POST /api/auth`, Basic Auth com `apiKey:apiSecret`. Cache privado do token, usando `expiresIn` em **milissegundos**, com renovação antecipada e trava compartilhada.
2. `POST /api/v1/pix/in/qrcode`: `amountInCents: 29700`, cliente validado, produto e referência interna. O navegador não escolhe o preço. Nome, e-mail, CPF válido e telefone com DDD são obrigatórios.
3. O EMV retornado é a fonte do QR Code PNG e do Pix Copia e Cola. Não há chave Pix estática ou QR fictício em produção.
4. Sessão HTTP-only assinada; pedidos privados com leitura consistente e escrita condicional (ETag). Submissões repetidas na mesma sessão reutilizam o pedido. O limite de geração é de cinco tentativas por IP em dez minutos. Cookies expiram em sete dias; registros técnicos em 90 dias. CPF, telefone e e-mail não são persistidos em texto aberto pelo site.
5. Consulta autenticada `GET /api/v1/transactions/{id}`; exige ID correspondente, valor exato de 29700 e status reconhecido. Navegador consulta a cada dez segundos, servidor reaproveita verificações por quinze segundos e trata indisponibilidade/429. Não há redirecionamento por parâmetro de URL nem botão que marque o pedido como pago.
6. `/obrigado` consulta o servidor novamente e só mostra confirmação para `paid`. Estados `expired`, `canceled` e `refunded` não são aprovação. Nova cobrança só pode substituir um Pix após confirmação de cancelamento/expiração.
7. Timeout na criação tem resultado **incerto**: não repetimos a cobrança automaticamente, pois a documentação de PIX IN não estabelece uma garantia de idempotência do provedor. Nesse caso, conferir a referência na QuantumPay antes de qualquer ação manual. Fechar uma sessão e abrir outro navegador não garante deduplicação entre sessões.

### Webhook e hospedagem Vercel

Rota: `POST /api/webhooks/quantumpay`.

O guia detalhado exige `Quantum-Pay-Signature: t=<timestamp em ms>,v1=<HMAC SHA-256>`. A assinatura é calculada sobre `timestamp + '.' + corpo bruto`, com comparação em tempo constante e tolerância de cinco minutos. Eventos são deduplicados de forma persistente; o status também é consultado na API antes de atualizar o pedido. O resumo `llms.txt` cita outro formato de assinatura: **esta implementação segue o guia detalhado**, sem fallback inseguro.

O guia exige mTLS e descreve uma alternativa `skip-mTLS` para hospedagem compartilhada. Vercel Functions não configura o handshake mTLS do domínio. Antes de habilitar postbacks, confirmar com a QuantumPay a modalidade suportada para sua conta e a emissão da assinatura dos postbacks. Pode ser necessário um proxy com mTLS. A confirmação pelo polling funciona independentemente do webhook, desde que a consulta de transações esteja habilitada na conta.

Documentação consultada:

- [Autenticação](https://docs.quantumpay.com.br/pages/auth/generate-token)
- [Criar Pix](https://docs.quantumpay.com.br/pages/pix-in/create-qrcode)
- [Consulta de status no fluxo Pix](https://docs.quantumpay.com.br/pages/pix-in/overview)
- [Assinatura e mTLS de webhooks](https://docs.quantumpay.com.br/webhook)

## Verificação

Os testes cobrem valor fixo, autenticação, validação de CPF e telefone, concorrência, recuperação de pedido, assinatura e replay de webhook, status pendente/pago/expirado/estornado, sessão adulterada, divergência de valor/ID, indisponibilidade e criação de resultado incerto. A verificação de build confere arquivos e a remoção dos preços/checkout/rastreadores originais.

`node scripts/dev.mjs --demo` habilita apenas no servidor local um teste explicitamente identificado como **sem cobrança real**. Os dados e o QR de teste não são Pix pagáveis. O botão de simulação e as rotas `/_dev/*` não fazem parte dos arquivos públicos nem da função publicada.

**Verificação em produção:** autenticação real da conta e acesso ao armazenamento privado validados; o checkout publicado libera a geração de Pix. Os 16 testes automatizados passaram. Permanecem pendentes a geração e o pagamento de uma cobrança real autorizada, o retorno exato da consulta dessa transação e o webhook da conta. Testes locais não comprovam liquidação bancária real.

## Conteúdo e entrega do curso

Imagens, fontes e conteúdo da página de referência foram copiados para o repositório. Scripts de terceiros, pixels, WordPress e o checkout Hubla foram removidos. Todos os botões de compra abrem `/checkout`.

O anexo de referência do checkout não estava disponível; o checkout foi construído conforme a descrição fornecida. A integração confirma o pagamento e abre a página de obrigado. Após a confirmação, o botão "Liberar meu acesso" abre o WhatsApp do suporte no número +55 (75) 98839-3742 com uma mensagem pronta. O suporte libera o acesso manualmente. Envio de e-mails, criação automática de usuário na área de membros, entrega de bônus e logística do kit não estão integrados. As afirmações da oferta original devem corresponder à entrega realizada pelo vendedor.
