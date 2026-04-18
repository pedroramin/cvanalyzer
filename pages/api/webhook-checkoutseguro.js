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

    if (pedido.codigo) {
      console.log('[webhook-cs] pedido ja entregue:', referencia);
      return res.status(200).json({
        ok: true,
        duplicate: true,
        codigo: pedido.codigo,
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

      console.log('[webhook-cs] pagamento ainda nao aprovado:', status);

      return res.status(200).json({
        ok: true,
        pending: true,
        status: status || 'pendente',
      });
    }

    const { data: codigoDisponivel, error: codigoError } = await sb
      .from('codigos')
      .select('*')
      .eq('usado', false)
      .order('created_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();

    if (codigoError) {
      console.error('[webhook-cs] erro ao buscar codigo:', codigoError);
      return res.status(500).json({ error: 'Erro ao buscar codigo' });
    }

    if (!codigoDisponivel) {
      console.error('[webhook-cs] sem codigos disponiveis');
      return res.status(200).json({
        ok: false,
        message: 'Sem codigos disponiveis',
      });
    }

    const { data: codigoAtualizado, error: reservarError } = await sb
      .from('codigos')
      .update({
        usado: true,
        pedido_id: pedido.id,
        usado_em: new Date().toISOString(),
      })
      .eq('id', codigoDisponivel.id)
      .eq('usado', false)
      .select()
      .maybeSingle();

    if (reservarError) {
      console.error('[webhook-cs] erro ao reservar codigo:', reservarError);
      return res.status(500).json({ error: 'Erro ao reservar codigo' });
    }

    if (!codigoAtualizado) {
      console.error('[webhook-cs] codigo ja foi reservado em paralelo');
      return res.status(409).json({ error: 'Codigo indisponivel, tente novamente' });
    }

    const { error: updatePedidoError } = await sb
      .from('pedidos')
      .update({
        status: 'aprovado',
        codigo: codigoDisponivel.codigo,
        transaction_id: transactionId || pedido.transaction_id,
      })
      .eq('id', pedido.id);

    if (updatePedidoError) {
      console.error('[webhook-cs] erro ao atualizar pedido:', updatePedidoError);
      return res.status(500).json({ error: 'Erro ao atualizar pedido' });
    }

    console.log(
      `[webhook-cs] codigo entregue | ref=${referencia} | pagamento=${transactionId} | codigo=${codigoDisponivel.codigo}`
    );

    return res.status(200).json({
      ok: true,
      delivered: true,
      referencia,
      codigo: codigoDisponivel.codigo,
    });
  } catch (err) {
    console.error('[webhook-cs] erro interno:', err?.message || err);
    return res.status(500).json({
      error: err?.message || 'Erro interno',
    });
  }
}
