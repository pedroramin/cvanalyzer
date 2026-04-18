import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizePaidStatus(value) {
  const v = String(value || '').toLowerCase();
  return ['paid', 'approved', 'completed', 'confirmed', 'aprovado'].includes(v);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.CS_WEBHOOK_SECRET;

    if (secret) {
      const signature =
        req.headers['x-checkoutseguro-signature'] ||
        req.headers['x-webhook-signature'] ||
        req.headers['x-signature'];

      if (signature) {
        const bodyString = JSON.stringify(req.body);
        const hmac = crypto
          .createHmac('sha256', secret)
          .update(bodyString)
          .digest('hex');

        const trusted = `sha256=${hmac}`;

        if (signature !== trusted) {
          console.error('[webhook-cs] assinatura invalida');
          return res.status(401).json({ error: 'Assinatura invalida' });
        }
      }
    }

    const body = req.body || {};
    console.log('[webhook-cs] body:', body);

    const referencia =
      body.ref ||
      body.reference ||
      body.external_reference ||
      body.metadata?.ref ||
      body.metadata?.reference ||
      null;

    const status =
      body.status ||
      body.payment_status ||
      body.situation ||
      body.event_status ||
      null;

    const transactionId =
      body.order_id ||
      body.transaction_id ||
      body.payment_id ||
      body.id ||
      null;

    if (!referencia) {
      console.error('[webhook-cs] referencia ausente');
      return res.status(400).json({ error: 'Referencia ausente' });
    }

    const { data: pedido, error: pedidoError } = await sb
      .from('pedidos')
      .select('*')
      .eq('referencia', referencia)
      .maybeSingle();

    if (pedidoError) {
      console.error('[webhook-cs] erro ao buscar pedido:', pedidoError);
      return res.status(500).json({ error: 'Erro ao buscar pedido' });
    }

    if (!pedido) {
      console.error('[webhook-cs] pedido nao encontrado:', referencia);
      return res.status(404).json({ error: 'Pedido nao encontrado' });
    }

    if (pedido.credited) {
      console.log('[webhook-cs] pedido ja creditado:', referencia);
      return res.status(200).json({
        ok: true,
        duplicate: true,
        credited: true,
      });
    }

    if (!normalizePaidStatus(status)) {
      await sb
        .from('pedidos')
        .update({
          status: status || 'pendente',
          transaction_id: transactionId || pedido.transaction_id,
        })
        .eq('id', pedido.id);

      return res.status(200).json({
        ok: true,
        pending: true,
        status: status || 'pendente',
      });
    }

    const { data: wallet, error: walletError } = await sb
      .from('wallets')
      .select('*')
      .eq('user_id', pedido.user_id)
      .maybeSingle();

    if (walletError) {
      console.error('[webhook-cs] erro ao buscar wallet:', walletError);
      return res.status(500).json({ error: 'Erro ao buscar wallet' });
    }

    if (!wallet) {
      const { error: createWalletError } = await sb.from('wallets').insert({
        user_id: pedido.user_id,
        coins: pedido.moedas,
        updated_at: new Date().toISOString(),
      });

      if (createWalletError) {
        console.error('[webhook-cs] erro ao criar wallet:', createWalletError);
        return res.status(500).json({ error: 'Erro ao criar wallet' });
      }
    } else {
      const { error: updateWalletError } = await sb
        .from('wallets')
        .update({
          coins: wallet.coins + pedido.moedas,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', pedido.user_id);

      if (updateWalletError) {
        console.error('[webhook-cs] erro ao atualizar wallet:', updateWalletError);
        return res.status(500).json({ error: 'Erro ao atualizar wallet' });
      }
    }

    const { error: updatePedidoError } = await sb
      .from('pedidos')
      .update({
        status: 'aprovado',
        transaction_id: transactionId || pedido.transaction_id,
        credited: true,
      })
      .eq('id', pedido.id);

    if (updatePedidoError) {
      console.error('[webhook-cs] erro ao atualizar pedido:', updatePedidoError);
      return res.status(500).json({ error: 'Erro ao atualizar pedido' });
    }

    return res.status(200).json({
      ok: true,
      credited: true,
      referencia,
      moedas: pedido.moedas,
      user_id: pedido.user_id,
    });
  } catch (err) {
    console.error('[webhook-cs] erro interno:', err?.message || err);
    return res.status(500).json({
      error: err?.message || 'Erro interno',
    });
  }
}
