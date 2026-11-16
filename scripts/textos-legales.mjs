#!/usr/bin/env node
/**
 * Redacta las seis páginas legales obligatorias, en los tres idiomas.
 *
 * La instalación las crea con un texto de partida que empieza por «PENDIENTE DE
 * COMPLETAR» y con los datos fiscales entre corchetes. Publicadas así —que es
 * como estaban— no cumplen nada: dicen literalmente que están sin terminar.
 *
 * **Los datos de la empresa no se escriben aquí.** Se leen de los ajustes de la
 * propia tienda al importar (`/settings/public`) y se sustituyen en el texto. Si
 * mañana cambia el domicilio social, se cambia en el panel y se vuelve a
 * importar; con los datos incrustados en el texto habría que acordarse de
 * repasar seis páginas por tres idiomas.
 *
 * **Solo se toca el contenido.** El título y la dirección de cada página se
 * conservan tal como estén, porque el pie de la tienda enlaza «privacidad» y
 * «aviso-legal» por su dirección y cambiarla los rompería en silencio.
 *
 * Uso:
 *   node scripts/textos-legales.mjs                → ensayo, no toca nada
 *   node scripts/textos-legales.mjs --aplicar      → escribe el contenido
 *   node scripts/textos-legales.mjs --publicar     → escribe y además publica
 *
 * Variables:
 *   API             dirección de la API   (por defecto http://localhost:3001)
 *   EMAIL_CONTACTO  correo de atención al cliente que aparece en los textos
 *   ADMIN_TOKEN     o bien ADMIN_EMAIL + ADMIN_PASSWORD
 *
 * ---------------------------------------------------------------------------
 * ESTO NO ES ASESORAMIENTO JURÍDICO. Son textos estándar de comercio
 * electrónico, redactados para el caso concreto de esta tienda: una sociedad
 * británica que vende productos para adultos a consumidores residentes en
 * España, sin IOSS. Cubren lo que la normativa exige informar, pero un
 * despacho debe revisarlos antes de considerarlos definitivos.
 * ---------------------------------------------------------------------------
 */

/*
 * Marcadores que se sustituyen al importar:
 *
 *   {{TIENDA}}     nombre comercial          brand.name
 *   {{EMPRESA}}    razón social              legal.companyName
 *   {{ID}}         número de sociedad/NIF    legal.taxId
 *   {{DOMICILIO}}  domicilio social          legal.address
 *   {{EMAIL}}      correo de atención        EMAIL_CONTACTO
 *   {{DOMINIO}}    dominio de la tienda      deducido de la API
 *   {{DIAS}}       días de desistimiento     legal.withdrawalDays
 *   {{GRATIS}}     umbral de envío gratis    shop.freeShippingThreshold
 */

export const PAGINAS = [
  // ══════════════════════════════════════════════════════════
  {
    handle: 'aviso-legal',
    es: `Identificación del titular

{{TIENDA}} es una tienda en línea operada por {{EMPRESA}}, sociedad constituida en Inglaterra y Gales con número de sociedad {{ID}} y domicilio social en {{DOMICILIO}}.

Correo de contacto: {{EMAIL}}
Sitio web: https://{{DOMINIO}}

Actividad: venta a distancia de productos para adultos.

Acceso restringido a mayores de edad

Este sitio contiene material destinado exclusivamente a personas mayores de 18 años. Al acceder confirmas que tienes al menos 18 años y que deseas ver este contenido de forma voluntaria. Si eres menor de edad, no debes continuar navegando ni realizar ningún pedido.

Dónde está establecida la empresa y qué ley te protege

{{EMPRESA}} no está establecida en España. Esto no reduce tus derechos: cuando compras como consumidor residente en España, la relación se rige por las normas imperativas de protección al consumidor que te corresponden por tu lugar de residencia, conforme al Reglamento (CE) 593/2008 (Roma I). Conservas por tanto el derecho de desistimiento, la garantía legal y el resto de derechos reconocidos en el texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios.

Condiciones de uso

El uso de este sitio te obliga a no emplearlo con fines ilícitos, a no introducir contenidos que dañen los sistemas del titular o de terceros, y a facilitar información veraz en los formularios. Nos reservamos el derecho de denegar el acceso o cancelar pedidos cuando detectemos un uso fraudulento.

Propiedad intelectual e industrial

Los textos, imágenes, marcas, logotipos, diseño y código de este sitio pertenecen a {{EMPRESA}} o a terceros que han autorizado su uso. Queda prohibida su reproducción, distribución o transformación sin autorización escrita, salvo el uso personal y privado.

Responsabilidad

Procuramos que la información del sitio sea exacta y esté actualizada, pero pueden producirse errores tipográficos o de precio. Si detectamos un error evidente en el precio de un producto ya pedido, te lo comunicaremos antes de tramitarlo y podrás confirmar el pedido al precio correcto o cancelarlo sin coste.

No respondemos de las interrupciones del servicio causadas por fallos de la red, mantenimiento o causas de fuerza mayor, ni del contenido de sitios de terceros enlazados desde aquí.

Enlaces

Los enlaces a otros sitios se ofrecen únicamente como referencia. No controlamos su contenido ni asumimos responsabilidad sobre él.

Legislación aplicable

Estas condiciones se rigen por la ley inglesa, sin que ello prive al consumidor de la protección que le otorgan las disposiciones imperativas de la ley de su país de residencia habitual. Como consumidor residente en España puedes reclamar ante los tribunales españoles de tu domicilio.

Última actualización: {{FECHA}}`,

    ca: `Identificació del titular

{{TIENDA}} és una botiga en línia operada per {{EMPRESA}}, societat constituïda a Anglaterra i Gal·les amb número de societat {{ID}} i domicili social a {{DOMICILIO}}.

Correu de contacte: {{EMAIL}}
Lloc web: https://{{DOMINIO}}

Activitat: venda a distància de productes per a adults.

Accés restringit a majors d'edat

Aquest lloc conté material destinat exclusivament a persones majors de 18 anys. En accedir-hi confirmes que tens com a mínim 18 anys i que vols veure aquest contingut de manera voluntària. Si ets menor d'edat, no has de continuar navegant ni fer cap comanda.

On està establerta l'empresa i quina llei et protegeix

{{EMPRESA}} no està establerta a Espanya. Això no redueix els teus drets: quan compres com a consumidor resident a Espanya, la relació es regeix per les normes imperatives de protecció al consumidor que et corresponen pel teu lloc de residència, d'acord amb el Reglament (CE) 593/2008 (Roma I). Conserves, per tant, el dret de desistiment, la garantia legal i la resta de drets reconeguts en el text refós de la Llei General per a la Defensa dels Consumidors i Usuaris.

Condicions d'ús

L'ús d'aquest lloc t'obliga a no fer-lo servir amb finalitats il·lícites, a no introduir continguts que danyin els sistemes del titular o de tercers, i a facilitar informació veraç als formularis. Ens reservem el dret de denegar l'accés o cancel·lar comandes quan detectem un ús fraudulent.

Propietat intel·lectual i industrial

Els textos, imatges, marques, logotips, disseny i codi d'aquest lloc pertanyen a {{EMPRESA}} o a tercers que n'han autoritzat l'ús. Queda prohibida la seva reproducció, distribució o transformació sense autorització escrita, llevat de l'ús personal i privat.

Responsabilitat

Procurem que la informació del lloc sigui exacta i estigui actualitzada, però es poden produir errors tipogràfics o de preu. Si detectem un error evident en el preu d'un producte ja demanat, t'ho comunicarem abans de tramitar-lo i podràs confirmar la comanda al preu correcte o cancel·lar-la sense cap cost.

No responem de les interrupcions del servei causades per errors de la xarxa, manteniment o causes de força major, ni del contingut de llocs de tercers enllaçats des d'aquí.

Enllaços

Els enllaços a altres llocs s'ofereixen únicament com a referència. No en controlem el contingut ni n'assumim cap responsabilitat.

Legislació aplicable

Aquestes condicions es regeixen per la llei anglesa, sense que això privi el consumidor de la protecció que li atorguen les disposicions imperatives de la llei del seu país de residència habitual. Com a consumidor resident a Espanya pots reclamar davant els tribunals espanyols del teu domicili.

Darrera actualització: {{FECHA}}`,

    en: `Company details

{{TIENDA}} is an online shop operated by {{EMPRESA}}, a company incorporated in England and Wales under company number {{ID}}, with its registered office at {{DOMICILIO}}.

Contact email: {{EMAIL}}
Website: https://{{DOMINIO}}

Activity: distance selling of adult products.

Access restricted to adults

This site contains material intended solely for people aged 18 or over. By accessing it you confirm that you are at least 18 and that you wish to view this content voluntarily. If you are under 18, you must not continue browsing or place any order.

Where the company is established and which law protects you

{{EMPRESA}} is not established in Spain. This does not reduce your rights: when you buy as a consumer resident in Spain, the relationship is governed by the mandatory consumer protection rules of your country of residence, under Regulation (EC) 593/2008 (Rome I). You therefore keep your right of withdrawal, the legal guarantee and the other rights granted by Spanish consumer law.

Terms of use

By using this site you agree not to use it for unlawful purposes, not to introduce content that damages the systems of the operator or of third parties, and to provide accurate information in our forms. We reserve the right to refuse access or cancel orders where we detect fraudulent use.

Intellectual property

The text, images, trade marks, logos, design and code on this site belong to {{EMPRESA}} or to third parties who have authorised their use. Reproduction, distribution or modification without written permission is prohibited, other than for personal and private use.

Liability

We aim to keep the information on this site accurate and up to date, but typographical or pricing errors may occur. If we detect an obvious pricing error on a product you have already ordered, we will tell you before processing it and you may either confirm the order at the correct price or cancel it at no cost.

We are not liable for service interruptions caused by network failures, maintenance or force majeure, nor for the content of third-party sites linked from here.

Links

Links to other sites are provided for reference only. We do not control their content and accept no responsibility for it.

Governing law

These terms are governed by English law, without depriving the consumer of the protection afforded by the mandatory provisions of the law of their country of habitual residence. As a consumer resident in Spain you may bring proceedings before the Spanish courts of your domicile.

Last updated: {{FECHA}}`,
  },

  // ══════════════════════════════════════════════════════════
  {
    handle: 'privacidad',
    es: `Quién trata tus datos

El responsable del tratamiento es {{EMPRESA}}, sociedad constituida en Inglaterra y Gales con número {{ID}} y domicilio en {{DOMICILIO}}.

Para cualquier cuestión sobre tus datos, escríbenos a {{EMAIL}}.

Qué datos tratamos

- Datos que nos facilitas: nombre y apellidos, correo electrónico, teléfono, dirección de envío y de facturación.
- Datos de tus pedidos: qué has comprado, cuándo, importe y estado del envío.
- Datos técnicos: dirección IP, tipo de navegador e idioma, y las cookies que aceptes.
- Comunicaciones: los mensajes que nos envías al contactar con atención al cliente.

No almacenamos los datos de tu tarjeta ni de tu monedero. El pago lo procesa directamente la pasarela, que es quien recibe esos datos.

Una advertencia que nos parece importante

Vendemos productos para adultos. Eso significa que el historial de tus pedidos puede revelar información sobre tu vida sexual, que el Reglamento General de Protección de Datos considera una categoría especial de datos (artículo 9).

Lo tratamos en consecuencia: el acceso está limitado a quien necesita gestionar tu pedido, no elaboramos perfiles publicitarios con el contenido de tus compras, no cedemos esa información con fines comerciales y los envíos salen en embalaje neutro, sin referencias visibles al contenido ni al nombre de la tienda.

Para qué y con qué base legal

- Gestionar tu compra, enviarte el pedido y emitir la factura. Base: la ejecución del contrato.
- Atenderte cuando escribes o reclamas. Base: la ejecución del contrato y nuestro interés legítimo en resolver incidencias.
- Cumplir obligaciones fiscales y contables. Base: obligación legal.
- Enviarte novedades y promociones. Base: tu consentimiento, que puedes retirar cuando quieras desde el enlace de cualquier correo.
- Prevenir el fraude en los pedidos. Base: nuestro interés legítimo en no sufrir cargos fraudulentos.
- Cookies analíticas y de marketing. Base: tu consentimiento.

Cuánto tiempo los conservamos

- Datos de tu cuenta: mientras la mantengas activa. Si la eliminas, se suprimen salvo lo que debamos conservar por ley.
- Facturas y datos contables: el plazo que exige la normativa fiscal y mercantil aplicable.
- Datos de marketing: hasta que retires tu consentimiento.
- Registros técnicos y de seguridad: doce meses.

Con quién los compartimos

- El proveedor que prepara y envía tu pedido, y la empresa de transporte: reciben tu nombre, dirección y teléfono para poder entregarlo.
- La pasarela de pago que elijas.
- Los proveedores que nos prestan servicio: alojamiento, envío de correos y herramientas de análisis, siempre con contrato de encargado de tratamiento.
- Las administraciones públicas cuando una norma nos obliga.

No vendemos tus datos a nadie.

Transferencias fuera del Espacio Económico Europeo

Nuestros sistemas se gestionan desde el Reino Unido, país que cuenta con decisión de adecuación de la Comisión Europea. Algunos proveedores y el proveedor logístico pueden estar situados fuera del Espacio Económico Europeo; en ese caso la transferencia se ampara en cláusulas contractuales tipo aprobadas por la Comisión u otra garantía prevista en el RGPD. Puedes pedirnos copia de esas garantías escribiendo a {{EMAIL}}.

Tus derechos

Puedes pedirnos acceder a tus datos, rectificarlos, suprimirlos, oponerte al tratamiento, limitarlo, y recibirlos en un formato portable para llevártelos a otro servicio. También puedes retirar tu consentimiento en cualquier momento, sin que ello afecte a lo hecho antes.

Desde tu cuenta puedes descargar tus datos y solicitar la eliminación tú mismo. Si prefieres, escríbenos a {{EMAIL}} y lo tramitamos nosotros.

Si crees que no hemos atendido bien tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es) o ante la autoridad de control de tu país de residencia.

Cambios en esta política

Si la modificamos, publicaremos aquí la versión actualizada con su fecha. Si el cambio es relevante, te avisaremos por correo.

Última actualización: {{FECHA}}`,

    ca: `Qui tracta les teves dades

El responsable del tractament és {{EMPRESA}}, societat constituïda a Anglaterra i Gal·les amb número {{ID}} i domicili a {{DOMICILIO}}.

Per a qualsevol qüestió sobre les teves dades, escriu-nos a {{EMAIL}}.

Quines dades tractem

- Dades que ens facilites: nom i cognoms, correu electrònic, telèfon, adreça d'enviament i de facturació.
- Dades de les teves comandes: què has comprat, quan, import i estat de l'enviament.
- Dades tècniques: adreça IP, tipus de navegador i idioma, i les galetes que acceptis.
- Comunicacions: els missatges que ens envies en contactar amb atenció al client.

No emmagatzemem les dades de la teva targeta ni del teu moneder. El pagament el processa directament la passarel·la, que és qui rep aquestes dades.

Un advertiment que ens sembla important

Venem productes per a adults. Això vol dir que l'historial de les teves comandes pot revelar informació sobre la teva vida sexual, que el Reglament General de Protecció de Dades considera una categoria especial de dades (article 9).

El tractem en conseqüència: l'accés està limitat a qui necessita gestionar la teva comanda, no elaborem perfils publicitaris amb el contingut de les teves compres, no cedim aquesta informació amb finalitats comercials i els enviaments surten en embalatge neutre, sense referències visibles al contingut ni al nom de la botiga.

Per a què i amb quina base legal

- Gestionar la teva compra, enviar-te la comanda i emetre la factura. Base: l'execució del contracte.
- Atendre't quan escrius o reclames. Base: l'execució del contracte i el nostre interès legítim a resoldre incidències.
- Complir obligacions fiscals i comptables. Base: obligació legal.
- Enviar-te novetats i promocions. Base: el teu consentiment, que pots retirar quan vulguis des de l'enllaç de qualsevol correu.
- Prevenir el frau en les comandes. Base: el nostre interès legítim a no patir càrrecs fraudulents.
- Galetes analítiques i de màrqueting. Base: el teu consentiment.

Quant de temps les conservem

- Dades del teu compte: mentre el mantinguis actiu. Si l'elimines, se suprimeixen llevat del que hàgim de conservar per llei.
- Factures i dades comptables: el termini que exigeix la normativa fiscal i mercantil aplicable.
- Dades de màrqueting: fins que retiris el teu consentiment.
- Registres tècnics i de seguretat: dotze mesos.

Amb qui les compartim

- El proveïdor que prepara i envia la teva comanda, i l'empresa de transport: reben el teu nom, adreça i telèfon per poder lliurar-la.
- La passarel·la de pagament que triïs.
- Els proveïdors que ens presten servei: allotjament, enviament de correus i eines d'anàlisi, sempre amb contracte d'encarregat de tractament.
- Les administracions públiques quan una norma ens hi obliga.

No venem les teves dades a ningú.

Transferències fora de l'Espai Econòmic Europeu

Els nostres sistemes es gestionen des del Regne Unit, país que compta amb decisió d'adequació de la Comissió Europea. Alguns proveïdors i el proveïdor logístic poden estar situats fora de l'Espai Econòmic Europeu; en aquest cas la transferència s'empara en clàusules contractuals tipus aprovades per la Comissió o una altra garantia prevista al RGPD. Pots demanar-nos còpia d'aquestes garanties escrivint a {{EMAIL}}.

Els teus drets

Pots demanar-nos accedir a les teves dades, rectificar-les, suprimir-les, oposar-te al tractament, limitar-lo, i rebre-les en un format portable per endur-te-les a un altre servei. També pots retirar el teu consentiment en qualsevol moment, sense que això afecti el que s'ha fet abans.

Des del teu compte pots descarregar les teves dades i sol·licitar-ne l'eliminació tu mateix. Si ho prefereixes, escriu-nos a {{EMAIL}} i ho tramitem nosaltres.

Si creus que no hem atès bé la teva sol·licitud, pots reclamar davant l'Agència Espanyola de Protecció de Dades (www.aepd.es) o davant l'autoritat de control del teu país de residència.

Canvis en aquesta política

Si la modifiquem, publicarem aquí la versió actualitzada amb la seva data. Si el canvi és rellevant, t'avisarem per correu.

Darrera actualització: {{FECHA}}`,

    en: `Who processes your data

The data controller is {{EMPRESA}}, a company incorporated in England and Wales under number {{ID}}, with its office at {{DOMICILIO}}.

For any question about your data, write to us at {{EMAIL}}.

What data we process

- Data you give us: name and surname, email address, phone number, delivery and billing address.
- Order data: what you bought, when, the amount and the shipping status.
- Technical data: IP address, browser type and language, and the cookies you accept.
- Communications: the messages you send us when contacting customer service.

We do not store your card or wallet details. Payment is processed directly by the gateway, which is what receives that data.

Something we think you should know

We sell adult products. That means your order history may reveal information about your sex life, which the General Data Protection Regulation treats as a special category of data (Article 9).

We handle it accordingly: access is limited to those who need it to process your order, we do not build advertising profiles from what you buy, we do not share that information for commercial purposes, and orders ship in plain packaging with no visible reference to the contents or to the shop name.

Purposes and legal bases

- Processing your purchase, shipping your order and issuing the invoice. Basis: performance of the contract.
- Answering you when you write or complain. Basis: performance of the contract and our legitimate interest in resolving issues.
- Meeting tax and accounting obligations. Basis: legal obligation.
- Sending you news and offers. Basis: your consent, which you can withdraw at any time from the link in any email.
- Preventing order fraud. Basis: our legitimate interest in avoiding fraudulent charges.
- Analytics and marketing cookies. Basis: your consent.

How long we keep it

- Account data: for as long as your account is active. If you delete it, the data is erased except what we must keep by law.
- Invoices and accounting records: the period required by applicable tax and company law.
- Marketing data: until you withdraw your consent.
- Technical and security logs: twelve months.

Who we share it with

- The supplier who prepares and ships your order, and the carrier: they receive your name, address and phone number in order to deliver it.
- The payment gateway you choose.
- The providers who serve us: hosting, email delivery and analytics tools, always under a data processing agreement.
- Public authorities where the law requires it.

We do not sell your data to anyone.

Transfers outside the European Economic Area

Our systems are managed from the United Kingdom, a country covered by a European Commission adequacy decision. Some providers and the logistics supplier may be located outside the European Economic Area; in that case the transfer relies on standard contractual clauses approved by the Commission or another safeguard provided for in the GDPR. You can ask us for a copy of those safeguards by writing to {{EMAIL}}.

Your rights

You can ask us to access your data, correct it, erase it, object to processing, restrict it, and receive it in a portable format to take it elsewhere. You can also withdraw your consent at any time, without affecting processing carried out beforehand.

From your account you can download your data and request deletion yourself. If you prefer, write to {{EMAIL}} and we will handle it.

If you believe we have not dealt with your request properly, you can complain to the Spanish Data Protection Agency (www.aepd.es) or to the supervisory authority of your country of residence.

Changes to this policy

If we change it, we will publish the updated version here with its date. If the change is significant, we will tell you by email.

Last updated: {{FECHA}}`,
  },

  // ══════════════════════════════════════════════════════════
  {
    handle: 'cookies',
    es: `Qué son las cookies

Una cookie es un pequeño archivo que se guarda en tu dispositivo cuando visitas un sitio web. Sirve para recordar información entre páginas: que has iniciado sesión, qué llevas en el carrito o qué idioma prefieres.

Qué cookies usamos

Necesarias. No se pueden desactivar porque sin ellas la tienda no funciona: mantienen tu sesión, tu carrito, tu idioma y el registro de que has confirmado ser mayor de edad. También la que guarda tu decisión sobre estas mismas cookies. No requieren tu consentimiento.

Analíticas. Nos dicen qué páginas se visitan y desde dónde, para saber qué funciona y qué no. Los datos se tratan de forma agregada. Solo se instalan si las aceptas.

De marketing. Permiten medir el resultado de nuestras campañas y mostrarte contenido más relevante. Solo se instalan si las aceptas.

Cuánto duran

Las de sesión se borran al cerrar el navegador. Las demás tienen una duración máxima de veinticuatro meses, y se renuevan solo si sigues visitándonos.

Cómo cambiar tu decisión

Puedes aceptar o rechazar las cookies no necesarias desde el aviso que aparece la primera vez que entras, y cambiar de opinión cuando quieras desde el enlace de configuración de cookies disponible en el pie de página.

Rechazarlas es tan fácil como aceptarlas: el aviso tiene los dos botones al mismo nivel, sin pasos añadidos para quien dice que no.

También puedes bloquearlas o eliminarlas desde la configuración de tu navegador. Ten en cuenta que si bloqueas las necesarias, la tienda dejará de funcionar correctamente: no podrás mantener la sesión ni completar una compra.

Cookies de terceros

Las cookies analíticas y de marketing pueden ser instaladas por proveedores externos que actúan como encargados de tratamiento. Puedes consultar qué datos tratamos y con quién los compartimos en nuestra política de privacidad.

Última actualización: {{FECHA}}`,

    ca: `Què són les galetes

Una galeta és un petit arxiu que es desa al teu dispositiu quan visites un lloc web. Serveix per recordar informació entre pàgines: que has iniciat sessió, què portes a la cistella o quin idioma prefereixes.

Quines galetes fem servir

Necessàries. No es poden desactivar perquè sense elles la botiga no funciona: mantenen la teva sessió, la teva cistella, el teu idioma i el registre que has confirmat ser major d'edat. També la que desa la teva decisió sobre aquestes mateixes galetes. No requereixen el teu consentiment.

Analítiques. Ens diuen quines pàgines es visiten i des d'on, per saber què funciona i què no. Les dades es tracten de manera agregada. Només s'instal·len si les acceptes.

De màrqueting. Permeten mesurar el resultat de les nostres campanyes i mostrar-te contingut més rellevant. Només s'instal·len si les acceptes.

Quant duren

Les de sessió s'esborren en tancar el navegador. La resta tenen una durada màxima de vint-i-quatre mesos, i es renoven només si continues visitant-nos.

Com canviar la teva decisió

Pots acceptar o rebutjar les galetes no necessàries des de l'avís que apareix el primer cop que hi entres, i canviar d'opinió quan vulguis des de l'enllaç de configuració de galetes disponible al peu de pàgina.

Rebutjar-les és tan fàcil com acceptar-les: l'avís té els dos botons al mateix nivell, sense passos afegits per a qui diu que no.

També pots bloquejar-les o eliminar-les des de la configuració del teu navegador. Tingues en compte que si bloqueges les necessàries, la botiga deixarà de funcionar correctament: no podràs mantenir la sessió ni completar una compra.

Galetes de tercers

Les galetes analítiques i de màrqueting poden ser instal·lades per proveïdors externs que actuen com a encarregats de tractament. Pots consultar quines dades tractem i amb qui les compartim a la nostra política de privacitat.

Darrera actualització: {{FECHA}}`,

    en: `What cookies are

A cookie is a small file stored on your device when you visit a website. It remembers information between pages: that you are signed in, what is in your basket, or which language you prefer.

Which cookies we use

Necessary. These cannot be switched off because the shop does not work without them: they keep your session, your basket, your language and the record that you confirmed you are of age. This also includes the cookie that stores your choice about these very cookies. They do not require your consent.

Analytics. They tell us which pages are visited and from where, so we know what works and what does not. The data is handled in aggregate. They are only set if you accept them.

Marketing. They let us measure how our campaigns perform and show you more relevant content. They are only set if you accept them.

How long they last

Session cookies are deleted when you close your browser. The rest last a maximum of twenty-four months, and are renewed only if you keep visiting us.

How to change your choice

You can accept or reject non-necessary cookies from the banner shown the first time you visit, and change your mind whenever you want from the cookie settings link in the footer.

Rejecting is as easy as accepting: the banner puts both buttons at the same level, with no extra steps for those who say no.

You can also block or delete cookies from your browser settings. Note that if you block the necessary ones, the shop will stop working properly: you will not be able to stay signed in or complete a purchase.

Third-party cookies

Analytics and marketing cookies may be set by external providers acting as data processors. You can find out what data we process and who we share it with in our privacy policy.

Last updated: {{FECHA}}`,
  },

  // ══════════════════════════════════════════════════════════
  {
    handle: 'condiciones',
    es: `Quiénes somos y qué regula este documento

Estas condiciones rigen la compra de productos en {{TIENDA}}, tienda operada por {{EMPRESA}}, con número de sociedad {{ID}} y domicilio en {{DOMICILIO}}. Puedes escribirnos a {{EMAIL}}.

Al confirmar un pedido aceptas estas condiciones. Te recomendamos guardarlas o imprimirlas.

Quién puede comprar

Para comprar debes ser mayor de 18 años y tener capacidad legal para contratar. Nuestros productos están destinados exclusivamente a personas adultas. Nos reservamos el derecho de cancelar cualquier pedido cuando existan indicios de que el comprador es menor de edad.

Cómo se formaliza la compra

Añades los productos al carrito, indicas la dirección de envío y pagas. Recibirás un correo de confirmación con el número de pedido y el detalle de la compra. Ese correo confirma que hemos recibido tu pedido; el contrato queda perfeccionado cuando te confirmamos el envío.

Si un producto resulta no estar disponible después de tu pago, te lo comunicaremos y te devolveremos el importe íntegro de ese producto.

Precios

Los precios se muestran en euros. Para envíos a la Península y Baleares incluyen el IVA español aplicable.

Los envíos a Canarias, Ceuta y Melilla se facturan sin IVA español por estar fuera del territorio de aplicación del impuesto. A cambio, quedan sujetos a los tributos e impuestos propios de esos territorios, que abonarás a la entrega según lo indicado más abajo.

Los gastos de envío se calculan y se muestran en el carrito antes de que confirmes el pago.

Impuestos de importación y gastos de aduana

Léelo con atención, porque puede suponerte un coste añadido.

Los productos se envían desde fuera de la Unión Europea. Al entrar en territorio aduanero, la mayoría de los pedidos están sujetos al IVA de importación, y el transportista suele repercutir además una tarifa por la gestión del despacho aduanero.

Estos importes no están incluidos en el precio que pagas en la tienda y los abona la persona destinataria a la entrega. No podemos conocer de antemano su cuantía exacta, ya que dependen del valor declarado, del transportista y de la aduana que tramite el envío.

Lo mismo aplica a los envíos a Canarias, Ceuta y Melilla.

Si el destinatario rechaza el paquete por no querer asumir esos importes, el pedido nos será devuelto y te reembolsaremos el precio de los productos, descontando los gastos de envío y de retorno efectivamente soportados.

Formas de pago

Actualmente aceptamos pago mediante criptomoneda a través de nuestro proveedor de pagos. Las formas de pago disponibles se muestran siempre en el momento de finalizar la compra.

Como el pago se realiza en criptomoneda, el importe se calcula al cambio vigente en el momento de generar la orden de pago, y debe completarse dentro del plazo que indique la pasarela. Si el pago llega fuera de plazo o por un importe distinto, la pasarela puede rechazarlo o requerir un ajuste.

Plazos de entrega

Los plazos estimados, contados desde la confirmación del pago, son:

- Península: de 3 a 7 días laborables
- Baleares: de 4 a 9 días laborables
- Canarias: de 5 a 12 días laborables
- Ceuta y Melilla: de 5 a 14 días laborables

Son estimaciones. Los trámites aduaneros pueden alargarlas y quedan fuera de nuestro control. Si el pedido se retrasa de forma significativa, te informaremos y podrás resolver el contrato y recuperar tu dinero.

Derecho de desistimiento

Dispones de {{DIAS}} días naturales desde que recibes el pedido para desistir de la compra sin necesidad de justificar el motivo y sin penalización.

Excepción importante por higiene. El derecho de desistimiento no se aplica a los productos precintados que no sean aptos para ser devueltos por razones de protección de la salud o de higiene y que hayan sido desprecintados tras la entrega. Dada la naturaleza de nuestro catálogo, esta excepción alcanza a la mayor parte de nuestros productos: si abres el precinto de un juguete, un lubricante o cualquier artículo de uso íntimo, ya no podrás desistir de su compra.

Puedes examinar el producto y su embalaje como lo harías en una tienda física, pero no desprecintarlo ni usarlo si quieres conservar el derecho a devolverlo.

Encontrarás el procedimiento completo y el formulario de desistimiento en nuestra página de devoluciones.

Garantía legal

Los productos cuentan con la garantía legal de conformidad de tres años desde la entrega, conforme a la normativa española de consumo. Si el producto no es conforme, tienes derecho a su reparación o sustitución y, cuando no proceda, a la rebaja del precio o a la resolución del contrato.

Los gastos de devolución de un producto defectuoso o que no se corresponde con lo pedido corren de nuestra cuenta.

Atención al cliente y reclamaciones

Escríbenos a {{EMAIL}} indicando tu número de pedido. Atendemos las reclamaciones en el plazo máximo de un mes.

Si no quedas satisfecho con nuestra respuesta, puedes acudir a las autoridades de consumo de tu comunidad autónoma o a los tribunales.

Ley aplicable y jurisdicción

El contrato se rige por la ley inglesa, sin que ello prive al consumidor de la protección que le otorgan las disposiciones imperativas de la ley de su país de residencia habitual. Como consumidor residente en España, puedes reclamar ante los tribunales españoles correspondientes a tu domicilio.

Última actualización: {{FECHA}}`,

    ca: `Qui som i què regula aquest document

Aquestes condicions regeixen la compra de productes a {{TIENDA}}, botiga operada per {{EMPRESA}}, amb número de societat {{ID}} i domicili a {{DOMICILIO}}. Pots escriure'ns a {{EMAIL}}.

En confirmar una comanda acceptes aquestes condicions. Et recomanem desar-les o imprimir-les.

Qui pot comprar

Per comprar has de ser major de 18 anys i tenir capacitat legal per contractar. Els nostres productes estan destinats exclusivament a persones adultes. Ens reservem el dret de cancel·lar qualsevol comanda quan hi hagi indicis que el comprador és menor d'edat.

Com es formalitza la compra

Afegeixes els productes a la cistella, indiques l'adreça d'enviament i pagues. Rebràs un correu de confirmació amb el número de comanda i el detall de la compra. Aquest correu confirma que hem rebut la teva comanda; el contracte queda perfeccionat quan et confirmem l'enviament.

Si un producte resulta no estar disponible després del teu pagament, t'ho comunicarem i et retornarem l'import íntegre d'aquest producte.

Preus

Els preus es mostren en euros. Per a enviaments a la Península i les Balears inclouen l'IVA espanyol aplicable.

Els enviaments a les Canàries, Ceuta i Melilla es facturen sense IVA espanyol per ser fora del territori d'aplicació de l'impost. En canvi, queden subjectes als tributs i impostos propis d'aquests territoris, que abonaràs en el lliurament segons el que s'indica més avall.

Les despeses d'enviament es calculen i es mostren a la cistella abans que confirmis el pagament.

Impostos d'importació i despeses de duana

Llegeix-ho amb atenció, perquè et pot suposar un cost afegit.

Els productes s'envien des de fora de la Unió Europea. En entrar al territori duaner, la majoria de comandes estan subjectes a l'IVA d'importació, i el transportista sol repercutir a més una tarifa per la gestió del despatx duaner.

Aquests imports no estan inclosos en el preu que pagues a la botiga i els abona la persona destinatària en el lliurament. No podem conèixer per endavant la seva quantia exacta, ja que depenen del valor declarat, del transportista i de la duana que tramiti l'enviament.

El mateix s'aplica als enviaments a les Canàries, Ceuta i Melilla.

Si el destinatari rebutja el paquet per no voler assumir aquests imports, la comanda ens serà retornada i et reemborsarem el preu dels productes, descomptant les despeses d'enviament i de retorn efectivament suportades.

Formes de pagament

Actualment acceptem pagament mitjançant criptomoneda a través del nostre proveïdor de pagaments. Les formes de pagament disponibles es mostren sempre en el moment de finalitzar la compra.

Com que el pagament es fa en criptomoneda, l'import es calcula al canvi vigent en el moment de generar l'ordre de pagament, i s'ha de completar dins del termini que indiqui la passarel·la. Si el pagament arriba fora de termini o per un import diferent, la passarel·la pot rebutjar-lo o requerir un ajust.

Terminis de lliurament

Els terminis estimats, comptats des de la confirmació del pagament, són:

- Península: de 3 a 7 dies laborables
- Balears: de 4 a 9 dies laborables
- Canàries: de 5 a 12 dies laborables
- Ceuta i Melilla: de 5 a 14 dies laborables

Són estimacions. Els tràmits duaners poden allargar-les i queden fora del nostre control. Si la comanda es retarda de manera significativa, t'informarem i podràs resoldre el contracte i recuperar els teus diners.

Dret de desistiment

Disposes de {{DIAS}} dies naturals des que reps la comanda per desistir de la compra sense necessitat de justificar-ne el motiu i sense penalització.

Excepció important per higiene. El dret de desistiment no s'aplica als productes precintats que no siguin aptes per ser retornats per raons de protecció de la salut o d'higiene i que hagin estat desprecintats després del lliurament. Atesa la naturalesa del nostre catàleg, aquesta excepció abasta la major part dels nostres productes: si obres el precinte d'una joguina, un lubricant o qualsevol article d'ús íntim, ja no en podràs desistir.

Pots examinar el producte i el seu embalatge com ho faries en una botiga física, però no desprecintar-lo ni usar-lo si vols conservar el dret a retornar-lo.

Trobaràs el procediment complet i el formulari de desistiment a la nostra pàgina de devolucions.

Garantia legal

Els productes compten amb la garantia legal de conformitat de tres anys des del lliurament, d'acord amb la normativa espanyola de consum. Si el producte no és conforme, tens dret a la seva reparació o substitució i, quan no escaigui, a la rebaixa del preu o a la resolució del contracte.

Les despeses de devolució d'un producte defectuós o que no es correspon amb el que s'ha demanat corren al nostre càrrec.

Atenció al client i reclamacions

Escriu-nos a {{EMAIL}} indicant el teu número de comanda. Atenem les reclamacions en el termini màxim d'un mes.

Si no quedes satisfet amb la nostra resposta, pots acudir a les autoritats de consum de la teva comunitat autònoma o als tribunals.

Llei aplicable i jurisdicció

El contracte es regeix per la llei anglesa, sense que això privi el consumidor de la protecció que li atorguen les disposicions imperatives de la llei del seu país de residència habitual. Com a consumidor resident a Espanya, pots reclamar davant els tribunals espanyols corresponents al teu domicili.

Darrera actualització: {{FECHA}}`,

    en: `Who we are and what this document covers

These terms govern the purchase of products from {{TIENDA}}, a shop operated by {{EMPRESA}}, company number {{ID}}, with its office at {{DOMICILIO}}. You can write to us at {{EMAIL}}.

By confirming an order you accept these terms. We recommend saving or printing them.

Who can buy

To buy you must be 18 or over and have legal capacity to contract. Our products are intended solely for adults. We reserve the right to cancel any order where there are indications that the buyer is a minor.

How the purchase is made

You add products to the basket, enter the delivery address and pay. You will receive a confirmation email with the order number and the details of your purchase. That email confirms we have received your order; the contract is concluded when we confirm dispatch.

If a product turns out to be unavailable after your payment, we will tell you and refund that product in full.

Prices

Prices are shown in euros. For deliveries to mainland Spain and the Balearic Islands they include applicable Spanish VAT.

Deliveries to the Canary Islands, Ceuta and Melilla are invoiced without Spanish VAT, as these are outside the territory where the tax applies. In exchange, they are subject to the taxes of those territories, which you will pay on delivery as set out below.

Shipping costs are calculated and shown in the basket before you confirm payment.

Import taxes and customs charges

Please read this carefully, as it may mean an extra cost for you.

Products are shipped from outside the European Union. On entering the customs territory, most orders are subject to import VAT, and the carrier usually adds a fee for handling customs clearance.

These amounts are not included in the price you pay in the shop and are paid by the recipient on delivery. We cannot know the exact amount in advance, as it depends on the declared value, the carrier and the customs office handling the shipment.

The same applies to deliveries to the Canary Islands, Ceuta and Melilla.

If the recipient refuses the parcel because they do not wish to pay those amounts, the order will be returned to us and we will refund the price of the products, less the shipping and return costs actually incurred.

Payment methods

We currently accept payment by cryptocurrency through our payment provider. The available payment methods are always shown at checkout.

As payment is made in cryptocurrency, the amount is calculated at the rate applicable when the payment order is generated, and must be completed within the period indicated by the gateway. If payment arrives late or for a different amount, the gateway may reject it or require an adjustment.

Delivery times

Estimated times, counted from payment confirmation, are:

- Mainland Spain: 3 to 7 working days
- Balearic Islands: 4 to 9 working days
- Canary Islands: 5 to 12 working days
- Ceuta and Melilla: 5 to 14 working days

These are estimates. Customs procedures may extend them and are outside our control. If an order is significantly delayed we will let you know, and you may cancel the contract and get your money back.

Right of withdrawal

You have {{DIAS}} calendar days from receiving your order to withdraw from the purchase without giving a reason and without penalty.

Important hygiene exception. The right of withdrawal does not apply to sealed goods which are not suitable for return for health protection or hygiene reasons and which were unsealed after delivery. Given the nature of our catalogue, this exception covers most of our products: once you break the seal on a toy, a lubricant or any intimate item, you can no longer withdraw from its purchase.

You may examine the product and its packaging as you would in a physical shop, but not unseal or use it if you want to keep the right to return it.

You will find the full procedure and the withdrawal form on our returns page.

Legal guarantee

Products carry the three-year legal guarantee of conformity from delivery, under Spanish consumer law. If the product is not as it should be, you are entitled to have it repaired or replaced and, where that is not possible, to a price reduction or to cancel the contract.

The cost of returning a faulty product, or one that does not match what was ordered, is on us.

Customer service and complaints

Write to us at {{EMAIL}} quoting your order number. We handle complaints within one month at most.

If you are not satisfied with our answer, you can turn to the consumer authorities of your region or to the courts.

Governing law and jurisdiction

The contract is governed by English law, without depriving the consumer of the protection afforded by the mandatory provisions of the law of their country of habitual residence. As a consumer resident in Spain, you may bring proceedings before the Spanish courts of your domicile.

Last updated: {{FECHA}}`,
  },

  // ══════════════════════════════════════════════════════════
  {
    handle: 'envios',
    es: `Dónde enviamos

Enviamos a toda España: Península, Baleares, Canarias, Ceuta y Melilla.

Plazos estimados

Se cuentan desde que confirmamos tu pago, no desde que haces el pedido.

- Península: de 3 a 7 días laborables
- Baleares: de 4 a 9 días laborables
- Canarias: de 5 a 12 días laborables
- Ceuta y Melilla: de 5 a 14 días laborables

Son estimaciones basadas en la experiencia habitual. Los trámites de aduana pueden alargarlas y no dependen de nosotros.

Gastos de envío

El coste exacto se calcula en el carrito según tu dirección, antes de que confirmes el pago. Nunca aparece un cargo que no hayas visto antes de pagar.

Los pedidos iguales o superiores a {{GRATIS}} tienen el envío gratuito.

Embalaje discreto

Todos los pedidos se envían en embalaje neutro. En el exterior del paquete no aparece el nombre de la tienda, ni imágenes, ni ninguna referencia al contenido. En el remitente figuran únicamente los datos necesarios para la entrega y la devolución.

Aduanas e impuestos de importación

Los productos se envían desde fuera de la Unión Europea. Esto significa que, al llegar, la mayoría de los pedidos están sujetos al IVA de importación y a una tarifa de gestión que aplica el transportista.

Estos importes no están incluidos en lo que pagas en la tienda: los abona quien recibe el paquete, en el momento de la entrega. Su cuantía depende del valor del pedido, del transportista y de la aduana, así que no podemos anticipártela.

Los envíos a Canarias, Ceuta y Melilla se facturan sin IVA español y están sujetos a los impuestos propios de esos territorios, que también se abonan a la entrega.

Preferimos decírtelo claro antes de que compres, y no que te lo encuentres en la puerta de casa.

Seguimiento

En cuanto el paquete sale, te enviamos por correo el número de seguimiento y el enlace para consultarlo. También puedes verlo desde tu cuenta, en el detalle del pedido.

Si el seguimiento no se actualiza durante varios días, suele ser porque el paquete está en tránsito internacional o en trámites aduaneros. Si pasa más de una semana sin movimiento, escríbenos.

Direcciones incorrectas o entregas fallidas

Comprueba bien la dirección antes de confirmar. Si un paquete se devuelve por una dirección incompleta o errónea, o porque nadie lo recoge en el plazo que da el transportista, tendremos que repercutirte los gastos de un nuevo envío.

Si el paquete se pierde en tránsito, nos hacemos cargo: abrimos reclamación con el transportista y te enviamos uno nuevo o te devolvemos el importe.

Última actualización: {{FECHA}}`,

    ca: `On enviem

Enviem a tot Espanya: Península, Balears, Canàries, Ceuta i Melilla.

Terminis estimats

Es compten des que confirmem el teu pagament, no des que fas la comanda.

- Península: de 3 a 7 dies laborables
- Balears: de 4 a 9 dies laborables
- Canàries: de 5 a 12 dies laborables
- Ceuta i Melilla: de 5 a 14 dies laborables

Són estimacions basades en l'experiència habitual. Els tràmits de duana poden allargar-les i no depenen de nosaltres.

Despeses d'enviament

El cost exacte es calcula a la cistella segons la teva adreça, abans que confirmis el pagament. Mai apareix un càrrec que no hagis vist abans de pagar.

Les comandes iguals o superiors a {{GRATIS}} tenen l'enviament gratuït.

Embalatge discret

Totes les comandes s'envien en embalatge neutre. A l'exterior del paquet no hi apareix el nom de la botiga, ni imatges, ni cap referència al contingut. Al remitent hi figuren únicament les dades necessàries per al lliurament i la devolució.

Duanes i impostos d'importació

Els productes s'envien des de fora de la Unió Europea. Això vol dir que, en arribar, la majoria de comandes estan subjectes a l'IVA d'importació i a una tarifa de gestió que aplica el transportista.

Aquests imports no estan inclosos en el que pagues a la botiga: els abona qui rep el paquet, en el moment del lliurament. La seva quantia depèn del valor de la comanda, del transportista i de la duana, així que no te la podem anticipar.

Els enviaments a les Canàries, Ceuta i Melilla es facturen sense IVA espanyol i estan subjectes als impostos propis d'aquests territoris, que també s'abonen en el lliurament.

Preferim dir-t'ho clar abans que compris, i no que t'ho trobis a la porta de casa.

Seguiment

Tan bon punt el paquet surt, t'enviem per correu el número de seguiment i l'enllaç per consultar-lo. També el pots veure des del teu compte, al detall de la comanda.

Si el seguiment no s'actualitza durant uns quants dies, sol ser perquè el paquet és en trànsit internacional o en tràmits duaners. Si passa més d'una setmana sense moviment, escriu-nos.

Adreces incorrectes o lliuraments fallits

Comprova bé l'adreça abans de confirmar. Si un paquet es retorna per una adreça incompleta o errònia, o perquè ningú no el recull en el termini que dona el transportista, haurem de repercutir-te les despeses d'un nou enviament.

Si el paquet es perd en trànsit, ens en fem càrrec: obrim reclamació amb el transportista i te n'enviem un de nou o et retornem l'import.

Darrera actualització: {{FECHA}}`,

    en: `Where we ship

We ship throughout Spain: the mainland, the Balearic Islands, the Canary Islands, Ceuta and Melilla.

Estimated times

These are counted from when we confirm your payment, not from when you place the order.

- Mainland Spain: 3 to 7 working days
- Balearic Islands: 4 to 9 working days
- Canary Islands: 5 to 12 working days
- Ceuta and Melilla: 5 to 14 working days

These are estimates based on normal experience. Customs procedures can extend them and are outside our control.

Shipping costs

The exact cost is calculated in the basket based on your address, before you confirm payment. No charge ever appears that you have not seen before paying.

Orders of {{GRATIS}} or more ship free.

Plain packaging

Every order ships in plain packaging. The outside of the parcel carries no shop name, no images and no reference to the contents. The sender details show only what is needed for delivery and return.

Customs and import taxes

Products are shipped from outside the European Union. That means most orders are subject to import VAT on arrival, plus a handling fee applied by the carrier.

These amounts are not included in what you pay in the shop: they are paid by whoever receives the parcel, at the point of delivery. The amount depends on the order value, the carrier and the customs office, so we cannot tell you in advance.

Deliveries to the Canary Islands, Ceuta and Melilla are invoiced without Spanish VAT and are subject to the taxes of those territories, also payable on delivery.

We would rather tell you plainly before you buy than have you find out at your front door.

Tracking

As soon as the parcel leaves, we email you the tracking number and a link to follow it. You can also see it in your account, in the order details.

If tracking does not update for several days, it is usually because the parcel is in international transit or going through customs. If more than a week passes with no movement, write to us.

Wrong addresses and failed deliveries

Check your address carefully before confirming. If a parcel is returned because the address was incomplete or wrong, or because nobody collected it within the carrier's deadline, we will have to pass on the cost of reshipping.

If a parcel is lost in transit, that is on us: we open a claim with the carrier and either send a new one or refund you.

Last updated: {{FECHA}}`,
  },

  // ══════════════════════════════════════════════════════════
  {
    handle: 'devoluciones',
    es: `Tu derecho a devolver

Tienes {{DIAS}} días naturales desde que recibes el pedido para desistir de la compra, sin tener que explicar por qué y sin penalización.

Antes de nada: la excepción por higiene

Es lo más importante de esta página, así que va primero.

La ley excluye del derecho de desistimiento los productos precintados que no puedan devolverse por razones de protección de la salud o de higiene, cuando se han desprecintado después de la entrega.

En una tienda como la nuestra, esto alcanza a casi todo el catálogo: juguetes, lubricantes, cosmética íntima y cualquier artículo de uso personal. Si rompes el precinto, ya no podrás devolverlo.

Sí puedes abrir la caja de envío y examinar el producto por fuera, como harías en una tienda. Lo que no puedes es desprecintarlo ni probarlo si quieres conservar el derecho a devolverlo.

Esta excepción no se aplica cuando el producto llega defectuoso, dañado o no es el que pediste. En ese caso responde la garantía, y lo cubrimos nosotros.

Cómo devolver

1. Escríbenos a {{EMAIL}} dentro del plazo de {{DIAS}} días, indicando tu número de pedido y qué producto quieres devolver. Puedes usar el formulario que encontrarás más abajo, aunque no es obligatorio.
2. Te contestaremos con la dirección de devolución y las instrucciones.
3. Envíanos el producto en un plazo máximo de 14 días naturales desde que nos comunicas tu decisión.

En qué estado debe volver

Sin usar, con su precinto intacto, con todos sus accesorios y en su embalaje original. Eres responsable de la disminución de valor que resulte de una manipulación distinta de la necesaria para comprobar la naturaleza y el funcionamiento del producto.

Quién paga el envío de vuelta

- Si devuelves por desistimiento, los gastos de devolución son a tu cargo.
- Si el producto llegó defectuoso, dañado o no era el que pediste, los pagamos nosotros.

Reembolso

Te devolvemos el importe en un plazo máximo de 14 días naturales desde que nos comunicas tu desistimiento. Podemos retener el reembolso hasta haber recibido el producto, o hasta que nos acredites que lo has enviado, lo que ocurra antes.

El reembolso se hace por el mismo medio de pago que usaste. Si pagaste en criptomoneda, te devolveremos el equivalente al importe en euros de tu pedido, calculado al cambio del momento del reembolso; ten en cuenta que la cotización puede haber variado desde tu compra. Si lo prefieres, podemos acordar otro medio de devolución sin coste para ti.

Si elegiste una modalidad de envío más cara que la estándar, te reembolsamos el coste de la estándar.

Productos defectuosos y garantía

Los productos tienen tres años de garantía legal de conformidad desde la entrega. Si algo falla, escríbenos con tu número de pedido y fotografías del problema, y lo resolvemos con reparación, sustitución, rebaja del precio o devolución del dinero, según corresponda.

Formulario de desistimiento

No es obligatorio usarlo, pero si te resulta cómodo, copia estas líneas y envíanoslas a {{EMAIL}}:

A la atención de {{EMPRESA}}, {{DOMICILIO}} ({{EMAIL}}):

Por la presente le comunico que desisto de mi contrato de venta del siguiente bien:
Pedido número:
Fecha de recepción:
Nombre del consumidor:
Domicilio del consumidor:
Fecha:

Última actualización: {{FECHA}}`,

    ca: `El teu dret a retornar

Tens {{DIAS}} dies naturals des que reps la comanda per desistir de la compra, sense haver d'explicar per què i sense penalització.

Abans de res: l'excepció per higiene

És el més important d'aquesta pàgina, així que va primer.

La llei exclou del dret de desistiment els productes precintats que no es puguin retornar per raons de protecció de la salut o d'higiene, quan s'han desprecintat després del lliurament.

En una botiga com la nostra, això abasta gairebé tot el catàleg: joguines, lubricants, cosmètica íntima i qualsevol article d'ús personal. Si trenques el precinte, ja no el podràs retornar.

Sí que pots obrir la caixa d'enviament i examinar el producte per fora, com faries en una botiga. El que no pots és desprecintar-lo ni provar-lo si vols conservar el dret a retornar-lo.

Aquesta excepció no s'aplica quan el producte arriba defectuós, danyat o no és el que vas demanar. En aquest cas respon la garantia, i ho cobrim nosaltres.

Com retornar

1. Escriu-nos a {{EMAIL}} dins del termini de {{DIAS}} dies, indicant el teu número de comanda i quin producte vols retornar. Pots fer servir el formulari que trobaràs més avall, encara que no és obligatori.
2. Et contestarem amb l'adreça de devolució i les instruccions.
3. Envia'ns el producte en un termini màxim de 14 dies naturals des que ens comuniques la teva decisió.

En quin estat ha de tornar

Sense usar, amb el precinte intacte, amb tots els seus accessoris i en el seu embalatge original. Ets responsable de la disminució de valor que resulti d'una manipulació diferent de la necessària per comprovar la naturalesa i el funcionament del producte.

Qui paga l'enviament de tornada

- Si retornes per desistiment, les despeses de devolució van al teu càrrec.
- Si el producte va arribar defectuós, danyat o no era el que vas demanar, les paguem nosaltres.

Reemborsament

Et retornem l'import en un termini màxim de 14 dies naturals des que ens comuniques el teu desistiment. Podem retenir el reemborsament fins a haver rebut el producte, o fins que ens acreditis que l'has enviat, el que passi abans.

El reemborsament es fa pel mateix mitjà de pagament que vas fer servir. Si vas pagar en criptomoneda, et retornarem l'equivalent a l'import en euros de la teva comanda, calculat al canvi del moment del reemborsament; tingues en compte que la cotització pot haver variat des de la teva compra. Si ho prefereixes, podem acordar un altre mitjà de devolució sense cap cost per a tu.

Si vas triar una modalitat d'enviament més cara que l'estàndard, et reemborsem el cost de l'estàndard.

Productes defectuosos i garantia

Els productes tenen tres anys de garantia legal de conformitat des del lliurament. Si alguna cosa falla, escriu-nos amb el teu número de comanda i fotografies del problema, i ho resolem amb reparació, substitució, rebaixa del preu o devolució dels diners, segons correspongui.

Formulari de desistiment

No és obligatori fer-lo servir, però si et resulta còmode, copia aquestes línies i envia-nos-les a {{EMAIL}}:

A l'atenció de {{EMPRESA}}, {{DOMICILIO}} ({{EMAIL}}):

Per la present li comunico que desisteixo del meu contracte de venda del bé següent:
Comanda número:
Data de recepció:
Nom del consumidor:
Domicili del consumidor:
Data:

Darrera actualització: {{FECHA}}`,

    en: `Your right to return

You have {{DIAS}} calendar days from receiving your order to withdraw from the purchase, without having to explain why and without penalty.

First of all: the hygiene exception

This is the most important part of this page, so it comes first.

The law excludes from the right of withdrawal sealed goods which cannot be returned for health protection or hygiene reasons, where they have been unsealed after delivery.

In a shop like ours, that covers almost the whole catalogue: toys, lubricants, intimate cosmetics and any item for personal use. Once you break the seal, you can no longer return it.

You can open the shipping box and examine the product from the outside, as you would in a shop. What you cannot do is unseal or try it if you want to keep the right to return it.

This exception does not apply where the product arrives faulty, damaged or is not what you ordered. In that case the guarantee applies, and it is on us.

How to return

1. Write to {{EMAIL}} within the {{DIAS}}-day period, giving your order number and which product you want to return. You can use the form below, though it is not compulsory.
2. We will reply with the return address and instructions.
3. Send us the product within 14 calendar days at most from telling us your decision.

What condition it must come back in

Unused, with the seal intact, with all accessories and in its original packaging. You are responsible for any loss in value resulting from handling beyond what is necessary to establish the nature and functioning of the product.

Who pays the return postage

- If you return under the right of withdrawal, return costs are yours.
- If the product arrived faulty, damaged or was not what you ordered, we pay.

Refund

We refund you within 14 calendar days at most from when you tell us you are withdrawing. We may withhold the refund until we have received the product, or until you show us you have sent it, whichever comes first.

The refund is made using the same payment method you used. If you paid in cryptocurrency, we will return the equivalent of your order's euro amount, calculated at the rate at the time of the refund; note that the exchange rate may have moved since your purchase. If you prefer, we can agree another refund method at no cost to you.

If you chose a more expensive delivery option than the standard one, we refund the cost of the standard option.

Faulty products and guarantee

Products carry a three-year legal guarantee of conformity from delivery. If something fails, write to us with your order number and photographs of the problem, and we will resolve it by repair, replacement, price reduction or refund, as appropriate.

Withdrawal form

Using it is not compulsory, but if you find it convenient, copy these lines and send them to {{EMAIL}}:

For the attention of {{EMPRESA}}, {{DOMICILIO}} ({{EMAIL}}):

I hereby give notice that I withdraw from my contract of sale of the following goods:
Order number:
Date received:
Consumer's name:
Consumer's address:
Date:

Last updated: {{FECHA}}`,
  },
];

// ═══════════════════════════════════════════════════════════
//  Importador
// ═══════════════════════════════════════════════════════════

const API = (process.env['API'] ?? 'http://localhost:3001').replace(/\/+$/, '');
const APLICAR = process.argv.includes('--aplicar') || process.argv.includes('--publicar');
const PUBLICAR = process.argv.includes('--publicar');
const LOCALES = ['es', 'ca', 'en'];

const color = {
  gris: (s) => `\x1b[90m${s}\x1b[0m`,
  verde: (s) => `\x1b[32m${s}\x1b[0m`,
  rojo: (s) => `\x1b[31m${s}\x1b[0m`,
  amarillo: (s) => `\x1b[33m${s}\x1b[0m`,
  negrita: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(`${API}/api/v1${ruta}`, {
    ...opciones,
    headers: { 'content-type': 'application/json', ...(opciones.headers ?? {}) },
  });

  const texto = await respuesta.text();
  const cuerpo = texto ? JSON.parse(texto) : null;

  if (!respuesta.ok) {
    throw new Error(`${respuesta.status} en ${ruta}: ${JSON.stringify(cuerpo?.message ?? '')}`);
  }

  return cuerpo;
}

async function token() {
  if (process.env['ADMIN_TOKEN']) return process.env['ADMIN_TOKEN'];

  const email = process.env['ADMIN_EMAIL'];
  const password = process.env['ADMIN_PASSWORD'];
  if (!email || !password) {
    throw new Error('Faltan credenciales: define ADMIN_TOKEN, o ADMIN_EMAIL y ADMIN_PASSWORD.');
  }

  const sesion = await pedir('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!sesion?.accessToken) throw new Error('El login no ha devuelto token.');
  return sesion.accessToken;
}

/**
 * Los datos de la empresa, sacados de la propia tienda.
 *
 * Se leen aquí y no se escriben en los textos para que una corrección del
 * domicilio social en el panel no obligue a repasar dieciocho documentos.
 */
async function datosDeLaTienda() {
  const ajustes = await pedir('/settings/public');

  const texto = (clave) => {
    const v = ajustes[clave];
    return typeof v === 'string' ? v.trim() : '';
  };

  const faltan = ['legal.companyName', 'legal.taxId', 'legal.address'].filter((k) => !texto(k));
  if (faltan.length > 0) {
    throw new Error(
      `La tienda no tiene configurado: ${faltan.join(', ')}. Rellénalo en Ajustes antes de importar.`,
    );
  }

  const email = (process.env['EMAIL_CONTACTO'] ?? texto('shop.contactEmail')).trim();
  if (!email) {
    throw new Error(
      'Falta el correo de atención al cliente. Define EMAIL_CONTACTO, o configúralo en\n' +
        '  Ajustes como shop.contactEmail. Las páginas legales tienen que ofrecer una\n' +
        '  vía de contacto que funcione: publicarlas sin ella no cumple.',
    );
  }

  const dias = Number(ajustes['legal.withdrawalDays'] ?? 14);
  const umbral = Number(ajustes['shop.freeShippingThreshold'] ?? 0);

  // El dominio de la tienda sale del de la API quitándole el «api.»: son el
  // mismo despliegue y así no hay un dato más que mantener a mano.
  const dominio = new URL(API).hostname.replace(/^api\./, '');

  return {
    tienda: texto('brand.name') || 'La tienda',
    empresa: texto('legal.companyName'),
    id: texto('legal.taxId'),
    domicilio: texto('legal.address'),
    email,
    dominio,
    dias,
    umbral,
  };
}

function sustituir(plantilla, datos, locale) {
  const fecha = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const gratis = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(
    datos.umbral / 100,
  );

  return plantilla
    .replaceAll('{{TIENDA}}', datos.tienda)
    .replaceAll('{{EMPRESA}}', datos.empresa)
    .replaceAll('{{ID}}', datos.id)
    .replaceAll('{{DOMICILIO}}', datos.domicilio)
    .replaceAll('{{EMAIL}}', datos.email)
    .replaceAll('{{DOMINIO}}', datos.dominio)
    .replaceAll('{{DIAS}}', String(datos.dias))
    .replaceAll('{{GRATIS}}', gratis)
    .replaceAll('{{FECHA}}', fecha);
}

async function principal() {
  console.log(`\n  API      ${color.negrita(API)}`);
  console.log(
    `  Modo     ${APLICAR ? (PUBLICAR ? color.verde('aplicar y publicar') : color.verde('aplicar')) : color.amarillo('ensayo')}\n`,
  );

  const datos = await datosDeLaTienda();

  console.log(`  ${color.negrita(datos.empresa)}  ·  ${datos.id}`);
  console.log(color.gris(`  ${datos.domicilio}`));
  console.log(color.gris(`  ${datos.email}  ·  ${datos.dominio}`));
  console.log(
    color.gris(`  Desistimiento ${datos.dias} días · envío gratis desde ${datos.umbral / 100} €\n`),
  );

  const acceso = await token();
  const lista = await pedir('/content/admin/pages', {
    headers: { authorization: `Bearer ${acceso}` },
  });
  const porHandle = new Map(lista.map((p) => [p.handle, p]));

  let escritas = 0;

  for (const pagina of PAGINAS) {
    const resumen = porHandle.get(pagina.handle);
    if (!resumen) {
      console.log(`  ${color.rojo('✗')} ${pagina.handle} — no existe en la tienda`);
      continue;
    }

    const detalle = await pedir(`/content/admin/pages/${resumen.id}`, {
      headers: { authorization: `Bearer ${acceso}` },
    });

    /*
     * Solo cambia el contenido.
     *
     * El título y la dirección se copian tal cual estaban: el pie de la tienda
     * enlaza estas páginas por su dirección, y cambiarla las rompe sin avisar.
     * Las etiquetas para buscadores también se devuelven tal cual, porque la
     * API sobrescribe con nulo lo que no reciba.
     */
    const translations = LOCALES.map((locale) => {
      const previa = detalle.translations.find((t) => t.locale === locale);
      return {
        locale,
        title: previa?.title ?? pagina.handle,
        slug: previa?.slug ?? pagina.handle,
        content: sustituir(pagina[locale], datos, locale),
        ...(previa?.metaTitle ? { metaTitle: previa.metaTitle } : {}),
        ...(previa?.metaDescription ? { metaDescription: previa.metaDescription } : {}),
      };
    });

    const sinTraducir = LOCALES.filter((l) => !detalle.translations.some((t) => t.locale === l));
    const letras = translations.reduce((n, t) => n + t.content.length, 0);
    // El título en español: las traducciones vienen en el orden que las
    // devuelva la base, y coger la primera enseñaba el catalán.
    const nombre = translations.find((t) => t.locale === 'es')?.title ?? pagina.handle;

    if (!APLICAR) {
      console.log(`  ${color.negrita(nombre)}`);
      console.log(
        color.gris(
          `    ${pagina.handle} · ${detalle.status} · ${letras} caracteres en 3 idiomas` +
            (sinTraducir.length > 0 ? ` · se añade ${sinTraducir.join(', ').toUpperCase()}` : ''),
        ),
      );
      continue;
    }

    try {
      await pedir('/content/admin/pages', {
        method: 'POST',
        headers: { authorization: `Bearer ${acceso}` },
        body: JSON.stringify({
          id: detalle.id,
          handle: detalle.handle,
          status: PUBLICAR ? 'PUBLISHED' : detalle.status,
          translations,
        }),
      });
      escritas++;
      console.log(
        `  ${color.verde('✓')} ${nombre} ` +
          color.gris(`(${letras} caracteres${PUBLICAR ? ', publicada' : ''})`),
      );
    } catch (error) {
      console.log(`  ${color.rojo('✗')} ${pagina.handle} — ${error.message}`);
    }
  }

  if (!APLICAR) {
    console.log(color.amarillo('\n  Ensayo: no se ha escrito nada. Repite con --aplicar.\n'));
    return;
  }

  console.log(color.verde(`\n  ${escritas} de ${PAGINAS.length} páginas escritas.`));
  console.log(
    color.gris('  Guardar purga la caché de la tienda, así que el texto nuevo se ve al momento.\n'),
  );
}

principal().catch((error) => {
  console.error(color.rojo(`\n  ${error.message}\n`));
  process.exit(1);
});
