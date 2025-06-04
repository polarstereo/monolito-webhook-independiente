console.log("🧾 Este es el index.js correcto");

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();

// Middleware para manejar el cuerpo de la solicitud como texto sin procesar
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  console.log("🔥 DEBUG process.env.STRIPE_SECRET_KEY =", process.env.STRIPE_SECRET_KEY);

  // Inicializar Stripe dentro del manejador de la ruta
  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16'
  });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  console.log("🔐 STRIPE_SECRET_KEY =", process.env.STRIPE_SECRET_KEY || "undefined");
  console.log("🔐 STRIPE_WEBHOOK_SECRET =", secret || "undefined");

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('❌ Falló la verificación de la firma del webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const supabase = getSupabaseClient();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('🧾 Sesión de checkout recibida:', JSON.stringify(session, null, 2));

    const customerEmail = session.customer_details?.email;
    const productId = session.metadata?.product_id?.trim();

    if (!customerEmail || !productId) {
      console.error('Faltan datos en la sesión:', { customerEmail, productId });
      return res.status(400).send('Faltan metadatos requeridos');
    }

    try {
      const { data: existingAuthUser } = await supabase.auth.admin.getUserByEmail(customerEmail);
      if (!existingAuthUser) {
        await supabase.auth.admin.createUser({
          email: customerEmail,
          email_confirm: true
        });
        console.log('🧑‍🚀 Usuario creado en Supabase Auth:', customerEmail);
      }
    } catch (err) {
      console.error('⚠️ Error al crear usuario en Auth:', err.message);
    }

    const { data: membresiaList } = await supabase
      .from('membresias')
      .select('*')
      .eq('stripe_product_id', productId);

    const membresia = membresiaList?.[0];
    if (!membresia) {
      console.error('❌ Membresía no encontrada:', productId);
      return res.status(404).send('Membresía no encontrada');
    }

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', customerEmail)
      .single();

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert([{ email: customerEmail, rol: 'estudiante' }])
        .select()
        .single();
      user = newUser;
    }

    await supabase.from('usuario_membresias').insert([
      {
        usuario_id: user.id,
        membresia_id: membresia.id,
        horas_disponibles: membresia.horas_semanales
      }
    ]);

    console.log('✅ Membresía asignada correctamente.');
  }

  res.status(200).json({ received: true });
});

// Middleware para manejar JSON en otras rutas
app.use(express.json());

const getSupabaseClient = () => {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;

  console.log("🧪 SUPABASE_URL =", url || "undefined");
  console.log("🧪 SUPABASE_ANON_KEY =", anon ? anon.slice(0, 10) + "..." : "undefined");

  if (!url || !anon) {
    throw new Error("❌ Faltan variables de entorno de Supabase");
  }

  return createClient(url, anon);
};

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Webhook escuchando en puerto ${PORT}`));
