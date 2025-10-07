import { MercadoPagoConfig, Payment } from 'mercadopago';
import admin from 'firebase-admin';

// --- CONFIGURAÇÃO DO FIREBASE ADMIN ---
// Inicializa o Firebase Admin SDK para comunicar com o Firestore a partir do servidor.
// As credenciais são lidas das variáveis de ambiente da Vercel.
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    });
  }
} catch (error) {
  console.error('Falha na inicialização do Firebase Admin:', error);
}
const db = admin.firestore();

// --- FUNÇÃO PRINCIPAL ---
export default async function handler(req, res) {
  // --- INÍCIO DA CORREÇÃO DE CORS ---
  // Define os cabeçalhos para permitir o acesso de origens externas.
  // Para maior segurança, pode substituir '*' pelo URL exato do seu frontend.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // O navegador envia uma requisição "preflight" OPTIONS antes do POST.
  // Respondemos com sucesso para permitir a requisição POST seguinte.
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  // --- FIM DA CORREÇÃO DE CORS ---

  // Valida se o método da requisição é POST.
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  // --- LÓGICA DE GERAÇÃO DO PIX ---
  try {
    const { chargeId, memberId } = req.body;

    if (!chargeId || !memberId) {
      return res.status(400).json({ success: false, error: 'chargeId e memberId são obrigatórios' });
    }

    // Busca os dados da cobrança no Firestore.
    const chargeRef = db.collection('monthly_charges').doc(chargeId);
    const chargeDoc = await chargeRef.get();

    if (!chargeDoc.exists) {
      return res.status(404).json({ success: false, error: 'Cobrança não encontrada' });
    }
    const chargeData = chargeDoc.data();

    // Busca os dados do membro para obter o e-mail.
    const memberDoc = await db.collection('members').doc(memberId).get();
    if (!memberDoc.exists) {
        return res.status(404).json({ success: false, error: 'Membro não encontrado' });
    }
    const memberData = memberDoc.data();

    // Configura o cliente do Mercado Pago.
    const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
    const payment = new Payment(client);

    const amountToPay = chargeData.totalDue - chargeData.amountPaid;
    if (amountToPay <= 0) {
        return res.status(400).json({ success: false, error: 'Esta cobrança já foi paga' });
    }

    // Cria a cobrança PIX.
    const paymentResponse = await payment.create({
      body: {
        transaction_amount: parseFloat(amountToPay.toFixed(2)),
        description: `Mensalidade ${chargeData.monthYear} - ${chargeData.memberName}`,
        payment_method_id: 'pix',
        external_reference: chargeId, // Vincula o pagamento à nossa cobrança.
        payer: {
          email: memberData.email,
          first_name: memberData.name.split(' ')[0],
          last_name: memberData.name.split(' ').slice(1).join(' ') || memberData.name.split(' ')[0],
        },
        // A notification_url foi movida para a configuração do webhook no painel do Mercado Pago.
      }
    });

    // Extrai os dados do PIX da resposta.
    const pixData = {
      payment_id: paymentResponse.id,
      qr_code: paymentResponse.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: paymentResponse.point_of_interaction.transaction_data.qr_code_base64,
    };
    
    // Retorna os dados do PIX com sucesso.
    res.status(200).json({ success: true, pixData });

  } catch (error) {
    console.error('Erro ao gerar PIX:', error.cause || error.message);
    res.status(500).json({ success: false, error: 'Erro interno no servidor ao gerar PIX.' });
  }
}

