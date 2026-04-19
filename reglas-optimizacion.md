# Reglas de Optimizacion

## Objetivo
Esta guia sirve para identificar, separar y documentar:

- La funcion objetivo del problema.
- Las restricciones que no se pueden violar.
- Los requisitos que definen que una solucion sea valida o deseable.

## 1. Como identificar el objetivo de optimizacion
Primero hay que detectar que se quiere mejorar. En general, el problema buscara una de estas dos cosas:

- Maximizar: ganancia, cobertura, productividad, uso de capacidad, nivel de servicio.
- Minimizar: costo, tiempo, desperdicio, riesgo, retraso, distancia, consumo.

Preguntas utiles:

- Que variable define que una solucion es mejor que otra?
- Si dos soluciones cumplen todo, por cual criterio elegimos una?
- El problema busca ahorrar, acelerar, asignar, balancear o priorizar?

Senales comunes en el enunciado:

- "Reducir", "minimizar", "disminuir" -> objetivo de minimizacion.
- "Aumentar", "maximizar", "mejorar" -> objetivo de maximizacion.
- "Priorizar" -> puede implicar pesos, niveles de servicio o ranking.

## 2. Como identificar restricciones
Las restricciones son condiciones que limitan las soluciones posibles. Si una solucion viola una restriccion, no deberia considerarse valida.

### Restricciones duras
Son obligatorias. No se pueden romper.

Ejemplos:

- El presupuesto no puede superar un limite.
- La capacidad de una maquina no puede excederse.
- Un pedido debe asignarse a una sola ruta.
- Una tarea no puede comenzar antes que otra.
- Un recurso no puede estar en dos lugares al mismo tiempo.

Preguntas utiles:

- Que cosas estan prohibidas?
- Que limites numericos aparecen en el problema?
- Que reglas operativas siempre deben cumplirse?
- Que dependencias o precedencias existen?

### Restricciones blandas
No invalidan una solucion, pero generan penalizacion o menor calidad.

Ejemplos:

- Preferir un proveedor sobre otro.
- Evitar cambios frecuentes de turno.
- Mantener balance entre cargas de trabajo.
- Intentar entregar antes de una fecha ideal.

Preguntas utiles:

- Que dice el problema que "conviene" hacer, aunque no sea obligatorio?
- Hay preferencias, prioridades o politicas internas?
- Existen casos donde se acepta incumplir algo a cambio de costo o penalidad?

## 3. Como identificar requisitos
Los requisitos describen lo que el sistema o la solucion debe hacer o respetar.

### Requisitos funcionales
Definen comportamientos o decisiones que deben existir.

Ejemplos:

- Asignar cada pedido a un vehiculo.
- Calcular una secuencia de produccion.
- Seleccionar una combinacion de recursos.

### Requisitos no funcionales
Definen calidad, desempeno o condiciones de operacion.

Ejemplos:

- Responder en menos de cierto tiempo.
- Escalar a miles de registros.
- Ser explicable para el usuario.
- Mantener trazabilidad de las decisiones.

Preguntas utiles:

- Que tiene que producir la solucion?
- Que entradas recibe?
- Que salidas debe entregar?
- En que tiempo o con que precision debe operar?

## 4. Como pasar del enunciado a reglas de optimizacion
Una forma practica es traducir cada frase del problema a una categoria.

### Frases que suelen indicar objetivo

- "Queremos minimizar..."
- "Buscamos maximizar..."
- "La mejor solucion es la que..."

### Frases que suelen indicar restriccion

- "No debe..."
- "Como maximo..."
- "Como minimo..."
- "Debe cumplir..."
- "Solo se permite..."

### Frases que suelen indicar requisito

- "El sistema debe..."
- "La solucion debe considerar..."
- "Se necesita calcular..."

## 5. Plantilla de analisis
Usa esta estructura para cualquier problema:

### Problema
Describir en una frase que decision se necesita tomar.

### Funcion objetivo

- Que se optimiza.
- Si se maximiza o minimiza.
- Como se mide.

### Variables de decision

- Que puede elegir el modelo o algoritmo.
- Que valores pueden tomar esas decisiones.

### Restricciones duras

- Limites de capacidad.
- Reglas de asignacion.
- Dependencias temporales.
- Restricciones de negocio.

### Restricciones blandas

- Preferencias.
- Penalizaciones.
- Criterios de balance.

### Requisitos funcionales

- Entradas esperadas.
- Salidas esperadas.
- Reglas de calculo obligatorias.

### Requisitos no funcionales

- Tiempo de respuesta.
- Escalabilidad.
- Robustez.
- Auditabilidad.

## 6. Checklist rapido
Antes de cerrar el analisis, verificar:

- Esta claro que se maximiza o minimiza?
- Las restricciones duras estan separadas de las blandas?
- Los requisitos estan diferenciados de las preferencias?
- Las variables de decision estan explicitas?
- Existe una forma concreta de comparar dos soluciones?
- Se puede detectar facilmente cuando una solucion es invalida?

## 7. Ejemplo corto
Enunciado:
"Asignar repartidores a pedidos minimizando el tiempo total de entrega, sin superar la capacidad de cada repartidor y priorizando clientes premium."

Analisis:

- Objetivo: minimizar el tiempo total de entrega.
- Variables de decision: que repartidor atiende cada pedido.
- Restriccion dura: no superar la capacidad de cada repartidor.
- Restriccion blanda: priorizar clientes premium.
- Requisito funcional: cada pedido debe quedar asignado.
- Requisito no funcional: el calculo debe ser util en operacion real.

## 8. Regla practica final
Si una condicion invalida la solucion, es una restriccion dura.
Si una condicion mejora o empeora la solucion, es una restriccion blanda o criterio de optimizacion.
Si una condicion describe lo que el sistema debe hacer o entregar, es un requisito.
