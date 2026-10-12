import 'dotenv/config';
import bcrypt from 'bcrypt';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function crearCiudadano() {
  const nombre = 'Rastreo Ciudadano';
  const email = 'rastreopy123@gmail.com';
  const passwordPlano = 'rastreopy123';
  const rol = 'ciudadano';

  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(passwordPlano, salt);

    await pool.query(
      `INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos) 
       VALUES ($1, $2, $3, $4, true, true) 
       ON CONFLICT (correo) 
       DO UPDATE SET contrasena_hash = $3, rol = $4, verificado = true`,
      [nombre, email, passwordHash, rol]
    );
    
    console.log('¡Usuario ciudadano creado/actualizado con éxito en la base de datos!');
  } catch (error) {
    console.error('Error al crear el usuario ciudadano:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

crearCiudadano();