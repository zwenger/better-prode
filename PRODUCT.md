# Product

## Register

product

## Users

Hinchas de fútbol (Argentina / LatAm) que arman un **prode** con amigos, familia o la oficina durante un torneo (Mundial 2026). Predicen el marcador exacto de los próximos partidos antes del kickoff, compiten en una tabla dentro de uno o varios grupos privados, y vuelven alrededor de los días de partido para predecir, ver resultados y ver cómo les fue a ellos y a su grupo.

Contexto de uso: mayormente **mobile, en ráfagas cortas** — predigo los partidos del día antes de que arranquen, y después chequeo cómo salió y cómo quedó la tabla. Trabajo a resolver: *"predecir los partidos rápido, ver cómo voy contra mis amigos, y no perderme el cierre de ningún partido."*

## Product Purpose

better-prode es un prode del Mundial **rápido y mobile-first**. Reemplaza a las herramientas viejas (lentas, amontonadas, ilegibles) con una experiencia limpia y confiable: predecís marcadores por partido (se cierra a kickoff−5min), sumás puntos con un sistema fijo (marcador exacto = **pleno** = 7; resultado correcto +3; cada gol exacto +1), y competís en tablas por grupo.

Un usuario pertenece a **varios grupos**; las predicciones son `(usuario, partido)` y se comparten entre todos sus grupos — cada grupo es un **lente de comparación**, no el dueño de la predicción.

Éxito = la gente lo usa de verdad cada día de partido, predecir es sin fricción, y la tabla + el pique social los hacen volver.

## Brand Personality

**Equilibrado: dato útil con calor social.** Voz clara, confiada y con un toque de juego — como chequear los resultados con amigos, no como llenar un formulario. Tres palabras: **confiable, vivo, preciso.** Spanish-first, copy rioplatense natural.

Metas emocionales: **confianza** (es rápido y nunca pierde mi pick), **pertenencia** (mi grupo, mis rivales), y el pequeño subidón de un **pleno**.

Estética de referencia: la **limpieza y precisión de un buen fintech** (Mercado Pago / Wise — calma, jerarquía clara, mobile impecable) cruzada con la **energía competitiva de un fantasy sports** (ESPN / DraftKings — ligas, picks, ranking social bien resueltos).

## Anti-references

- **Prode viejo amontonado** (estilo prodeenlinea.com): cramped, lento, tablas ilegibles, todo peleando por espacio. Es exactamente lo que reemplazamos. Tomamos la *densidad de información* de las planillas densas, pero NUNCA su amontonamiento.
- **Dashboard SaaS genérico**: gris, frío, corporativo, sin alma — el look "AI dashboard" por defecto.
- (Implícito, derivado: tampoco sitio de apuestas/casino, ni sobre-gamificado infantil.)

## Design Principles

1. **Densidad sin amontonamiento.** Mostrar info genuinamente útil (forma, resultados, desglose de puntos) pero con el espaciado y la jerarquía de un fintech limpio. La información es densa; el layout respira. Nunca el muro del prode viejo.
2. **Verdad de un vistazo.** Lo importante — cómo salió el partido, qué predije, cuánto sumé — se lee sin un solo click, codificado visualmente (color + posición + valor), nunca escondido detrás de un "expandir".
3. **Mobile-first, honesto con el pulgar.** Diseñado para uso a una mano en ráfagas cortas; sin scroll horizontal dentro de cards; touch targets ≥44px; el detalle vive en bottom sheets, no en overlays incómodos.
4. **El grupo es el punto.** La competencia y la comparación social (tabla, plenos, picks de los rivales) son ciudadanos de primera clase, no un agregado. Hacer visible la pertenencia y la rivalidad.
5. **Confiá en el cierre.** Nunca perder ni tergiversar una predicción; el lock es claro y honesto; el usuario siempre sabe que su pick está guardado y qué le queda abierto por predecir.

## Accessibility & Inclusion

WCAG 2.1 **AA**. Texto de cuerpo ≥4.5:1, texto grande ≥3:1; placeholders al mismo 4.5:1. Estados de foco visibles. Touch targets mínimos 44×44px. `prefers-reduced-motion` respetado en toda animación (crossfade o transición instantánea como alternativa).

Las señales de acierto/error del desglose (verde/rojo) **pairean color con una pista no-cromática** (glifo ✓/✗ y la posición exacta del número), así no dependen solo del color — mantiene el breakdown usable para daltonismo aunque "color-blind safe" completo no haya sido requisito duro.
