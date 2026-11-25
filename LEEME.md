# brandlabbeauty-qa

Automatización en la nube de brandlabbeauty.org. No depende de ninguna computadora encendida.

| Workflow | Cuándo corre | Qué hace |
|---|---|---|
| QA semanal del sitio | Lunes 09:17 (CDMX) y a mano | Revisa las URL del sitemap: HTTP, canonical, noindex, enlaces internos rotos, WhatsApp oficial con su origen, lastmod frente a dateModified, posibles soft 404, títulos repetidos y vigencias CONOCER. Después corre PageSpeed y la analítica (Search Console, URL Inspection, GA4 y Bing) y gestiona las alertas. |
| IndexNow diario | Diario 07:41 (CDMX) y a mano | Avisa solo de las URL cuyo lastmod cambió desde el último envío. No hace falta webhook ni secretos. |

## Alertas
Si algo falla, se crea un issue con la etiqueta `alerta-qa`, o se comenta en el que ya esté abierto, y GitHub avisa por correo. Cuando todo vuelve a pasar, el issue se cierra solo.

## Privacidad
Mientras el repositorio sea público, el job de analítica no corre (`if: github.event.repository.private`): en un repositorio público los datos de Search Console y GA4 quedarían a la vista de cualquiera. Ese job se activa solo si el repositorio vuelve a ser privado.

## Secretos opcionales
Se configuran en *Settings → Secrets and variables → Actions*. Nunca se comparten por chat.
- `GOOGLE_SA_JSON`: la llave JSON de una cuenta de servicio de Google Cloud (gratuita). Esa cuenta necesita acceso «Restringido» en Search Console y «Lector» en GA4.
- `GA4_PROPERTY_ID`: el ID numérico de la propiedad GA4.
- `BING_API_KEY`: la clave de la API de Bing Webmaster Tools.
- `PSI_KEY`: la clave de la API de PageSpeed.

Si falta alguno, esa sección del informe aparece como «bloqueada» y la ejecución no falla.

## Prueba controlada de errores
Ve a *Actions → QA semanal del sitio → Run workflow* y escribe en `url_prueba` una ruta que no exista, por ejemplo `/no-existe-prueba-qa`. La ejecución debe fallar y crear la alerta.

## Límites gratuitos
Consume unos 50 minutos al mes de los 2,000 incluidos en un repositorio privado.

## Reversión
Para apagar un workflow: *Actions → workflow → Disable workflow*. Ningún workflow modifica el sitio.
