import LegalPage from '../components/LegalPage';

const H2 = ({ children }) => (
  <h2 className="text-xl md:text-2xl font-bold text-white mt-10 mb-3">{children}</h2>
);
const P = ({ children }) => <p className="text-gray-300 leading-relaxed">{children}</p>;
const UL = ({ children }) => <ul className="list-disc pl-6 space-y-2 text-gray-300">{children}</ul>;
const Strong = ({ children }) => <strong className="text-white font-semibold">{children}</strong>;

export default function Privacy() {
  return (
    <LegalPage title="Política de Tratamiento de Datos Personales" lastUpdated="20 de abril de 2026">
      <P>
        Esta Política describe cómo <Strong>RakeFlow</Strong> recolecta, usa, almacena, transfiere
        y protege los datos personales de sus usuarios, en cumplimiento de la{' '}
        <Strong>Ley 1581 de 2012</Strong>, el Decreto 1377 de 2013 y demás normas colombianas
        aplicables sobre protección de datos personales (Habeas Data).
      </P>

      <H2>1. Responsable del Tratamiento</H2>
      <UL>
        <li><Strong>Titular:</Strong> Juan David Silva (persona natural)</li>
        <li><Strong>Identificación:</Strong> Cédula de Ciudadanía No. 1.053.323.766</li>
        <li><Strong>Domicilio:</Strong> Bogotá D.C., Colombia</li>
        <li><Strong>Denominación comercial:</Strong> RakeFlow</li>
        <li><Strong>Correo de contacto:</Strong> <a href="mailto:soporte@rakeflow.site" className="text-emerald-400">soporte@rakeflow.site</a></li>
        <li><Strong>Sitio:</Strong> <a href="https://rakeflow.site" className="text-emerald-400">rakeflow.site</a></li>
      </UL>
      <P>
        Respecto a los datos de los Jugadores ingresados por un Club en la plataforma, el Club es
        el Responsable del Tratamiento y RakeFlow actúa como Encargado del Tratamiento.
      </P>

      <H2>2. Datos que recolectamos</H2>
      <P><Strong>Del Club/Usuario:</Strong></P>
      <UL>
        <li>Nombre del club, correo electrónico, contraseña (almacenada con hash Argon2 — nunca en texto plano).</li>
        <li>Datos de suscripción y pago (procesados por ePayco; RakeFlow no almacena tarjetas).</li>
        <li>Datos técnicos: dirección IP, tipo de navegador, timestamps de acceso, identificadores de sesión.</li>
      </UL>
      <P><Strong>De los Jugadores (ingresados por el Club):</Strong></P>
      <UL>
        <li>Nombre y opcionalmente número de teléfono.</li>
        <li>Movimientos financieros vinculados al jugador dentro del Club (buy-ins, cashouts, etc.).</li>
      </UL>
      <P>
        RakeFlow <Strong>no recolecta datos sensibles</Strong> en el sentido del artículo 5 de la
        Ley 1581 (origen racial, salud, orientación sexual, biométricos, etc.).
      </P>

      <H2>3. Finalidad del tratamiento</H2>
      <UL>
        <li>Prestar el Servicio contratado y gestionar la cuenta del Cliente.</li>
        <li>Procesar pagos y emitir facturación.</li>
        <li>Enviar comunicaciones transaccionales (verificación de correo, recuperación de contraseña, avisos del servicio).</li>
        <li>Detectar y prevenir fraudes, abuso o actividad maliciosa.</li>
        <li>Cumplir obligaciones legales, contables y tributarias.</li>
        <li>Mejorar el producto mediante métricas agregadas y anónimas.</li>
      </UL>

      <H2>4. Base legal</H2>
      <UL>
        <li>Ejecución del contrato de servicio (art. 6 Ley 1581).</li>
        <li>Consentimiento expreso del titular (aceptación en el registro).</li>
        <li>Cumplimiento de obligaciones legales.</li>
        <li>Interés legítimo del Responsable para seguridad y prevención de fraude.</li>
      </UL>

      <H2>5. Transferencia a terceros y transferencias internacionales</H2>
      <P>
        Para operar, RakeFlow utiliza proveedores que pueden procesar datos en servidores ubicados
        fuera de Colombia. Dichos proveedores están sujetos a estándares adecuados de seguridad:
      </P>
      <UL>
        <li><Strong>Railway</Strong> (hosting de backend y base de datos) — Estados Unidos.</li>
        <li><Strong>Vercel</Strong> (hosting de frontend) — Estados Unidos.</li>
        <li><Strong>Resend</Strong> (envío de correos transaccionales) — Estados Unidos.</li>
        <li><Strong>ePayco</Strong> (pasarela de pagos) — Colombia.</li>
        <li><Strong>Sentry</Strong> (monitoreo de errores, datos técnicos agregados) — Estados Unidos.</li>
      </UL>
      <P>
        RakeFlow <Strong>no vende, alquila ni comparte datos personales con terceros para fines
        comerciales</Strong>. Solo se comparten cuando: (i) es necesario para prestar el Servicio,
        (ii) existe obligación legal, (iii) el titular lo autoriza expresamente.
      </P>

      <H2>6. Conservación</H2>
      <P>
        Los datos se conservan mientras exista la cuenta activa. Si el Cliente cancela, los datos
        se conservan por el tiempo legalmente exigido (obligaciones contables, tributarias,
        probatorias) y luego se eliminan o anonimizan. El Cliente puede solicitar la eliminación
        anticipada escribiendo al correo de contacto, sujeto a las excepciones legales.
      </P>

      <H2>7. Derechos del Titular</H2>
      <P>
        Como titular de datos personales, usted puede ejercer los siguientes derechos conforme a la
        Ley 1581 de 2012:
      </P>
      <UL>
        <li><Strong>Conocer</Strong> los datos personales tratados sobre usted.</li>
        <li><Strong>Actualizar</Strong> los datos incompletos, inexactos o desactualizados.</li>
        <li><Strong>Rectificar</Strong> datos erróneos.</li>
        <li><Strong>Suprimir</Strong> sus datos cuando no sean necesarios para los fines informados.</li>
        <li><Strong>Revocar la autorización</Strong> otorgada para el tratamiento.</li>
        <li><Strong>Solicitar prueba</Strong> de la autorización otorgada.</li>
        <li><Strong>Presentar quejas</Strong> ante la <Strong>Superintendencia de Industria y Comercio (SIC)</Strong>, entidad de vigilancia.</li>
      </UL>

      <H2>8. Cómo ejercer sus derechos</H2>
      <P>
        Envíe su solicitud a{' '}
        <a href="mailto:soporte@rakeflow.site" className="text-emerald-400">soporte@rakeflow.site</a>{' '}
        indicando: nombre completo, número de identificación, descripción clara de lo solicitado y
        copia del documento de identidad. RakeFlow responderá en un plazo máximo de{' '}
        <Strong>15 días hábiles</Strong>, prorrogables conforme a la ley.
      </P>

      <H2>9. Seguridad</H2>
      <P>
        RakeFlow aplica medidas técnicas, humanas y administrativas para proteger los datos:
        cifrado TLS en todas las comunicaciones, hash de contraseñas con Argon2, acceso segmentado
        por club (multi-tenant), rate limiting en endpoints sensibles, monitoreo de errores y
        logs con trazabilidad. Ningún sistema es 100% infalible; en caso de incidente, se notificará
        a los titulares afectados y a la SIC conforme a la normativa.
      </P>

      <H2>10. Cookies</H2>
      <P>
        RakeFlow utiliza almacenamiento local del navegador para mantener la sesión iniciada
        (token de autenticación). No se usan cookies publicitarias ni de rastreo de terceros con
        fines comerciales.
      </P>

      <H2>11. Menores de edad</H2>
      <P>
        El Servicio está dirigido exclusivamente a adultos (mayores de 18 años). RakeFlow no
        recolecta conscientemente datos de menores. Si un Club ingresa por error datos de un menor,
        debe eliminarlos de inmediato.
      </P>

      <H2>12. Vigencia y modificaciones</H2>
      <P>
        Esta Política rige desde la fecha de su publicación y puede ser modificada por RakeFlow.
        Los cambios sustanciales se notificarán por correo electrónico y/o aviso en la plataforma.
        El uso continuado del Servicio implica aceptación de la versión vigente.
      </P>

      <H2>13. Contacto</H2>
      <P>
        Consultas, reclamos o ejercicio de derechos:{' '}
        <a href="mailto:soporte@rakeflow.site" className="text-emerald-400">soporte@rakeflow.site</a>.
      </P>
    </LegalPage>
  );
}
