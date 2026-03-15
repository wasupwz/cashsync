export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPA_URL = 'https://ntcwimuvogtrmomlpupv.supabase.co';
  const SUPA_KEY = 'sb_publishable_eHphopcw7UkaQFAyVqkjPw_81byVSeD';

  const PLANO_MAP = {
    'kyeue5e_806442': 'pro',
    'yv25wqf_806445': 'enterprise'
  };

  async function supaUpdate(table, filter, body) {
    const url = `${SUPA_URL}/rest/v1/${table}?${filter}`;
    await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`
      },
      body: JSON.stringify(body)
    });
  }

  async function supaInsert(table, body) {
    const url = `${SUPA_URL}/rest/v1/${table}`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(body)
    });
  }

  try {
    const payload = req.body;
    const evento = payload.event || payload.type || '';
    const dados  = payload.data || payload;

    const email     = dados.customer?.email || dados.email || '';
    const produtoId = dados.product?.id || dados.product_id || '';
    const plano     = PLANO_MAP[produtoId] || 'pro';
    const orderId   = dados.order_id || dados.id || '';
    const subId     = dados.subscription_id || '';
    const proxVenc  = dados.next_billing_date
      ? new Date(dados.next_billing_date).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // COMPRA APROVADA
    if (['purchase.approved','order.paid','purchase.complete'].includes(evento)) {
      await supaInsert('pagamentos', {
        email_comprador: email, plano, status: 'aprovado',
        valor: (dados.amount || 0) / 100,
        cakto_order_id: orderId, cakto_subscription_id: subId,
        metodo_pagamento: dados.payment_method || 'cartao',
        proximo_vencimento: proxVenc, criado_em: new Date().toISOString()
      });
      await supaUpdate('profiles', `email=eq.${encodeURIComponent(email)}`, {
        plano, status_assinatura: 'ativo',
        assinatura_id: subId, proximo_pagamento: proxVenc,
        atualizado_em: new Date().toISOString()
      });
      return res.status(200).json({ success: true, message: 'Plano ativado: ' + plano });
    }

    // RENOVAÇÃO MENSAL
    if (['subscription.renewed','subscription.charged'].includes(evento)) {
      await supaInsert('pagamentos', {
        email_comprador: email, plano, status: 'aprovado',
        valor: (dados.amount || 0) / 100,
        cakto_order_id: orderId, cakto_subscription_id: subId,
        metodo_pagamento: 'cartao_recorrente',
        proximo_vencimento: proxVenc, criado_em: new Date().toISOString()
      });
      await supaUpdate('profiles', `email=eq.${encodeURIComponent(email)}`, {
        status_assinatura: 'ativo', proximo_pagamento: proxVenc,
        atualizado_em: new Date().toISOString()
      });
      await supaInsert('cobrancas_mensais', {
        plano, valor: (dados.amount || 0) / 100,
        mes_referencia: new Date().toISOString().slice(0,7) + '-01',
        status: 'pago', cakto_order_id: orderId
      });
      return res.status(200).json({ success: true, message: 'Renovação processada' });
    }

    // CANCELAMENTO
    if (['subscription.cancelled','subscription.canceled'].includes(evento)) {
      await supaUpdate('profiles', `email=eq.${encodeURIComponent(email)}`, {
        status_assinatura: 'cancelado', atualizado_em: new Date().toISOString()
      });
      return res.status(200).json({ success: true, message: 'Cancelamento processado' });
    }

    // FALHA NO PAGAMENTO
    if (evento === 'subscription.payment_failed') {
      await supaUpdate('profiles', `email=eq.${encodeURIComponent(email)}`, {
        status_assinatura: 'expirado', atualizado_em: new Date().toISOString()
      });
      return res.status(200).json({ success: true, message: 'Falha registrada' });
    }

    return res.status(200).json({ success: true, message: 'Evento ignorado' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
