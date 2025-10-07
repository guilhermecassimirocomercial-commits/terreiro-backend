import admin from 'firebase-admin';

// --- CONFIGURAÇÃO ALTERNATIVA DO FIREBASE ADMIN ---
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
  }
} catch (error) {
  console.error('Falha na inicialização do Firebase Admin no webhook:', error);
}
const db = admin.firestore();

// --- FUNÇÃO PRINCIPAL DO WEBHOOK ---
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method === 'GET') {
        return res.status(200).send('Webhook endpoint está ativo.');
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const notification = req.body;
        
        if (notification.type === 'payment') {
            console.log('Notificação de pagamento recebida:', notification.data.id);
            
            const paymentDetailsResponse = await fetch(`https://api.mercadopago.com/v1/payments/${notification.data.id}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`
                }
            });
            const paymentDetails = await paymentDetailsResponse.json();

            if (paymentDetails.status === 'approved' && paymentDetails.external_reference) {
                const chargeId = paymentDetails.external_reference;
                const chargeRef = db.collection('monthly_charges').doc(chargeId);
                
                console.log(`Pagamento aprovado para a cobrança: ${chargeId}. Atualizando Firestore...`);

                await chargeRef.update({
                    status: 'Paga',
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

        res.status(200).send('Notificação recebida');

    } catch (error) {
        console.error('Erro no webhook:', error);
        res.status(500).send('Erro interno ao processar o webhook');
    }
}

