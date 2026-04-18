// ═══════════════════════════════════════════════════════════════════════════
// /api/webhook-checkoutseguro.js — Recebe postback do CheckoutSeguro e envia código por email
// Deploy em Vercel / Next.js API Route
// ═══════════════════════════════════════════════════════════════════════════
//
// Variáveis de ambiente necessárias:
//   SUPABASE_URL=https://SEU-PROJETO.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY
//   CS_WEBHOOK_SECRET=SUA_CHAVE_SECRETA
//   RESEND_API_KEY=SUA_RESEND_API_KEY
//   RESEND_FROM_EMAIL=Seu Nome <noreply@seudominio.com>
//
// Pré-requisitos no banco:
//   1) Função SQL assign_redeem_code(p_user_id uuid, p_payment_id text)
//   2) Tabela redeem_codes
//   3) Tabela redeemed_codes
//   4) Colunas em redeemed_codes:
//      - payment_id text
//      - email_sent boolean default false
//      - email_sent_at timestamptz null
//
// O CheckoutSeguro envia os parâmetros que você configurou na URL de retorno:
//   uid, email, ref, status, order_id...
// Ajuste os nomes abaixo conforme o payload real da plataforma.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import crypto from 'crypto';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Validação de assinatura ─────────────────────────────────────────────
    const secret = process.env.CS_WEBHOOK_SECRET;

    if (secret) {
      const signature =
        req.headers['x-checkoutseguro-signature'] ||
        req.headers['x-webhook-signature'];

      if (signature) {
        const body = JSON.stringify(req.body);
        const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
        const trusted = `sha256=${hmac}`;

        if (signature !== trusted) {
          console.error('[webhook-cs] Assinatura inválida:', signature);
          return res.status(401).json({ error: 'Assinatura inválida' });
        }
      }
    }

    // ── Extrai dados do postback ────────────────────────────────────────────
    const body = req.body || {};

    const userId =
      body.uid ||
      body.user_id ||
      body.metadata?.uid ||
      null;

    const buyerEmail =
      body.email ||
      body.customer?.email ||
      body.metadata?.email ||
      null;

    const status =
      body.status ||
      body.payment_status ||
      'paid';

    const orderId =
      body.order_id ||
      body.transaction_id ||
      body.id ||
      null;

    // ── Verifica se o pagamento foi confirmado ──────────────────────────────
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

    if (!orderId) {
      console.error('[webhook-cs] orderId ausente no postback');
      return res.status(400).json({ error: 'orderId ausente' });
    }

    // ── Idempotência: evita processar o mesmo pedido duas vezes ─────────────
    const { data: existingRedemption, error: existingRedemptionError } = await sb
      .from('redeemed_codes')
      .select('id, code, email_sent')
      .eq('payment_id', orderId)
      .maybeSingle();

    if (existingRedemptionError) {
      throw existingRedemptionError;
    }

    if (existingRedemption) {
      console.log('[webhook-cs] Pedido já processado:', orderId);
      return res.status(200).json({
        received: true,
        duplicate: true,
        email_sent: existingRedemption.email_sent || false,
      });
    }

    // ── Busca usuário ───────────────────────────────────────────────────────
    // Ajuste a tabela/campos se necessário.
HEAD
   const { data: userRow, error: userError } = await sb
  .from('users')
  .select('id, email')
  .eq('id', userId)
  .maybeSingle();
    const { data: userRow, error: userError } = await sb
      .from('users')
      .select('id, email')
      .eq('id', userId)
      .maybeSingle();
8dcced7 (Remove full_name from webhook user query)

    if (userError) {
      throw userError;
    }

    if (!userRow) {
      console.error('[webhook-cs] Usuário não encontrado:', userId);
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const finalEmail = userRow.email || buyerEmail;

    if (!finalEmail) {
      console.error('[webhook-cs] Email do comprador não encontrado');
      return res.status(400).json({ error: 'Email do comprador ausente' });
    }

    // ── Reserva/atribui código de forma atômica no banco ────────────────────
    const { data: assigned, error: assignError } = await sb.rpc(
      'assign_redeem_code',
      {
        p_user_id: userId,
        p_payment_id: orderId,
      }
    );

    if (assignError) {
      console.error('[webhook-cs] Erro ao atribuir código:', assignError);
      throw assignError;
    }

    const assignedCode = assigned?.[0]?.redeem_code;
    const redeemCodeId = assigned?.[0]?.redeem_code_id;

    if (!assignedCode || !redeemCodeId) {
      throw new Error('Nenhum código foi retornado por assign_redeem_code');
    }

    // ── Envia email com Resend ───────────────────────────────────────────────
    const emailResponse = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: finalEmail,
      subject: 'Seu código de acesso',
      html: `
        <div style="font-family: Arial, sans-serif; color: #111;">
          <h2>Pagamento confirmado</h2>
          <p>Olá!</p>
          <p>Seu código de acesso é:</p>
          <div style="font-size: 28px; font-weight: bold; margin: 16px 0; letter-spacing: 1px;">
            ${assignedCode}
          </div>
          <p>Guarde este código com segurança.</p>
          <p><strong>Pedido:</strong> ${orderId}</p>
        </div>
      `,
    });

    console.log('[webhook-cs] Email enviado:', emailResponse?.data || emailResponse);

    // ── Marca histórico como email enviado ──────────────────────────────────
    const { error: updateError } = await sb
      .from('redeemed_codes')
      .update({
        email_sent: true,
        email_sent_at: new Date().toISOString(),
      })
      .eq('payment_id', orderId)
      .eq('redeem_code_id', redeemCodeId);

    if (updateError) {
      console.error('[webhook-cs] Erro ao marcar email_sent:', updateError);
    }

    console.log(
      `[webhook-cs] ✓ Código enviado → userId=${userId} | payment=${orderId} | codeId=${redeemCodeId}`
    );

    return res.status(200).json({
      received: true,
      delivered: true,
      payment_id: orderId,
      email: finalEmail,
    });
  } catch (err) {
    console.error('[webhook-cs] Erro interno:', err?.message || err);
    return res.status(500).json({
      error: err?.message || 'Erro interno ao enviar código.',
    });
  }
}
