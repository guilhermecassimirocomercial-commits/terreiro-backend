import { MercadoPagoConfig, Payment } from 'mercadopago';
import admin from 'firebase-admin';

// --- CONFIGURAÇÃO ALTERNATIVA DO FIREBASE ADMIN ---
// Este método é mais robusto, pois usa variáveis de ambiente separadas e mais simples.
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // O replace é necessário porque a Vercel não lida bem com quebras de linha em variáveis.
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
  }
} catch (error) {
  console.error('Falha na inicialização do Firebase Admin:', error);
}
const db = admin.firestore();

// --- FUNÇÃO PRINCIPAL ---
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Método não permitido' });
    }

    try {
        const { chargeId, memberId } = req.body;

        if (!chargeId || !memberId) {
            return res.status(400).json({ success: false, error: 'chargeId e memberId são obrigatórios' });
        }

        const chargeRef = db.collection('monthly_charges').doc(chargeId);
        const chargeDoc = await chargeRef.get();

        if (!chargeDoc.exists) {
            return res.status(404).json({ success: false, error: 'Cobrança não encontrada' });
        }
        const chargeData = chargeDoc.data();

        const memberDoc = await db.collection('members').doc(memberId).get();
        if (!memberDoc.exists) {
            return res.status(404).json({ success: false, error: 'Membro não encontrado' });
        }
        const memberData = memberDoc.data();
        
        const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
        const payment = new Payment(client);

        const amountToPay = chargeData.totalDue - chargeData.amountPaid;
        if (amountToPay <= 0) {
            return res.status(400).json({ success: false, error: 'Esta cobrança já foi paga' });
        }

        const paymentResponse = await payment.create({
            body: {
                transaction_amount: parseFloat(amountToPay.toFixed(2)),
                description: `Mensalidade ${chargeData.monthYear} - ${chargeData.memberName}`,
                payment_method_id: 'pix',
                external_reference: chargeId,
                payer: {
                    email: memberData.email,
                    first_name: memberData.name.split(' ')[0],
                    last_name: memberData.name.split(' ').slice(1).join(' ') || memberData.name.split(' ')[0],
                },
            }
        });

        const pixData = {
            payment_id: paymentResponse.id,
            qr_code: paymentResponse.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: paymentResponse.point_of_interaction.transaction_data.qr_code_base64,
        };
        
        res.status(200).json({ success: true, pixData });

    } catch (error) {
        console.error('Erro ao gerar PIX:', error.cause || error.message);
        res.status(500).json({ success: false, error: 'Erro interno no servidor ao gerar PIX.' });
    }
}

