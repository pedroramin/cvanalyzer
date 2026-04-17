// ═══════════════════════════════════════════════════════════════════════════
// /api/webhook-checkoutseguro.js — Recebe postback do CheckoutSeguro e credita moedas
// Deploy em Vercel / Next.js API Route
// ═══════════════════════════════════════════════════════════════════════════
//
// Variáveis de ambiente necessárias:
//   SUPABASE_URL=https://yirgryvtafquahmkwiit.supabase.co
//   CS_WEBHOOK_SECRET=SUA_CHAVE_SECRETA   ← configure no painel CheckoutSeguro
//
// No painel CheckoutSeguro → Webhooks/Postback, adicione o endpoint:
//   URL: https://seudominio.com/api/webhook-checkoutseguro
//   Método: POST
//   Evento: payment_confirmed (ou equivalente da plataforma)
//
// O CheckoutSeguro envia os parâmetros que você configurou na URL de retorno:
//   uid, email, coins, ref  — conforme passados no checkout do front-end
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Mapa de coins por código de plano — deve bater com CHECKOUT_URLS no front
const PLAN_COINS = {
  'cs_5moedas':  5,
  'cs_20moedas': 20,
  'cs_50moedas': 50,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Validação de assinatura (se o GGCheckout suportar) ───────────────────
  // Consulte a documentação do GGCheckout para o header/campo de assinatura.
  // Exemplo genérico — adapte conforme a plataforma:
  const secret = process.env.CS_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-checkoutseguro-signature'] || req.headers['x-webhook-signature'];
    if (signature) {
      const body    = JSON.stringify(req.body);
      const hmac    = crypto.createHmac('sha256', secret).update(body).digest('hex');
      const trusted = `sha256=${hmac}`;
      if (signature !== trusted) {
        console.error('[webhook-cs] Assinatura inválida:', signature);
        return res.status(401).json({ error: 'Assinatura inválida' });
      }
    }
  }

  // ── Extrai dados do postback ──────────────────────────────────────────────
  // O GGCheckout pode enviar os parâmetros como JSON body ou form-encoded.
  // Ajuste os nomes de campos conforme a documentação da plataforma.
  const body = req.body || {};

  // Campos enviados pelo front-end como parâmetros de retorno (repassados pelo GGCheckout no postback)
  const userId   = body.uid   || body.user_id || body.metadata?.uid;
  const coinsRaw = body.coins || body.metadata?.coins;
  const priceId  = body.ref   || body.metadata?.ref;
  const status   = body.status || body.payment_status || 'paid'; // campo de status do GGCheckout
  const orderId  = body.order_id || body.transaction_id || body.id || null;

  // ── Verifica se o pagamento foi confirmado ────────────────────────────────
  // Adapte o valor conforme o GGCheckout retornar (ex: 'paid', 'approved', 'completed')
  const isPaid = ['paid', 'approved', 'completed', 'confirmed'].includes(
    String(status).toLowerCase()
  );

  if (!isPaid) {
    console.log('[webhook-cs] Pagamento não confirmado, status:', status);
    return res.status(200).json({ received: true, skipped: true });
  }

  if (!userId) {
    console.error('[webhook-cs] userId ausente no postback');
    return res.status(400).json({ error: 'userId ausente' });
  }

  // Determina quantas moedas creditiar
  const coinsNum = parseInt(coinsRaw, 10) || PLAN_COINS[priceId] || 0;
  if (coinsNum <= 0) {
    console.error('[webhook-cs] coins inválido:', coinsRaw, priceId);
    return res.status(400).json({ error: 'coins inválido' });
  }

  try {
    // ── Idempotência: evita creditar duas vezes o mesmo pedido ───────────────
    if (orderId) {
      const { data: existing } = await sb
        .from('purchases')
        .select('status')
        .eq('stripe_session_id', orderId) // reusando a coluna para armazenar o order_id do GGCheckout
        .single();

      if (existing?.status === 'completed') {
        console.log('[webhook-cs] Pedido já processado:', orderId);
        return res.status(200).json({ received: true, duplicate: true });
      }
    }

    // ── Busca perfil do usuário ───────────────────────────────────────────────
    const { data: profile, error: profileErr } = await sb
      .from('profiles')
      .select('coins')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      console.error('[webhook-cs] Perfil não encontrado para userId:', userId);
      return res.status(404).json({ error: 'Perfil não encontrado' });
    }

    const newCoins = (profile.coins || 0) + coinsNum;

    // ── Atualiza saldo do usuário ─────────────────────────────────────────────
    await sb
      .from('profiles')
      .update({ coins: newCoins, updated_at: new Date().toISOString() })
      .eq('id', userId);

    // ── Upsert na tabela de compras (cria ou atualiza) ────────────────────────
    const purchaseData = {
      user_id:          userId,
      stripe_session_id: orderId,   // reutilizando coluna para order_id do GGCheckout
      coins_granted:    coinsNum,
      amount_cents:     body.amount_cents || body.amount || 0,
      status:           'completed',
    };

    if (orderId) {
      // Tenta atualizar a compra pending existente
      const { error: updErr } = await sb
        .from('purchases')
        .update({ status: 'completed', stripe_payment_id: orderId })
        .eq('user_id', userId)
        .eq('coins_granted', coinsNum)
        .eq('status', 'pending');

      // Se não havia pending (postback chegou antes do insert), cria novo registro
      if (updErr) {
        await sb.from('purchases').insert(purchaseData);
      }
    } else {
      await sb.from('purchases').insert(purchaseData);
    }

    console.log(`[webhook-cs] ✓ ${coinsNum} moedas creditadas → userId=${userId} | novoSaldo=${newCoins}`);
    return res.status(200).json({ received: true, coins_granted: coinsNum, new_balance: newCoins });

  } catch (err) {
    console.error('[webhook-cs] Erro interno:', err.message);
    return res.status(500).json({ error: 'Erro interno ao creditar moedas.' });
  }
}
