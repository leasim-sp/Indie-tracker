/**
 * npm run auth:google
 *
 * 1. Lee GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET de .env
 * 2. Genera la URL OAuth2 y la abre en el navegador
 * 3. El usuario pega el código (o la URL de redirección completa)
 * 4. Intercambia el código por tokens y escribe GOOGLE_REFRESH_TOKEN en .env
 *
 * Requisito previo en Google Cloud Console:
 *   Credentials → tu OAuth Client ID → "Authorized redirect URIs" → añadir:
 *   http://localhost
 */

import 'dotenv/config';
import { google } from 'googleapis';
import readline from 'readline';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH   = join(__dirname, '../.env');

// ── Validar credenciales ──────────────────────────────────────────────────────

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n[ERROR] GOOGLE_CLIENT_ID y/o GOOGLE_CLIENT_SECRET no están definidos en .env');
  console.error('  Rellena esas variables primero y vuelve a ejecutar npm run auth:google\n');
  process.exit(1);
}

// ── OAuth2 client ─────────────────────────────────────────────────────────────

const REDIRECT_URI = 'http://localhost';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt:      'consent',           // garantiza que Google devuelva refresh_token
  scope: [
    'https://www.googleapis.com/auth/drive.readonly',
  ],
});

// ── Abrir navegador ───────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════');
console.log('  OPE Trainer — Autorización Google Drive              ');
console.log('═══════════════════════════════════════════════════════\n');

const openCmd =
  process.platform === 'win32'  ? `start "" "${authUrl}"` :
  process.platform === 'darwin' ? `open "${authUrl}"` :
                                  `xdg-open "${authUrl}"`;

exec(openCmd, err => {
  if (err) {
    console.log('  No se pudo abrir el navegador automáticamente.');
    console.log('  Abre esta URL manualmente:\n');
    console.log('  ' + authUrl);
  } else {
    console.log('  Navegador abierto.');
  }
  console.log();
});

console.log('  Tras autorizar, Google te redirigirá a:');
console.log('  http://localhost/?code=XXXX&scope=...');
console.log();
console.log('  Esa página no cargará — es normal.');
console.log('  Copia el valor del parámetro "code" de la URL');
console.log('  (o pega la URL completa, el script extrae el código solo).');
console.log();
console.log('  Si ves un aviso "Google no ha verificado esta app"');
console.log('  → haz clic en "Configuración avanzada" → "Ir a (nombre app)".');
console.log();

// ── Leer código del usuario ───────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('  Pega el código o la URL aquí y pulsa Enter: ', async (raw) => {
  rl.close();
  console.log();

  const input = raw.trim();
  if (!input) {
    console.error('[ERROR] No se introdujo ningún código.\n');
    process.exit(1);
  }

  // Aceptar tanto el código suelto como la URL completa de redirección
  let code = input;
  try {
    const url    = new URL(input);
    const param  = url.searchParams.get('code');
    if (param) code = param;
  } catch {
    // no era una URL — usamos el valor tal cual
  }

  // ── Intercambiar código por tokens ─────────────────────────────────────────

  let tokens;
  try {
    ({ tokens } = await oauth2Client.getToken(code));
  } catch (err) {
    const detail = err?.response?.data?.error_description || err.message;
    console.error(`[ERROR] No se pudo obtener el token: ${detail}`);
    console.error('  Asegúrate de usar el código de la redirección más reciente');
    console.error('  (caduca a los pocos minutos).\n');
    process.exit(1);
  }

  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    console.error('[ERROR] Google no devolvió un refresh_token.');
    console.error('  Esto ocurre cuando la cuenta ya tenía acceso concedido.');
    console.error('  Revoca el acceso en https://myaccount.google.com/permissions');
    console.error('  y vuelve a ejecutar npm run auth:google\n');
    process.exit(1);
  }

  // ── Escribir en .env ────────────────────────────────────────────────────────

  let envContent = '';
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, 'utf8');
  }

  const line = `GOOGLE_REFRESH_TOKEN=${refreshToken}`;

  if (/^GOOGLE_REFRESH_TOKEN=.*/m.test(envContent)) {
    // Reemplazar línea existente (tenga o no valor)
    envContent = envContent.replace(/^GOOGLE_REFRESH_TOKEN=.*/m, line);
  } else {
    // Añadir tras la línea GOOGLE_CLIENT_SECRET si existe, si no al final
    if (/^GOOGLE_CLIENT_SECRET=.*/m.test(envContent)) {
      envContent = envContent.replace(
        /^(GOOGLE_CLIENT_SECRET=.*)$/m,
        `$1\n${line}`,
      );
    } else {
      envContent = envContent.trimEnd() + '\n' + line + '\n';
    }
  }

  fs.writeFileSync(ENV_PATH, envContent, 'utf8');

  console.log('  ✓ Refresh token guardado en .env');
  console.log('  Ya puedes ejecutar npm run dev para iniciar la aplicación.\n');
});
