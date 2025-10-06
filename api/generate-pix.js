const admin = require('firebase-admin');
const axios = require('axios');

// --- INICIALIZAÇÃO DO FIREBASE ADMIN ---
// Esta parte usa as "Environment Variables" que irá configurar na Vercel para segurança
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
const MP_API_URL = 'https://api.mercadopago.com/v1/payments';

// --- A FUNÇÃO PRINCIPAL ---
export default async function handler(req, res) {
  // Apenas permitir pedidos do tipo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Medida de segurança CORS para permitir que apenas o seu app chame esta função
  res.setHeader('Access-Control-Allow-Origin', '*'); // Em produção, troque '*' pelo URL do seu app
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { chargeId, memberId } = req.body;
    if (!chargeId || !memberId) {
      return res.status(400).json({ success: false, error: "Dados da cobrança em falta." });
    }
    
    // Buscar dados do Firestore
    const chargeDoc = await db.collection("monthly_charges").doc(chargeId).get();
    const memberDoc = await db.collection("members").doc(memberId).get();

    if (!chargeDoc.exists || !memberDoc.exists) {
      return res.status(404).json({ success: false, error: "Cobrança ou membro não encontrado." });
    }

    const chargeData = chargeDoc.data();
    const memberData = memberDoc.data();
    
    // Montar o corpo do pedido para o Mercado Pago
    const paymentPayload = {
      transaction_amount: Number(chargeData.totalDue.toFixed(2)),
      description: `Mensalidade ${chargeData.monthYear} - ${memberData.name}`,
      payment_method_id: 'pix',
      payer: {
        email: memberData.email,
        first_name: memberData.name.split(' ')[0],
      },
      notification_url: `${process.env.VERCEL_URL}/api/webhook`, // URL do nosso webhook
      external_reference: chargeId, // Ligação com a nossa cobrança interna
    };

    // Enviar o pedido para o Mercado Pago
    const response = await axios.post(MP_API_URL, paymentPayload, {
      headers: {
        'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      }
    });

    const payment = response.data;

    // Atualizar a nossa cobrança com o ID do pagamento do Mercado Pago
    await db.collection("monthly_charges").doc(chargeId).update({
        mercadoPagoPaymentId: payment.id
    });
    
    // Retornar os dados do PIX para o frontend
    const pixData = {
      qr_code: payment.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: payment.point_of_interaction.transaction_data.qr_code_base64,
    };
    
    return res.status(200).json({ success: true, pixData });

  } catch (error) {
    console.error("Erro ao gerar PIX:", error.response ? error.response.data : error.message);
    return res.status(500).json({ success: false, error: 'Erro ao comunicar com o gateway de pagamento.' });
  }
}
