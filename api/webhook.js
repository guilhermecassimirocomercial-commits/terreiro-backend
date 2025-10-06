const admin = require('firebase-admin');
const axios = require('axios');

// --- INICIALIZAÇÃO DO FIREBASE ADMIN ---
try {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
} catch (e) {
  console.error('Firebase admin initialization error', e.stack);
}
const db = admin.firestore();

// --- CONFIGURAÇÃO DO MERCADO PAGO ---
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

// --- A FUNÇÃO WEBHOOK ---
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { action, data } = req.body;

    // O evento que nos interessa é 'payment.updated'
    if (action === 'payment.updated') {
      const paymentId = data.id;

      // Buscar os detalhes completos do pagamento na API do Mercado Pago
      const paymentResponse = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` }
      });
      
      const payment = paymentResponse.data;

      // Se o pagamento foi aprovado (pago)
      if (payment.status === 'approved') {
        const chargeId = payment.external_reference; // Usamos a nossa referência interna

        if (chargeId) {
          const chargeRef = db.collection("monthly_charges").doc(chargeId);
          const chargeDoc = await chargeRef.get();

          if (chargeDoc.exists && chargeDoc.data().status !== 'Paga') {
             await chargeRef.update({
                status: "Paga",
                amountPaid: chargeDoc.data().totalDue, // Assume pagamento total
                paidAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Webhook: Cobrança ${chargeId} atualizada para Paga.`);
          }
        }
      }
    }
    
    // Responder ao Mercado Pago com sucesso
    return res.status(200).send("OK");

  } catch (error) {
    console.error("Erro no webhook do Mercado Pago:", error);
    return res.status(500).send("Internal Server Error");
  }
}
