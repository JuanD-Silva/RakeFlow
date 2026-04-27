import LegalPage from '../components/LegalPage';

const H2 = ({ children }) => (
  <h2 className="text-xl md:text-2xl font-bold text-white mt-10 mb-3">{children}</h2>
);
const H3 = ({ children }) => (
  <h3 className="text-base font-bold text-emerald-400 mt-6 mb-2 uppercase tracking-wider">{children}</h3>
);
const P = ({ children }) => <p className="text-gray-300 leading-relaxed">{children}</p>;
const UL = ({ children }) => <ul className="list-disc pl-6 space-y-2 text-gray-300">{children}</ul>;
const Strong = ({ children }) => <strong className="text-white font-semibold">{children}</strong>;

export default function Terms() {
  return (
    <LegalPage title="Términos y Condiciones" lastUpdated="20 de abril de 2026">
      <P>
        Bienvenido a <Strong>RakeFlow</Strong>. Al registrarse o usar el servicio, el Cliente acepta
        estos Términos y Condiciones (en adelante, los <Strong>“Términos”</Strong>) en su totalidad.
        Si no está de acuerdo, debe abstenerse de usar el servicio.
      </P>

      <H2>Identificación del Titular</H2>
      <P>
        RakeFlow es operada por <Strong>Juan David Silva</Strong>, persona natural, identificado con
        cédula de ciudadanía <Strong>No. 1.053.323.766</Strong>, domiciliado en <Strong>Bogotá D.C.,
        Colombia</Strong>. Correo de contacto:{' '}
        <a href="mailto:soporte@rakeflow.site" className="text-emerald-400">soporte@rakeflow.site</a>.
      </P>

      <H2>1. Definiciones</H2>
      <UL>
        <li><Strong>RakeFlow</Strong>: plataforma de software como servicio (SaaS) operada por Juan David Silva, destinada a la gestión financiera y operativa de clubes de poker privados.</li>
        <li><Strong>Cliente</Strong> o <Strong>Club</Strong>: persona natural o jurídica que contrata el servicio.</li>
        <li><Strong>Usuario</Strong>: persona autorizada por el Cliente para acceder a la plataforma (dueño, administrador, cajero, etc.).</li>
        <li><Strong>Jugador</Strong>: persona cuyos datos son registrados por el Cliente en la plataforma para controlar su participación en mesas y torneos.</li>
        <li><Strong>Servicio</Strong>: acceso al software, sus funcionalidades, actualizaciones y soporte.</li>
      </UL>

      <H2>2. Descripción del Servicio</H2>
      <P>
        RakeFlow es una herramienta administrativa que permite al Club registrar sesiones de cash
        game, torneos, movimientos de dinero (buy-ins, cashouts, rake, propinas, bonos, jackpot),
        aplicar reglas de distribución de utilidades y obtener reportes. RakeFlow{' '}
        <Strong>no organiza, promueve ni opera juegos de suerte y azar</Strong>. La responsabilidad
        legal por la operación del club y el cumplimiento de la normativa aplicable (incluyendo
        Coljuegos y normativa tributaria) recae exclusivamente en el Cliente.
      </P>

      <H2>3. Registro y cuenta</H2>
      <P>
        El Cliente declara que la información proporcionada al registrarse es verídica. Es
        responsable de mantener la confidencialidad de sus credenciales y de toda actividad
        realizada desde su cuenta. Debe notificar de inmediato cualquier uso no autorizado a{' '}
        <a href="mailto:soporte@rakeflow.site" className="text-emerald-400">soporte@rakeflow.site</a>.
      </P>

      <H2>4. Planes, pagos y facturación</H2>
      <UL>
        <li>RakeFlow ofrece un periodo de prueba gratuito. Al finalizar, el Cliente debe contratar un plan para continuar usando el servicio.</li>
        <li>Los precios se publican en el sitio y pueden modificarse con 30 días de aviso previo.</li>
        <li>Los pagos se procesan a través de <Strong>Wompi</Strong> (Bancolombia), pasarela autorizada en Colombia. RakeFlow no almacena datos completos de tarjetas; solo conserva un identificador tokenizado para cobros recurrentes.</li>
        <li>Las suscripciones se cobran de forma recurrente hasta que el Cliente cancele. La cancelación surte efecto al final del periodo pagado; no hay reembolsos proporcionales.</li>
        <li>El Cliente podrá solicitar factura electrónica emitida conforme a la normativa DIAN.</li>
      </UL>

      <H2>5. Obligaciones del Cliente</H2>
      <UL>
        <li>Usar la plataforma exclusivamente para fines lícitos y conforme a la legislación colombiana aplicable.</li>
        <li>Obtener el consentimiento de sus Jugadores para el registro y tratamiento de sus datos personales, conforme a la Ley 1581 de 2012 y demás normas vigentes.</li>
        <li>No intentar acceder a datos de otros Clubes, ingeniería inversa, scraping masivo ni actividades que afecten la disponibilidad del Servicio.</li>
        <li>Mantener sus credenciales seguras y revocar accesos de Usuarios que dejen el Club.</li>
      </UL>

      <H2>6. Datos de Jugadores y responsabilidades</H2>
      <P>
        Respecto a los datos personales de los Jugadores ingresados por el Cliente, el{' '}
        <Strong>Cliente actúa como Responsable del Tratamiento</Strong> y RakeFlow como{' '}
        <Strong>Encargado del Tratamiento</Strong>, en los términos del artículo 3 de la Ley 1581
        de 2012 y el Decreto 1377 de 2013. RakeFlow trata estos datos únicamente para prestar el
        Servicio y no los cede a terceros salvo requerimiento legal.
      </P>

      <H2>7. Propiedad intelectual</H2>
      <P>
        Todo el software, marca, diseño y contenidos de RakeFlow son de propiedad exclusiva de su
        titular. El Cliente recibe una licencia limitada, no exclusiva e intransferible para usar
        el Servicio durante la vigencia de la suscripción. Los datos que el Cliente carga siguen
        siendo de su propiedad.
      </P>

      <H2>8. Disponibilidad y soporte</H2>
      <P>
        RakeFlow se esfuerza por mantener una disponibilidad alta del Servicio, pero{' '}
        <Strong>no garantiza el 100% de uptime</Strong>. Puede haber interrupciones por
        mantenimiento, fallas de terceros (hosting, pasarelas, proveedores de email) o causas de
        fuerza mayor. El soporte se presta por correo electrónico en horario hábil colombiano.
      </P>

      <H2>9. Limitación de responsabilidad</H2>
      <P>
        En la máxima medida permitida por la ley, RakeFlow no será responsable por:
      </P>
      <UL>
        <li>Daños indirectos, lucro cesante, pérdida de oportunidad o daño reputacional.</li>
        <li>Errores operativos del Cliente al registrar o interpretar información.</li>
        <li>Decisiones financieras, tributarias o legales del Cliente basadas en los reportes.</li>
        <li>Interrupciones causadas por terceros (Wompi, Railway, Vercel, Resend, etc.).</li>
      </UL>
      <P>
        La responsabilidad total de RakeFlow frente al Cliente, por cualquier concepto, estará
        limitada al monto efectivamente pagado por el Cliente en los seis (6) meses anteriores al
        hecho que da origen al reclamo.
      </P>

      <H2>10. Suspensión y terminación</H2>
      <P>
        RakeFlow puede suspender o cancelar la cuenta del Cliente, previo aviso razonable, ante:
        (i) incumplimiento de estos Términos; (ii) falta de pago; (iii) uso fraudulento o contrario
        a la ley. El Cliente puede cancelar su cuenta en cualquier momento desde la plataforma o
        escribiendo a soporte.
      </P>

      <H2>11. Modificaciones</H2>
      <P>
        RakeFlow podrá modificar estos Términos. Los cambios se notificarán por correo electrónico
        y/o aviso en la plataforma con al menos 15 días de anticipación cuando sean sustanciales.
        El uso continuado del Servicio después de la entrada en vigor implica aceptación.
      </P>

      <H2>12. Ley aplicable y jurisdicción</H2>
      <P>
        Estos Términos se rigen por las leyes de la <Strong>República de Colombia</Strong>.
        Cualquier controversia se someterá a los jueces y tribunales de <Strong>Bogotá D.C.</Strong>,
        renunciando las partes a cualquier otro fuero que pudiera corresponderles.
      </P>

      <H2>13. Contacto</H2>
      <P>
        Para cualquier consulta relacionada con estos Términos:{' '}
        <a href="mailto:soporte@rakeflow.site" className="text-emerald-400">soporte@rakeflow.site</a>.
      </P>
    </LegalPage>
  );
}
