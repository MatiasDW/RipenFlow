# Reglas de Optimizacion

## Objetivo
Esta guia resume como identificar y documentar las reglas de optimizacion del problema de ripening, separando:

- objetivo economico,
- restricciones duras,
- penalizaciones,
- alertas operativas,
- y requisitos de datos.

## 1. Regla principal del negocio
El objetivo real no es solo usar menos camaras ni solo cumplir una fecha. El objetivo es:

- maximizar valor economico,
- o de forma equivalente, minimizar perdida economica total.

En este contexto, perder plata puede venir de:

- pedidos entregados tarde,
- pedidos no cumplidos,
- producto madurado sin demanda asignada,
- producto sobre madurado,
- uso de camaras,
- cambios de receta,
- perdida de valor por envejecimiento del producto.

## 2. Jerarquia correcta de optimizacion
Para este problema, la jerarquia recomendada es:

1. Cumplir fecha objetivo del pedido.
2. Cumplir cantidad pedida.
3. Evitar madurar producto sin demanda asignada.
4. Minimizar perdida economica total.
5. Usar la menor cantidad posible de camaras, siempre que no empeore la utilidad.

## 3. Como clasificar cada regla

### Objetivo de optimizacion
Va en la funcion objetivo cuando sirve para comparar soluciones economicamente.

Ejemplos:

- minimizar atraso total,
- minimizar perdida por producto sobre madurado,
- minimizar producto madurado sin salida,
- minimizar costo de uso de camaras,
- minimizar costo de cambio de receta.

### Restriccion dura
Si una condicion no se puede violar, es restriccion dura.

Ejemplos:

- no exceder capacidad de camara,
- no usar una receta incompatible con el producto,
- no asignar mas cantidad que la disponible en un lote,
- no poner el mismo lote en dos camaras al mismo tiempo,
- no violar reglas fisicas del proceso,
- no exceder silenciosamente la cantidad pedida.

### Alerta o excepcion operativa
Si una condicion no siempre invalida el plan, pero indica riesgo o perdida, debe modelarse como alerta.

Ejemplos:

- riesgo de sobre maduracion,
- riesgo de terminar tarde,
- riesgo de terminar demasiado temprano si eso degrada calidad,
- exceso de inventario madurado sin demanda,
- necesidad de cambio de receta para llegar a fecha.

## 4. Reglas especificas del problema de ripening

### 4.1 Fecha objetivo
La fecha objetivo pertenece a la demanda, no al producto.

- `Product` define el tipo de fruta.
- `Order` y `OrderProduct` definen para cuando y cuanto necesita el cliente.

Conclusion:

- la optimizacion debe organizar lotes, recetas y camaras para cumplir la fecha del pedido.

### 4.2 Sobre maduracion
La sobre maduracion no debe tratarse como una simple preferencia.

- si el producto sobre madurado deja de ser util para el pedido, debe tratarse como estado invalido o perdida severa,
- si todavia puede venderse con descuento, debe registrarse como perdida economica alta y como alerta.

Regla practica:

- si sobre madurar rompe el negocio, va como restriccion o excepcion critica,
- si sobre madurar genera menor precio, va como penalizacion economica fuerte.

### 4.3 Exceso de producto madurado
Madurar producto por encima de la demanda es una fuente directa de perdida de valor.

- no deberia ser un resultado normal del plan,
- si ocurre, debe quedar modelado como excedente, sobrante o inventario no asignado,
- y debe impactar negativamente la funcion objetivo.

### 4.4 Cambios de receta
Los cambios de receta no son un fin en si mismos.

- solo importan si ayudan a cumplir fecha objetivo,
- o si reducen perdida economica total.

Conclusion:

- el sistema no debe minimizar cambios de receta por defecto,
- debe evaluarlos por su impacto en cumplimiento y utilidad.

### 4.5 Uso de camaras
Usar menos camaras es una buena regla, pero subordinada al objetivo economico.

- no conviene usar pocas camaras si eso genera atraso o sobre maduracion,
- si dos planes cumplen igual, se prefiere el que usa menos camaras o menor costo de operacion.

## 5. Variables de decision del problema
Las decisiones reales del optimizador no ocurren sobre el producto abstracto, sino sobre inventario y recursos fisicos.

Las variables de decision suelen ser:

- que lote usar,
- que cantidad de ese lote asignar,
- que receta aplicar,
- en que camara ejecutar el ciclo,
- cuando iniciar el ciclo,
- a que pedido o linea de pedido asignar el resultado.

## 6. Estructura de reglas recomendada

### Funcion objetivo
Minimizar la suma de:

- costo por atraso,
- costo por faltante,
- costo por producto madurado sin demanda asignada,
- costo por sobre maduracion,
- costo de uso de camaras,
- costo de cambio de receta,
- costo por perdida de valor del producto.

### Restricciones duras

- capacidad maxima por camara,
- compatibilidad receta-producto,
- disponibilidad real del lote,
- no superposicion invalida de uso de camara,
- no superposicion invalida del mismo lote,
- cumplimiento de reglas fisicas y operativas,
- trazabilidad de asignacion entre lote y pedido.

### Alertas operativas

- over-ripening risk,
- late completion risk,
- early completion risk,
- shortage risk,
- excess ripened inventory risk,
- recipe change required to meet due date.

## 7. Como identificar reglas en el enunciado

### Frases que suelen indicar objetivo economico

- "queremos perder menos plata",
- "el producto sobrante vale menos",
- "hay que maximizar margen",
- "hay que evitar desperdicio".

### Frases que suelen indicar restriccion dura

- "no puede exceder",
- "solo se puede usar",
- "debe cumplir",
- "no se permite",
- "como maximo".

### Frases que suelen indicar alerta o riesgo

- "si pasa esto, hay que avisar",
- "esto no deberia pasar",
- "si ocurre, perdemos valor",
- "es una excepcion operativa".

## 8. Entidades de datos que soportan esta optimizacion
Para que el problema pueda simularse bien, el modelo de datos deberia contemplar como minimo:

- `products`,
- `recipes`,
- `ripening_chambers`,
- `orders`,
- `order_products`,
- `batches`,
- `ripening_runs`,
- `order_allocations`,
- `planning_alerts`.

Tambien conviene separar:

- tablas de importacion cruda desde Excel,
- tablas normalizadas de negocio,
- tablas de simulacion o resultados.

## 9. Plantilla de analisis
Usa esta estructura para describir cualquier nueva regla:

### Regla
Describir la regla en una frase.

### Tipo

- objetivo,
- restriccion dura,
- penalizacion,
- alerta,
- requisito funcional,
- requisito de datos.

### Impacto

- que pasa si se cumple,
- que pasa si se viola,
- como afecta dinero, tiempo, calidad o capacidad.

### Medicion

- como se calcula,
- en que tabla o campo se refleja,
- como se compara entre escenarios.

## 10. Ejemplo aplicado a banana
Enunciado:
"Debemos cumplir la fecha de entrega del pedido de banana, evitando dejar fruta madurada sin salida y usando la menor cantidad posible de camaras."

Analisis:

- objetivo principal: minimizar perdida economica total,
- penalizacion: atraso del pedido,
- penalizacion: producto madurado sin demanda asignada,
- restriccion dura: no exceder capacidad de camara,
- restriccion dura: no usar mas cantidad de la disponible en el lote,
- alerta: riesgo de sobre maduracion,
- regla secundaria: usar menos camaras si no empeora el resultado economico.

## 11. Checklist rapido
Antes de cerrar el analisis, verificar:

- esta claro donde vive la fecha objetivo?
- esta claro que la demanda manda sobre el producto?
- esta claro que el objetivo final es economico?
- esta separada la restriccion dura de la penalizacion?
- esta separada la penalizacion de la alerta?
- esta modelado el riesgo de sobre maduracion?
- esta modelado el exceso de producto madurado?
- esta claro que usar menos camaras es un objetivo secundario?

## 12. Regla practica final
Si algo rompe fisicamente u operativamente el plan, es una restriccion dura.
Si algo puede pasar pero hace perder plata, es una penalizacion economica.
Si algo debe avisarse y monitorearse, es una alerta.
Si una solucion gana mas dinero o pierde menos, es mejor.
