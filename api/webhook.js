import admin from 'firebase-admin';

// --- CONFIGURAÇÃO DO FIREBASE ADMIN ---
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    });
  }
} catch (error) {
  console.error('Falha na inicialização do Firebase Admin no webhook:', error);
}
const db = admin.firestore();

// --- FUNÇÃO PRINCIPAL DO WEBHOOK ---
export default async function handler(req, res) {
  // --- INÍCIO DA CORREÇÃO DE CORS (Boa prática) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  // --- FIM DA CORREÇÃO DE CORS ---

  // Responde a requisições GET para validação do webhook pelo Mercado Pago.
  if (req.method === 'GET') {
    console.log("Webhook URL verificado com sucesso pelo Mercado Pago.");
    return res.status(200).send('Webhook endpoint está ativo.');
  }
  
  // Apenas processa requisições POST, que são as notificações de pagamento.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const notification = req.body;
    
    // Verifica se a notificação é sobre um pagamento.
    if (notification.type === 'payment') {
      console.log('Notificação de pagamento recebida:', notification.data.id);
      
      // Usa fetch para obter os detalhes do pagamento.
      const paymentDetailsResponse = await fetch(`https://api.mercadopago.com/v1/payments/${notification.data.id}`, {
        headers: {
          'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`
        }
      });
      const paymentDetails = await paymentDetailsResponse.json();

      // Verifica se o pagamento foi aprovado e se tem a nossa referência.
      if (paymentDetails.status === 'approved' && paymentDetails.external_reference) {
        const chargeId = paymentDetails.external_reference;
        const chargeRef = db.collection('monthly_charges').doc(chargeId);
        
        console.log(`Pagamento aprovado para a cobrança: ${chargeId}. Atualizando Firestore...`);

        // Atualiza o documento da cobrança no Firestore.
        await chargeRef.update({
          status: 'Paga',
          // Garante que o valor pago reflete o total da transação.
          amountPaid: admin.firestore.FieldValue.increment(paymentDetails.transaction_amount),
          paymentDetails: {
            paymentId: paymentDetails.id,
            paidAt: new Date().toISOString(),
            method: 'PIX'
          }
        });
        
        console.log(`Cobrança ${chargeId} atualizada para "Paga".`);
      }
    }

    // Responde ao Mercado Pago para confirmar o recebimento.
    res.status(200).send('Notificação recebida');

  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).send('Erro interno ao processar o webhook');
  }
}

