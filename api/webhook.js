import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe("sk_test_TU_CLAVE_AQUI", {
  apiVersion: '2023-10-16'
});

const supabase = createClient(
  "https://TU_PROYECTO.supabase.co",
  "eyJhbGciOi..." // anon key
);

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const secret = "whsec_TU_CLAVE_WEBHOOK";

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const email = session.customer_details?.email;
    const productId = session.metadata?.product_id?.trim();

    if (!email || !productId) {
      return res.status(400).send('Faltan datos');
    }

    const { data: membresias } = await supabase
      .from('membresias')
      .select('*')
      .eq('stripe_product_id', productId);

    const membresia = membresias?.[0];

    if (!membresia) {
      return res.status(404).send('Membresía no encontrada');
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    let usuario = user;
    if (!usuario) {
      const result = await supabase
        .from('users')
        .insert([{ email, rol: 'estudiante' }])
        .select()
        .single();
      usuario = result.data;
    }

    await supabase.from('usuario_membresias').insert([
      {
        usuario_id: usuario.id,
        membresia_id: membresia.id,
        horas_disponibles: membresia.horas_semanales
      }
    ]);
  }

  return res.status(200).json({ received: true });
}
