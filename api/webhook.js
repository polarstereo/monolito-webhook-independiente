import { buffer } from 'micro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let buf;
  try {
    buf = await buffer(req);
  } catch (err) {
    console.error('❌ Error al leer el buffer:', err.message);
    return res.status(400).send('Invalid body');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, secret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Evento recibido:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('🧾 Sesión recibida:', JSON.stringify(session, null, 2));

    const email = session.customer_details?.email;
    const productId = session.metadata?.product_id?.trim();

    if (!email || !productId) {
      console.error('❌ Faltan datos del usuario o producto');
      return res.status(400).send('Missing metadata');
    }

    console.log('📥 Creando o buscando usuario con email:', email);

    const { data: membresias, error: errorMembresia } = await supabase
      .from('membresias')
      .select('*')
      .eq('stripe_product_id', productId);

    const membresia = membresias?.[0];

    if (!membresia || errorMembresia) {
      console.error('❌ Membresía no encontrada:', productId);
      return res.status(404).send('Membresía no encontrada');
    }

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (!user) {
      const { data: newUser, error: insertUserError } = await supabase
        .from('users')
        .insert([{ email, rol: 'estudiante' }])
        .select()
        .single();

      if (insertUserError) {
        console.error('❌ Error al crear usuario:', insertUserError.message);
        return res.status(500).send('No se pudo crear el usuario');
      }

      user = newUser;
      console.log('✅ Usuario creado:', user.id);
    } else {
      console.log('👤 Usuario ya existía con ID:', user.id);
    }

    const { error: insertError } = await supabase.from('usuario_membresias').insert([
      {
        usuario_id: user.id,
        membresia_id: membresia.id,
        horas_disponibles: membresia.horas_semanales,
      },
    ]);

    if (insertError) {
      console.error('❌ Error al vincular membresía:', insertError.message);
      return res.status(500).send('No se pudo asignar membresía');
    }

    console.log('✅ Membresía asignada correctamente.');
  } else {
    console.log('⚠️ Evento recibido no es checkout.session.completed');
  }

  console.log('📦 Fin del flujo de webhook');
  res.status(200).json({ received: true });
}
