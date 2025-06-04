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

// ✅ Usa la clave service_role en backend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  let buf;
  try {
    buf = await buffer(req);
  } catch (err) {
    console.error('❌ Error al leer el buffer:', err.message);
    return res.status(400).send('Invalid body');
  }

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, secret);
  } catch (err) {
    console.error('❌ Verificación fallida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Evento recibido:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object;

    const email = session?.customer_details?.email;
    const productId = session?.client_reference_id;

    console.log("📩 Datos recibidos:");
    console.log(" - Email:", email);
    console.log(" - Producto ID:", productId);

    if (!email || !productId) {
      console.error('❌ Faltan datos del usuario o producto');
      return res.status(400).send('Missing metadata');
    }

    const { data: membresias } = await supabase
      .from('membresias')
      .select('*')
      .eq('stripe_product_id', productId);

    const membresia = membresias?.[0];
    if (!membresia) {
      console.error('❌ Membresía no encontrada:', productId);
      return res.status(404).send('Membresía no encontrada');
    }

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{ email, rol: 'estudiante' }])
        .select()
        .single();

      if (error) {
        console.error('❌ Error al crear usuario:', error.message);
        return res.status(500).send('No se pudo crear el usuario');
      }

      user = newUser;
      console.log('✅ Usuario creado:', user.id);
    } else {
      console.log('👤 Usuario ya existía:', user.id);
    }

    const { error: insertError } = await supabase
      .from('usuario_membresias')
      .insert([
        {
          usuario_id: user.id,
          membresia_id: membresia.id,
          horas_disponibles: membresia.horas_semanales,
        },
      ]);

    if (insertError) {
      console.error('❌ Error al asignar membresía:', insertError.message);
      return res.status(500).send('No se pudo asignar membresía');
    }

    console.log('✅ Membresía asignada correctamente.');
  } else {
    console.log('ℹ️ Evento ignorado:', event.type);
  }

  res.status(200).json({ received: true });
}
